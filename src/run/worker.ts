import { OutputCap, type RunHandle, type RunResult, type WorkerRequest, type WorkerRunner } from "./runner";

/**
 * The JavaScript sandbox: the file runs in a Web Worker built from a Blob, in
 * Obsidian's own engine, on every platform. A Worker has no DOM, no Obsidian
 * API, no `require`; the prelude below also removes the network and script
 * loading from its global scope, so what remains is the language and the
 * console. `console.*` calls and uncaught errors come back as messages;
 * `terminate()` ends it on timeout or Stop.
 *
 * "Done" is when the script's synchronous part has run and no timer it set is
 * still pending: the prelude counts `setTimeout`/`setInterval` and posts
 * `done` from a zero-delay check once the count is zero. A script that keeps
 * an interval alive runs until the timeout, which is what it asked for.
 */

/** The slice of the Worker API the runner uses, so a test can hand in a fake. */
export interface WorkerLike {
  postMessage(msg: unknown): void;
  terminate(): void;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onerror: ((ev: { message?: string; lineno?: number; colno?: number }) => void) | null;
}

export interface WorkerDeps {
  /** Build a worker from the source text (the real one: a Blob URL and `new Worker`). */
  readonly createWorker: (source: string) => WorkerLike;
  readonly timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void };
  readonly now?: () => number;
}

/** What the prelude sends back. */
export type WorkerMessage = { type: "log"; level: "log" | "info" | "warn" | "error" | "debug"; text: string } | { type: "error"; text: string } | { type: "done" };

/**
 * Runs before the user's code in the same script. Kept on ONE line so the
 * user's line numbers in error messages are off by exactly one, which the
 * runner corrects.
 */
export const WORKER_PRELUDE: string = [
  "(function(){",
  'var g=self;var post=function(m){g.postMessage(m)};',
  // No network, no script loading: the sandbox is the language and the console.
  'try{["fetch","XMLHttpRequest","WebSocket","importScripts","EventSource"].forEach(function(k){try{g[k]=undefined}catch(e){}})}catch(e){}',
  "var fmt=function(a){return Array.prototype.map.call(a,function(x){if(typeof x==='string')return x;if(x instanceof Error)return String(x.stack||x);try{return JSON.stringify(x,null,0)}catch(e){return String(x)}}).join(' ')};",
  "['log','info','warn','error','debug'].forEach(function(l){g.console[l]=function(){post({type:'log',level:l,text:fmt(arguments)+'\\n'})}});",
  "var pending=0;var st=g.setTimeout,si=g.setInterval,ct=g.clearTimeout,ci=g.clearInterval;var live={};",
  "g.setTimeout=function(fn,ms){pending++;var id;id=st.call(g,function(){pending--;delete live[id];try{fn.apply(null,Array.prototype.slice.call(arguments))}finally{check()}},ms);live[id]=1;return id};",
  "g.clearTimeout=function(id){if(live[id]){pending--;delete live[id]}ct.call(g,id)};",
  "g.setInterval=function(fn,ms){pending++;var id=si.call(g,fn,ms);live[id]=1;return id};",
  "g.clearInterval=function(id){if(live[id]){pending--;delete live[id];check()}ci.call(g,id)};",
  "var check=function(){st.call(g,function(){if(pending===0)post({type:'done'})},0)};",
  "g.addEventListener('unhandledrejection',function(e){post({type:'error',text:'Unhandled promise rejection: '+(e.reason&&e.reason.stack||String(e.reason))+'\\n'})});",
  "g.__nfeCheck=check;",
  "})();",
].join("");

/** The whole worker script: prelude, a newline, the user's code, then the completion check. */
export function workerSource(code: string): string {
  return `${WORKER_PRELUDE}\n${code}\n;self.__nfeCheck();`;
}

export class BlobWorkerRunner implements WorkerRunner {
  private readonly deps: WorkerDeps;
  constructor(deps: WorkerDeps) {
    this.deps = deps;
  }

  start(req: WorkerRequest): RunHandle {
    const now = this.deps.now ?? (() => Date.now());
    const started = now();
    const cap = new OutputCap(req.outputCapBytes);
    let timedOut = false;
    let stopped = false;
    let sawError = false;
    let timer: unknown = null;
    let worker: WorkerLike | null = null;
    let finished = false;
    let stopImpl: (() => void) | null = null;

    const done = new Promise<RunResult>((resolve) => {
      const finish = (exitCode: number | null, error: string | null = null) => {
        if (finished) return;
        finished = true;
        if (timer !== null) this.deps.timers.clearTimeout(timer);
        try {
          worker?.terminate();
        } catch {
          // Already gone.
        }
        resolve({ exitCode, timedOut, stopped, truncated: cap.truncated, ms: now() - started, error });
      };
      const emit = (kind: "stdout" | "stderr", text: string) => {
        if (finished) return;
        const admitted = cap.admit(text);
        if (admitted === null) return;
        if (admitted.length > 0) req.onOutput({ kind, text: admitted });
        if (cap.truncated) {
          req.onOutput({ kind: "info", text: `\n[output truncated at ${req.outputCapBytes} bytes]\n` });
          finish(sawError ? 1 : 0);
        }
      };
      try {
        worker = this.deps.createWorker(workerSource(req.code));
      } catch (e) {
        finish(null, e instanceof Error ? e.message : String(e));
        return;
      }
      worker.onmessage = (ev) => {
        const m = ev.data as WorkerMessage;
        if (!m || typeof m !== "object") return;
        if (m.type === "log") emit(m.level === "error" || m.level === "warn" ? "stderr" : "stdout", m.text);
        else if (m.type === "error") {
          sawError = true;
          emit("stderr", m.text);
        } else if (m.type === "done") finish(sawError ? 1 : 0);
      };
      worker.onerror = (ev) => {
        sawError = true;
        const line = typeof ev.lineno === "number" && ev.lineno > 1 ? ` (line ${ev.lineno - 1}${typeof ev.colno === "number" ? `:${ev.colno}` : ""})` : "";
        emit("stderr", `${ev.message ?? "Uncaught error"}${line}\n`);
        // An uncaught error in the top-level script ends it; nothing will post `done`.
        finish(1);
      };
      timer = this.deps.timers.setTimeout(() => {
        timedOut = true;
        req.onOutput({ kind: "info", text: `\n[timed out after ${req.timeoutMs} ms; terminated]\n` });
        finish(null);
      }, req.timeoutMs);
      stopImpl = () => {
        stopped = true;
        finish(null);
      };
    });

    return { stop: () => stopImpl?.(), done };
  }
}

/** The real factory: a Blob URL and `new Worker`, revoked once the worker exists. */
export function createBlobWorker(source: string): WorkerLike {
  const url = URL.createObjectURL(new Blob([source], { type: "text/javascript" }));
  try {
    return new Worker(url) as unknown as WorkerLike;
  } finally {
    URL.revokeObjectURL(url);
  }
}

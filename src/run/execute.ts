import type { ProcessRunner, RunHandle, RunOutput, RunResult, TempDirs, WorkerRunner } from "./runner";
import { looksLikeMhtml, pageDocument, renderMhtml } from "./mhtml";
import { type RunContext, type RunnerDef, expandArg, expandArgv, refusePath, stepsOf, validateRunner } from "./runners";

/**
 * One run of one file with one runner: the orchestration between the
 * definitions (runners.ts) and the two runners (process.ts, worker.ts). Pure
 * apart from what the runners do; a test drives it with fakes.
 */

export interface ExecuteRequest {
  readonly def: RunnerDef;
  /** The file's absolute OS path, its folder and its name without extension. */
  readonly file: string;
  readonly dir: string;
  readonly stem: string;
  /** The document text as the editor holds it: what the worker runs and what `stdin: "{file}"` feeds. */
  readonly text: string;
  readonly timeoutMs: number;
  readonly outputCapBytes: number;
  readonly onOutput: (out: RunOutput) => void;
}

export interface ExecuteDeps {
  readonly processes: ProcessRunner | null;
  readonly worker: WorkerRunner;
  readonly tempDirs: TempDirs | null;
}

/** The outcome of a whole run: the last step's result plus which step ended it. */
export interface ExecuteResult extends RunResult {
  /** 1-based index of the step that ended the run (a failing compile, or the last one). */
  readonly step: number;
  readonly steps: number;
}

export interface ExecuteHandle {
  stop(): void;
  readonly done: Promise<ExecuteResult>;
}

function describeArgv(argv: readonly string[]): string {
  return argv.map((a) => (/[\s"']/.test(a) ? JSON.stringify(a) : a)).join(" ");
}

/** Refuse before anything starts: an invalid definition, an unusable path, or a process runner where there is none (mobile). */
export function precheck(req: ExecuteRequest, deps: ExecuteDeps): string | null {
  const invalid = validateRunner(req.def);
  if (invalid) return invalid;
  if (req.def.kind === "worker" || req.def.kind === "page") return null;
  const bad = refusePath(req.file) ?? refusePath(req.dir);
  if (bad) return bad;
  if (!deps.processes) return "running a program needs the desktop app";
  if (stepsOf(req.def).some((s) => s.some((a) => a.includes("{tmp}"))) && !deps.tempDirs) return "this runner needs a temp directory, which is not available here";
  return null;
}

export function execute(req: ExecuteRequest, deps: ExecuteDeps): ExecuteHandle {
  const failure = precheck(req, deps);
  let current: RunHandle | null = null;
  let stopped = false;

  const fail = (error: string): ExecuteHandle => ({
    stop: () => undefined,
    done: Promise.resolve({ exitCode: null, timedOut: false, stopped: false, truncated: false, ms: 0, error, step: 0, steps: 0 }),
  });
  if (failure) return fail(failure);

  if (req.def.kind === "worker") {
    req.onOutput({ kind: "info", text: `[${req.def.name}]\n` });
    current = deps.worker.start({ code: req.text, timeoutMs: req.timeoutMs, outputCapBytes: req.outputCapBytes, onOutput: req.onOutput });
    const handle = current;
    return { stop: () => handle.stop(), done: handle.done.then((r) => ({ ...r, step: 1, steps: 1 })) };
  }

  if (req.def.kind === "page") {
    // The page is the editor's text (an MHTML archive yields its HTML part
    // with its stylesheets and images inlined as data: URIs), rendered by the
    // panel in a sandboxed frame: scripts in an opaque origin, no network.
    const started = Date.now();
    // One token per run: the page's reports come back through window.top with it (mhtml.ts, pageReporter).
    const token = `nfe-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const archive = looksLikeMhtml(req.text);
    const html = archive ? renderMhtml(req.text, token) : req.text;
    if (html === null) return fail("this MHTML file has no text/html part");
    const doc = pageDocument(html, token);
    req.onOutput({ kind: "info", text: `[page] ${archive ? "MHTML archive" : "HTML document"}, document ${(doc.length / 1024).toFixed(0)} KB, ${(doc.match(/<iframe\b/gi) ?? []).length} frame(s) in the page, ${Date.now() - started} ms to build\n` });
    req.onOutput({ kind: "page", text: doc, token });
    return { stop: () => undefined, done: Promise.resolve({ exitCode: 0, timedOut: false, stopped: false, truncated: false, ms: Date.now() - started, error: null, step: 1, steps: 1 }) };
  }

  const processes = deps.processes as ProcessRunner;
  const steps = stepsOf(req.def);
  const needsTmp = steps.some((s) => s.some((a) => a.includes("{tmp}")));

  const done = (async (): Promise<ExecuteResult> => {
    let tmp = "";
    if (needsTmp && deps.tempDirs) tmp = await deps.tempDirs.create();
    const ctx: RunContext = { file: req.file, dir: req.dir, stem: req.stem, tmp };
    const started = Date.now();
    let last: RunResult = { exitCode: null, timedOut: false, stopped: false, truncated: false, ms: 0, error: null };
    let index = 0;
    try {
      for (index = 0; index < steps.length; index++) {
        if (stopped) break;
        const argv = expandArgv(steps[index] ?? [], ctx);
        req.onOutput({ kind: "info", text: `[${req.def.name}${steps.length > 1 ? ` ${index + 1}/${steps.length}` : ""}] ${describeArgv(argv)}\n` });
        const stdinText = req.def.stdin === undefined ? undefined : req.def.stdin === "{file}" ? req.text : expandArg(req.def.stdin, ctx);
        // Only the step that runs the program reads the file on stdin; a compile step does not.
        const isLast = index === steps.length - 1;
        current = processes.start({
          argv,
          cwd: req.dir,
          stdinText: isLast ? stdinText : undefined,
          timeoutMs: req.timeoutMs,
          outputCapBytes: req.outputCapBytes,
          onOutput: req.onOutput,
        });
        last = await current.done;
        current = null;
        if (last.error !== null || last.exitCode !== 0 || last.timedOut || last.stopped) break;
      }
    } finally {
      if (tmp && deps.tempDirs) await deps.tempDirs.remove(tmp).catch(() => undefined);
    }
    return { ...last, stopped: last.stopped || stopped, ms: Date.now() - started, step: Math.min(index + 1, steps.length), steps: steps.length };
  })();

  return {
    stop: () => {
      stopped = true;
      current?.stop();
    },
    done,
  };
}

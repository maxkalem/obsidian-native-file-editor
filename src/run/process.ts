import { OutputCap, type ProcessRequest, type ProcessRunner, type RunHandle, type RunResult, type TempDirs } from "./runner";

/**
 * The desktop process runner: the ONLY module in the plugin that names
 * `child_process` (ADR-004, docs/threat-model.md). Everything is resolved
 * lazily through Electron's `require`, exactly like the desktop transport, so
 * the one `main.js` still loads on a phone where `require` does not exist.
 *
 * What it guarantees: `spawn` with an argv array and `shell: false`, the
 * working directory the caller chose, a timeout that kills the process tree,
 * and an output cap. What it does not do: build a command line, invoke a shell
 * wrapper, or start anything on its own.
 */

/** The slice of Node a run uses, named so a test can hand in the real modules. */
export interface ProcessModules {
  child_process: {
    spawn(
      command: string,
      args: readonly string[],
      options: { cwd: string; shell: false; windowsHide: boolean; detached: boolean; stdio: ["pipe", "pipe", "pipe"] }
    ): ChildLike;
  };
  process: { platform: string; kill(pid: number, signal: string): void };
  fs: { promises: { mkdtemp(prefix: string): Promise<string>; rm(path: string, options: { recursive: true; force: true }): Promise<void> } };
  os: { tmpdir(): string };
  path: { join(...parts: string[]): string };
}

/** The shape of a spawned child this runner relies on. */
export interface ChildLike {
  readonly pid: number | undefined;
  readonly stdout: { on(event: "data", fn: (chunk: Uint8Array | string) => void): unknown } | null;
  readonly stderr: { on(event: "data", fn: (chunk: Uint8Array | string) => void): unknown } | null;
  readonly stdin: { write(text: string): unknown; end(): unknown; on(event: "error", fn: (e: unknown) => void): unknown } | null;
  on(event: "error", fn: (e: Error & { code?: string }) => void): unknown;
  on(event: "close", fn: (code: number | null, signal: string | null) => void): unknown;
  kill(signal?: string): boolean;
}

export function loadProcessModules(): ProcessModules {
  const req = (globalThis as unknown as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function") throw new Error("Node require is not available in this environment.");
  return {
    child_process: req("child_process") as ProcessModules["child_process"],
    process: req("process") as ProcessModules["process"],
    fs: req("fs") as ProcessModules["fs"],
    os: req("os") as ProcessModules["os"],
    path: req("path") as ProcessModules["path"],
  };
}

export class DesktopProcessRunner implements ProcessRunner {
  private readonly node: ProcessModules;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (id: unknown) => void;

  constructor(node: ProcessModules, timers: { setTimeout: (fn: () => void, ms: number) => unknown; clearTimeout: (id: unknown) => void }, now: () => number = () => Date.now()) {
    this.node = node;
    this.now = now;
    this.setTimer = timers.setTimeout;
    this.clearTimer = timers.clearTimeout;
  }

  start(req: ProcessRequest): RunHandle {
    const [command, ...args] = req.argv;
    if (command === undefined || command.length === 0) throw new Error("empty argv");
    const started = this.now();
    const cap = new OutputCap(req.outputCapBytes);
    const decoders = { stdout: new TextDecoder("utf-8"), stderr: new TextDecoder("utf-8") };
    let timedOut = false;
    let stopped = false;
    let startError: string | null = null;
    let timer: unknown = null;
    let child: ChildLike | null = null;

    const forward = (kind: "stdout" | "stderr", chunk: Uint8Array | string) => {
      const text = typeof chunk === "string" ? chunk : decoders[kind].decode(chunk, { stream: true });
      const admitted = cap.admit(text);
      if (admitted === null) return;
      if (admitted.length > 0) req.onOutput({ kind, text: admitted });
      if (cap.truncated) {
        req.onOutput({ kind: "info", text: `\n[output truncated at ${req.outputCapBytes} bytes]\n` });
        this.killTree(child);
      }
    };

    const done = new Promise<RunResult>((resolve) => {
      const finish = (exitCode: number | null) => {
        if (timer !== null) this.clearTimer(timer);
        resolve({ exitCode, timedOut, stopped, truncated: cap.truncated, ms: this.now() - started, error: startError });
      };
      try {
        // `detached` puts the child in its own process group on POSIX so the
        // whole tree can be signalled; on Windows `taskkill /T` does the same
        // job. `windowsHide` keeps a console window from flashing.
        child = this.node.child_process.spawn(command, args, {
          cwd: req.cwd,
          shell: false,
          windowsHide: true,
          detached: this.node.process.platform !== "win32",
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (e) {
        startError = e instanceof Error ? e.message : String(e);
        finish(null);
        return;
      }
      const c = child;
      c.on("error", (e) => {
        startError = e.code === "ENOENT" ? `${command}: not found (is it installed and on PATH, or set an absolute path in the runner?)` : e.message;
        // `close` may or may not follow an early error; resolve once either way.
        finish(null);
      });
      c.on("close", (code) => finish(code));
      c.stdout?.on("data", (chunk) => forward("stdout", chunk));
      c.stderr?.on("data", (chunk) => forward("stderr", chunk));
      if (c.stdin) {
        c.stdin.on("error", () => undefined);
        if (req.stdinText !== undefined) c.stdin.write(req.stdinText);
        c.stdin.end();
      }
      timer = this.setTimer(() => {
        timedOut = true;
        req.onOutput({ kind: "info", text: `\n[timed out after ${req.timeoutMs} ms; killed]\n` });
        this.killTree(c);
      }, req.timeoutMs);
    });

    // A promise that resolves once must not resolve twice; `finish` guards
    // through Promise semantics (a second resolve is a no-op).
    return {
      stop: () => {
        stopped = true;
        this.killTree(child);
      },
      done,
    };
  }

  /** Kill the process and everything it started. Best effort; a process that is already gone is not an error. */
  private killTree(child: ChildLike | null): void {
    if (!child || child.pid === undefined) return;
    try {
      if (this.node.process.platform === "win32") {
        // taskkill is itself started with an argv array, never a command line.
        this.node.child_process.spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
          cwd: this.node.os.tmpdir(),
          shell: false,
          windowsHide: true,
          detached: false,
          stdio: ["pipe", "pipe", "pipe"],
        });
      } else {
        this.node.process.kill(-child.pid, "SIGKILL");
      }
    } catch {
      try {
        child.kill("SIGKILL");
      } catch {
        // Already gone.
      }
    }
  }
}

/** Temp directories under the OS temp folder, one per run, removed afterwards. */
export class NodeTempDirs implements TempDirs {
  constructor(private readonly node: ProcessModules) {}
  create(): Promise<string> {
    return this.node.fs.promises.mkdtemp(this.node.path.join(this.node.os.tmpdir(), "native-file-editor-run-"));
  }
  remove(path: string): Promise<void> {
    return this.node.fs.promises.rm(path, { recursive: true, force: true });
  }
}

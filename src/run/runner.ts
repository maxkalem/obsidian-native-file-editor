/**
 * What the panel and the executor see of a running program, without naming
 * `child_process` or `Worker`. `process.ts` and `worker.ts` implement it; the
 * tests drive the panel with a fake.
 */

/** `page`: the text is an HTML document to render in the panel's sandboxed frame, not to print. */
export type OutputKind = "stdout" | "stderr" | "info" | "page";

export interface RunOutput {
  readonly kind: OutputKind;
  readonly text: string;
}

export interface RunResult {
  /** The process's exit code; null when it was killed or never started. */
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  /** Stopped by the user. */
  readonly stopped: boolean;
  /** Output was cut at the cap. */
  readonly truncated: boolean;
  /** Wall time in milliseconds. */
  readonly ms: number;
  /** Why the process could not start, when it could not (`ENOENT` for a missing interpreter). */
  readonly error: string | null;
}

export interface RunHandle {
  /** Kill the program (and its children); `done` still resolves. */
  stop(): void;
  readonly done: Promise<RunResult>;
}

export interface ProcessRequest {
  /** The command and its arguments, already expanded; `argv[0]` is the program. */
  readonly argv: readonly string[];
  readonly cwd: string;
  /** Text to write to the program's stdin, then close it; absent closes stdin at once. */
  readonly stdinText?: string;
  readonly timeoutMs: number;
  readonly outputCapBytes: number;
  readonly onOutput: (out: RunOutput) => void;
}

/** Starts one process. */
export interface ProcessRunner {
  start(req: ProcessRequest): RunHandle;
}

/** Per-run scratch space outside the vault, for compiled languages. */
export interface TempDirs {
  create(): Promise<string>;
  remove(path: string): Promise<void>;
}

export interface WorkerRequest {
  readonly code: string;
  readonly timeoutMs: number;
  readonly outputCapBytes: number;
  readonly onOutput: (out: RunOutput) => void;
}

/** Runs JavaScript in the sandbox. */
export interface WorkerRunner {
  start(req: WorkerRequest): RunHandle;
}

/**
 * Counts bytes of output against a cap and says when to stop forwarding.
 * Shared by both runners so "truncated" means the same thing in both.
 */
export class OutputCap {
  private bytes = 0;
  truncated = false;
  constructor(private readonly capBytes: number) {}
  /** The part of `text` that still fits, or null when nothing more may pass. */
  admit(text: string): string | null {
    if (this.truncated) return null;
    const size = utf8Length(text);
    if (this.bytes + size <= this.capBytes) {
      this.bytes += size;
      return text;
    }
    const room = Math.max(0, this.capBytes - this.bytes);
    this.truncated = true;
    this.bytes = this.capBytes;
    return room > 0 ? truncateUtf8(text, room) : "";
  }
}

function utf8Length(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

function truncateUtf8(s: string, bytes: number): string {
  let n = 0;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    const size = c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? 4 : 3;
    if (n + size > bytes) break;
    n += size;
    if (size === 4) {
      out += s.slice(i, i + 2);
      i++;
    } else out += s[i];
  }
  return out;
}

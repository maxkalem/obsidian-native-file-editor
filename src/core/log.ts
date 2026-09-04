import type { Timers } from "./autosave";

/**
 * The plugin's log: what happened, in order, with enough detail to diagnose a
 * device report without reproducing it. Lines go to a ring buffer at once and
 * to a file in the plugin folder through a debounced sink, so a burst of events
 * costs one write and a crash still leaves the last lines on disk from the
 * previous flush. The sink is injected: the plugin hands in the vault adapter,
 * a test hands in an array.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogSink {
  /** Append `text` (which always ends in a newline) to the log file. */
  append(text: string): Promise<void>;
  /** Current size of the log file in bytes, or 0 when it does not exist. */
  size(): Promise<number>;
  /** Move the current file aside (replacing any previous rotated file). */
  rotate(): Promise<void>;
}

export interface LoggerOptions {
  readonly sink: LogSink | null;
  readonly timers: Timers;
  readonly now: () => number;
  /** Lines kept in memory for the in-app view of the log. */
  readonly ringSize?: number;
  /** The file is rotated once it exceeds this many bytes. */
  readonly maxFileBytes?: number;
  readonly flushDelayMs?: number;
}

/** Local time as `YYYY-MM-DD HH:MM:SS.mmm`, the form people read in a log. */
export function formatTimestamp(ms: number): string {
  const d = new Date(ms);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** One error as text: name, message, and the stack when there is one. */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    const stack = e.stack && e.stack !== e.message ? `\n    ${e.stack.split("\n").slice(0, 8).join("\n    ")}` : "";
    const cause = "cause" in e && e.cause !== undefined ? `\n    cause: ${describeError(e.cause)}` : "";
    return `${e.name}: ${e.message}${stack}${cause}`;
  }
  return String(e);
}

export class Logger {
  private readonly sink: LogSink | null;
  private readonly timers: Timers;
  private readonly now: () => number;
  private readonly ringSize: number;
  private readonly maxFileBytes: number;
  private readonly flushDelayMs: number;
  private readonly ring: string[] = [];
  private pending: string[] = [];
  private timer: number | null = null;
  private flushing: Promise<void> | null = null;

  constructor(opts: LoggerOptions) {
    this.sink = opts.sink;
    this.timers = opts.timers;
    this.now = opts.now;
    this.ringSize = opts.ringSize ?? 500;
    this.maxFileBytes = opts.maxFileBytes ?? 1024 * 1024;
    this.flushDelayMs = opts.flushDelayMs ?? 1000;
  }

  debug(scope: string, message: string): void {
    this.write("debug", scope, message);
  }
  info(scope: string, message: string): void {
    this.write("info", scope, message);
  }
  warn(scope: string, message: string): void {
    this.write("warn", scope, message);
  }
  error(scope: string, message: string, e?: unknown): void {
    this.write("error", scope, e === undefined ? message : `${message}: ${describeError(e)}`);
  }

  /** The most recent lines, oldest first. */
  recent(): readonly string[] {
    return this.ring;
  }

  /** Write everything pending now; called on unload. */
  async flush(): Promise<void> {
    if (this.timer !== null) {
      this.timers.clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.flushing) await this.flushing;
    if (this.pending.length === 0 || !this.sink) return;
    const sink = this.sink;
    const text = `${this.pending.join("\n")}\n`;
    this.pending = [];
    this.flushing = (async () => {
      try {
        if ((await sink.size()) > this.maxFileBytes) await sink.rotate();
        await sink.append(text);
      } catch {
        // A log that cannot be written must not take the plugin down with it.
      }
    })();
    try {
      await this.flushing;
    } finally {
      this.flushing = null;
    }
  }

  private write(level: LogLevel, scope: string, message: string): void {
    const line = `${formatTimestamp(this.now())} ${level.toUpperCase().padEnd(5)} [${scope}] ${message.replace(/\r?\n/g, "\n    ")}`;
    this.ring.push(line);
    if (this.ring.length > this.ringSize) this.ring.splice(0, this.ring.length - this.ringSize);
    if (!this.sink) return;
    this.pending.push(line);
    if (this.timer === null) {
      this.timer = this.timers.setTimeout(() => {
        this.timer = null;
        void this.flush();
      }, this.flushDelayMs);
    }
  }
}

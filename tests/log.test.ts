import { describe, expect, it } from "vitest";
import type { Timers } from "../src/core/autosave";
import { type LogSink, Logger, describeError, formatTimestamp } from "../src/core/log";

class FakeTimers implements Timers {
  private next = 1;
  pending = new Map<number, () => void>();
  setTimeout(fn: () => void): number {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  }
  clearTimeout(id: number): void {
    this.pending.delete(id);
  }
  fireAll(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn();
  }
}

class FakeSink implements LogSink {
  file = "";
  rotated: string[] = [];
  failAppend = false;
  async append(text: string): Promise<void> {
    if (this.failAppend) throw new Error("disk full");
    this.file += text;
  }
  async size(): Promise<number> {
    return this.file.length;
  }
  async rotate(): Promise<void> {
    this.rotated.push(this.file);
    this.file = "";
  }
}

const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function make(opts: Partial<{ maxFileBytes: number; ringSize: number; sink: LogSink | null }> = {}) {
  const timers = new FakeTimers();
  const sink = opts.sink === undefined ? new FakeSink() : opts.sink;
  let now = Date.UTC(2026, 8, 4, 12, 0, 0);
  const log = new Logger({ sink, timers, now: () => now, ringSize: opts.ringSize, maxFileBytes: opts.maxFileBytes, flushDelayMs: 1000 });
  return { log, timers, sink: sink as FakeSink | null, advance: (ms: number) => void (now += ms) };
}

describe("Logger", () => {
  it("formats lines with a timestamp, a padded level and a scope", () => {
    const { log } = make();
    log.info("plugin", "load 0.1.0");
    log.warn("view", "hmm");
    const lines = log.recent();
    expect(lines[0]).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3} INFO  \[plugin\] load 0\.1\.0$/);
    expect(lines[1]).toMatch(/ WARN  \[view\] hmm$/);
  });

  it("writes to the sink once per burst, after the delay, and each write ends in a newline", async () => {
    const { log, timers, sink } = make();
    log.info("a", "one");
    log.info("a", "two");
    expect(sink!.file).toBe("");
    expect(timers.pending.size).toBe(1);
    timers.fireAll();
    await tick();
    expect(sink!.file.split("\n").filter(Boolean)).toHaveLength(2);
    expect(sink!.file.endsWith("\n")).toBe(true);
  });

  it("indents multi-line messages so one entry stays one entry", () => {
    const { log } = make();
    log.error("x", "failed", new Error("boom"));
    const line = log.recent()[0] ?? "";
    expect(line.startsWith("20")).toBe(true);
    expect(line).toContain("ERROR [x] failed: Error: boom");
    expect(line.split("\n").slice(1).every((l) => l.startsWith("    "))).toBe(true);
  });

  it("rotates the file when it is over the cap, before appending", async () => {
    const { log, timers, sink } = make({ maxFileBytes: 10 });
    sink!.file = "x".repeat(20);
    log.info("a", "after");
    timers.fireAll();
    await tick();
    expect(sink!.rotated).toEqual(["x".repeat(20)]);
    expect(sink!.file).toContain("after");
  });

  it("keeps only the newest ring entries and survives a sink that fails", async () => {
    const { log, timers, sink } = make({ ringSize: 3 });
    sink!.failAppend = true;
    for (let i = 0; i < 5; i++) log.info("a", `m${i}`);
    expect(log.recent().map((l) => l.slice(-2))).toEqual(["m2", "m3", "m4"]);
    timers.fireAll();
    await expect(log.flush()).resolves.toBeUndefined();
  });

  it("works with no sink at all", async () => {
    const { log } = make({ sink: null });
    log.info("a", "b");
    await log.flush();
    expect(log.recent()).toHaveLength(1);
  });
});

describe("helpers", () => {
  it("formatTimestamp is local time with milliseconds", () => {
    expect(formatTimestamp(new Date(2026, 8, 4, 7, 5, 9, 42).getTime())).toBe("2026-09-04 07:05:09.042");
  });

  it("describeError carries name, message, a trimmed stack and the cause", () => {
    const e = new Error("outer");
    (e as Error & { cause: unknown }).cause = new TypeError("inner");
    const text = describeError(e);
    expect(text).toContain("Error: outer");
    expect(text).toContain("cause: TypeError: inner");
    expect(describeError("plain")).toBe("plain");
  });
});

import { describe, expect, it } from "vitest";
import type { RunOutput } from "../src/run/runner";
import { BlobWorkerRunner, WORKER_PRELUDE, type WorkerLike, type WorkerMessage, workerSource } from "../src/run/worker";

/**
 * The JavaScript sandbox against a fake Worker: what the prelude is, how the
 * runner turns messages into output, and how it ends (done, error, timeout,
 * stop). The prelude itself can only run in a real Worker: the device.
 */

class FakeWorker implements WorkerLike {
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onerror: ((ev: { message?: string; lineno?: number; colno?: number }) => void) | null = null;
  terminated = 0;
  constructor(readonly source: string) {}
  postMessage(): void {}
  terminate(): void {
    this.terminated++;
  }
  /** What the prelude would post. */
  emit(m: WorkerMessage): void {
    this.onmessage?.({ data: m });
  }
}

const timers: Array<{ fn: () => void; ms: number }> = [];
const fakeTimers = {
  setTimeout: (fn: () => void, ms: number) => {
    timers.push({ fn, ms });
    return timers.length;
  },
  clearTimeout: (id: unknown) => {
    const t = timers[(id as number) - 1];
    if (t) t.fn = () => undefined;
  },
};

function start(code = "console.log(1)", cap = 4096) {
  let worker!: FakeWorker;
  const out: RunOutput[] = [];
  const runner = new BlobWorkerRunner({
    createWorker: (src) => (worker = new FakeWorker(src)),
    timers: fakeTimers,
    now: () => 0,
  });
  const h = runner.start({ code, timeoutMs: 1000, outputCapBytes: cap, onOutput: (o) => out.push(o) });
  return { h, out, worker };
}

describe("the worker prelude", () => {
  it("is one line, removes the network, forwards console and counts timers", () => {
    expect(WORKER_PRELUDE).not.toContain("\n");
    for (const k of ["fetch", "XMLHttpRequest", "WebSocket", "importScripts", "EventSource"]) expect(WORKER_PRELUDE).toContain(`"${k}"`);
    expect(WORKER_PRELUDE).toContain("g.console[l]=function()");
    expect(WORKER_PRELUDE).toContain("g.setTimeout=function");
    expect(WORKER_PRELUDE).toContain("unhandledrejection");
    // The source is prelude, newline, code, then the completion check; the user's line 1 is the file's line 2.
    const src = workerSource("a\nb");
    expect(src.split("\n")[1]).toBe("a");
    expect(src.endsWith(";self.__nfeCheck();")).toBe(true);
  });
});

describe("BlobWorkerRunner", () => {
  it("forwards logs by level, ends on done with exit 0, and terminates the worker", async () => {
    const { h, out, worker } = start();
    expect(worker.source.startsWith(WORKER_PRELUDE)).toBe(true);
    worker.emit({ type: "log", level: "log", text: "one\n" });
    worker.emit({ type: "log", level: "warn", text: "careful\n" });
    worker.emit({ type: "log", level: "error", text: "bad\n" });
    worker.emit({ type: "done" });
    const r = await h.done;
    expect(out).toEqual([
      { kind: "stdout", text: "one\n" },
      { kind: "stderr", text: "careful\n" },
      { kind: "stderr", text: "bad\n" },
    ]);
    expect(r).toMatchObject({ exitCode: 0, timedOut: false, stopped: false, truncated: false, error: null });
    expect(worker.terminated).toBe(1);
  });

  it("an uncaught error ends the run with exit 1 and the user's line number", async () => {
    const { h, out, worker } = start();
    worker.onerror?.({ message: "Uncaught ReferenceError: x is not defined", lineno: 4, colno: 3 });
    const r = await h.done;
    expect(out).toEqual([{ kind: "stderr", text: "Uncaught ReferenceError: x is not defined (line 3:3)\n" }]);
    expect(r.exitCode).toBe(1);
  });

  it("a reported error then done is exit 1", async () => {
    const { h, worker } = start();
    worker.emit({ type: "error", text: "Unhandled promise rejection: boom\n" });
    worker.emit({ type: "done" });
    expect((await h.done).exitCode).toBe(1);
  });

  it("the timeout terminates the worker and says so", async () => {
    const { h, out, worker } = start();
    const timer = timers[timers.length - 1];
    timer?.fn();
    const r = await h.done;
    expect(r.timedOut).toBe(true);
    expect(worker.terminated).toBe(1);
    expect(out.some((o) => o.kind === "info" && /timed out after 1000 ms/.test(o.text))).toBe(true);
  });

  it("stop terminates and marks stopped; a late message is ignored", async () => {
    const { h, out, worker } = start();
    h.stop();
    const r = await h.done;
    worker.emit({ type: "log", level: "log", text: "late\n" });
    expect(r.stopped).toBe(true);
    expect(out.filter((o) => o.text === "late\n")).toHaveLength(0);
    expect(worker.terminated).toBe(1);
  });

  it("the output cap ends the run", async () => {
    const { h, out, worker } = start("x", 10);
    worker.emit({ type: "log", level: "log", text: "0123456789ABCDEF\n" });
    const r = await h.done;
    expect(r.truncated).toBe(true);
    expect(out[0]).toEqual({ kind: "stdout", text: "0123456789" });
    expect(worker.terminated).toBe(1);
  });

  it("a worker that cannot be created reports the reason", async () => {
    const runner = new BlobWorkerRunner({
      createWorker: () => {
        throw new Error("no Worker here");
      },
      timers: fakeTimers,
    });
    const r = await runner.start({ code: "1", timeoutMs: 10, outputCapBytes: 10, onOutput: () => undefined }).done;
    expect(r.error).toBe("no Worker here");
  });
});

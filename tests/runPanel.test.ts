import { beforeEach, describe, expect, it } from "vitest";
import { __fakeEl, __findAllByClass, __findByClass, __fire, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import type { Timers } from "../src/core/autosave";
import type { ExecuteHandle, ExecuteResult } from "../src/run/execute";
import { RunPanel } from "../src/run/RunPanel";
import type { RunOutput } from "../src/run/runner";
import type { RunnerDef } from "../src/run/runners";

/**
 * The output panel against a fake executor: buttons, the runner dropdown,
 * output classes, status text, stop. What it cannot prove is layout; that is
 * the device's.
 */

class FakeTimers implements Timers {
  private next = 1;
  pending = new Map<number, () => void>();
  setTimeout(fn: () => void, _ms: number): number {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  }
  clearTimeout(id: number): void {
    this.pending.delete(id);
  }
  fire(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn();
  }
}

const RUNNERS: RunnerDef[] = [
  { language: "JavaScript", name: "Sandbox (Web Worker)", kind: "worker" },
  { language: "JavaScript", name: "Node", argv: ["node", "{file}"] },
];

let started: Array<{ def: RunnerDef; onOutput: (o: RunOutput) => void; resolve: (r: ExecuteResult) => void; stopped: boolean }>;
let closed: number;
let copied: string[];
let timers: FakeTimers;
let now: number;

function makePanel(runners: RunnerDef[] = RUNNERS): RunPanel {
  const parent = __fakeEl("div");
  return new RunPanel(parent, {
    runners: () => runners,
    start: (def, onOutput) => {
      const entry: { def: RunnerDef; onOutput: (o: RunOutput) => void; resolve: (r: ExecuteResult) => void; stopped: boolean } = { def, onOutput, resolve: () => undefined, stopped: false };
      const done = new Promise<ExecuteResult>((r) => (entry.resolve = r));
      started.push(entry);
      const handle: ExecuteHandle = {
        stop: () => {
          entry.stopped = true;
          entry.resolve({ exitCode: null, timedOut: false, stopped: true, truncated: false, ms: 500, error: null, step: 1, steps: 1 });
        },
        done,
      };
      return handle;
    },
    timers,
    now: () => now,
    copy: (t) => copied.push(t),
    onClose: () => closed++,
  });
}

const result = (over: Partial<ExecuteResult> = {}): ExecuteResult => ({ exitCode: 0, timedOut: false, stopped: false, truncated: false, ms: 1234, error: null, step: 1, steps: 1, ...over });

beforeEach(() => {
  __resetObsidianMock();
  started = [];
  closed = 0;
  copied = [];
  timers = new FakeTimers();
  now = 1000;
});

describe("RunPanel", () => {
  it("builds its controls; the dropdown is hidden with one runner and shows the names with several", () => {
    const panel = makePanel();
    expect(__findByClass(panel.rootEl, "nfe-run-button").textContent).toBe("Run");
    const select = __findByClass(panel.rootEl, "nfe-run-select");
    expect(select.children.map((o: { textContent: string }) => o.textContent)).toEqual(["Sandbox (Web Worker)", "Node"]);
    expect(select.hasClass("nfe-hidden")).toBe(false);
    expect(__findByClass(panel.rootEl, "nfe-run-output")).not.toBeNull();
    expect(__findAllByClass(panel.rootEl, "nfe-run-tool").map((b) => b.textContent)).toEqual(["Clear", "Copy", "Close"]);
    const one = makePanel([RUNNERS[1]!]);
    expect(__findByClass(one.rootEl, "nfe-run-select").hasClass("nfe-hidden")).toBe(true);
    const none = makePanel([]);
    expect(__findByClass(none.rootEl, "nfe-run-button").disabled).toBe(true);
    expect(__findByClass(none.rootEl, "nfe-run-button").title).toMatch(/No runner/);
  });

  it("Run starts the selected runner, streams output into classed spans, and reports the exit", async () => {
    const panel = makePanel();
    const run = panel.run();
    expect(started).toHaveLength(1);
    expect(started[0]?.def.name).toBe("Sandbox (Web Worker)");
    expect(panel.isRunning).toBe(true);
    expect(__findByClass(panel.rootEl, "nfe-run-button").textContent).toBe("Stop");
    started[0]?.onOutput({ kind: "info", text: "[Sandbox]\n" });
    started[0]?.onOutput({ kind: "stdout", text: "a" });
    started[0]?.onOutput({ kind: "stdout", text: "b\n" });
    started[0]?.onOutput({ kind: "stderr", text: "oops\n" });
    const spans = __findByClass(panel.rootEl, "nfe-run-output").children;
    expect(spans.map((s: { className: string; textContent: string }) => [s.className, s.textContent])).toEqual([
      ["nfe-run-info", "[Sandbox]\n"],
      ["nfe-run-stdout", "ab\n"],
      ["nfe-run-stderr", "oops\n"],
    ]);
    now = 1600;
    timers.fire();
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("running, 0.6 s");
    started[0]?.resolve(result({ exitCode: 0, ms: 1234 }));
    await run;
    expect(panel.isRunning).toBe(false);
    expect(__findByClass(panel.rootEl, "nfe-run-button").textContent).toBe("Run");
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("exit 0, 1.23 s");
  });

  it("the dropdown picks the runner; Stop stops; the statuses name stop, timeout, failed start and a failing step", async () => {
    const panel = makePanel();
    const select = __findByClass(panel.rootEl, "nfe-run-select");
    select.value = "Node";
    let run = panel.run();
    expect(started[0]?.def.name).toBe("Node");
    __fire(__findByClass(panel.rootEl, "nfe-run-button"), "click");
    await run;
    expect(started[0]?.stopped).toBe(true);
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("stopped after 0.50 s");

    run = panel.run();
    started[1]?.resolve(result({ exitCode: null, timedOut: true, ms: 30000 }));
    await run;
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("timed out after 30.0 s");

    run = panel.run();
    started[2]?.resolve(result({ exitCode: null, error: "node: not found", ms: 3 }));
    await run;
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("failed to start");
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toContain("[could not start: node: not found]");

    run = panel.run();
    started[3]?.resolve(result({ exitCode: 1, step: 1, steps: 2, ms: 800 }));
    await run;
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("step 1 of 2 exited with 1, 0.80 s");
  });

  it("Clear empties the output, Copy hands the text over, Close tells the owner, a second Run clears first", async () => {
    const panel = makePanel();
    let run = panel.run();
    started[0]?.onOutput({ kind: "stdout", text: "first\n" });
    started[0]?.resolve(result());
    await run;
    const tools = __findAllByClass(panel.rootEl, "nfe-run-tool");
    __fire(tools[1]!, "click");
    expect(copied).toEqual(["first\n"]);
    __fire(tools[0]!, "click");
    expect(__findByClass(panel.rootEl, "nfe-run-output").children).toHaveLength(0);
    run = panel.run();
    started[1]?.onOutput({ kind: "stdout", text: "second\n" });
    started[1]?.resolve(result());
    await run;
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("second\n");
    __fire(tools[2]!, "click");
    expect(closed).toBe(1);
    const parent = (panel.rootEl as unknown as { parent: { children: unknown[] } }).parent;
    panel.destroy();
    expect(parent.children).toHaveLength(0);
  });

  it("Run while running does nothing; destroy stops a run", async () => {
    const panel = makePanel();
    const run = panel.run();
    await panel.run();
    expect(started).toHaveLength(1);
    panel.destroy();
    await run;
    expect(started[0]?.stopped).toBe(true);
  });
});

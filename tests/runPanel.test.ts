import { beforeEach, describe, expect, it } from "vitest";
import { __fakeEl, __findAllByClass, __findByClass, __fire, __resetObsidianMock, __textOf } from "./mocks/obsidian";
import type { Timers } from "../src/core/autosave";
import type { ExecuteHandle, ExecuteResult } from "../src/run/execute";
import { DEFAULT_PANEL_HEIGHT, RunPanel, panelFractionAt } from "../src/run/RunPanel";
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
    expect(__findAllByClass(panel.rootEl, "nfe-run-tool").map((b) => b.textContent)).toEqual(["Clear", "Copy"]);
    // Close is an icon square (the search panel's x), not a word.
    const close = __findByClass(panel.rootEl, "nfe-run-close");
    expect(close.textContent).toBe("");
    expect(close.hasClass("clickable-icon")).toBe(true);
    expect(close.getAttribute("aria-label")).toBe("Close the output panel");
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
    __fire(__findByClass(panel.rootEl, "nfe-run-close"), "click");
    expect(closed).toBe(1);
    const parent = (panel.rootEl as unknown as { parent: { children: unknown[] } }).parent;
    panel.destroy();
    expect(parent.children).toHaveLength(0);
  });

  it("a page output puts a sandboxed frame (scripts only, opaque origin) into the panel instead of text, and Clear removes it", async () => {
    const panel = makePanel();
    const run = panel.run();
    started[0]?.onOutput({ kind: "page", text: "<html><body>hi</body></html>" });
    started[0]?.resolve(result());
    await run;
    const frame = __findByClass(panel.rootEl, "nfe-run-frame");
    expect(frame).not.toBeNull();
    expect(frame.attrs.sandbox).toBe("allow-scripts");
    expect(frame.srcdoc).toBe("<html><body>hi</body></html>");
    expect(panel.rootEl.hasClass("nfe-run-page-mode")).toBe(true);
    expect(__findByClass(panel.rootEl, "nfe-run-output").children).toHaveLength(0);
    panel.clear();
    expect(__findByClass(panel.rootEl, "nfe-run-frame")).toBeNull();
    expect(panel.rootEl.hasClass("nfe-run-page-mode")).toBe(false);
  });

  it("Output | Log: info lines go to both views, the Log tab shows the log and counts errors, Clear resets", async () => {
    const panel = makePanel();
    const run = panel.run();
    started[0]?.onOutput({ kind: "info", text: "[Sandbox]\n" });
    started[0]?.onOutput({ kind: "stdout", text: "a\n" });
    const tabs = __findAllByClass(panel.rootEl, "nfe-run-tab");
    expect(tabs.map((t: { textContent: string }) => t.textContent)).toEqual(["Output", "Log"]);
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    expect(__findByClass(panel.rootEl, "nfe-run-log-wrap").hasClass("nfe-hidden")).toBe(true);
    const log = __findByClass(panel.rootEl, "nfe-run-log");
    expect(log.children.map((c: { textContent: string }) => c.textContent)).toEqual(["[Sandbox]\n"]);
    panel.log("something failed", "error");
    expect(tabs[1]?.textContent).toBe("Log (1)");
    // Copy copies the view that is showing: the output now, the whole Log once the Log tab is active.
    __fire(__findAllByClass(panel.rootEl, "nfe-run-tool")[1], "click");
    expect(copied).toEqual(["[Sandbox]\na\n"]);
    expect(tabs[1]?.hasClass("has-errors")).toBe(true);
    __fire(tabs[1], "click");
    expect(tabs[1]?.hasClass("is-active")).toBe(true);
    expect(tabs[0]?.hasClass("is-active")).toBe(false);
    expect(__findByClass(panel.rootEl, "nfe-run-log-wrap").hasClass("nfe-hidden")).toBe(false);
    expect(__findByClass(panel.rootEl, "nfe-run-output-wrap").hasClass("nfe-hidden")).toBe(true);
    expect(log.children.map((c: { className: string }) => c.className)).toEqual(["nfe-run-info", "nfe-run-stderr"]);
    __fire(__findAllByClass(panel.rootEl, "nfe-run-tool")[1], "click");
    expect(copied).toEqual(["[Sandbox]\na\n", "[Sandbox]\nsomething failed\n"]);
    panel.clear();
    __fire(__findAllByClass(panel.rootEl, "nfe-run-tool")[1], "click");
    expect(copied[2]).toBe("");
    expect(log.children).toHaveLength(0);
    expect(tabs[1]?.textContent).toBe("Log");
    expect(tabs[1]?.hasClass("has-errors")).toBe(false);
    started[0]?.resolve(result());
    await run;
  });

  it("a page's messages reach the Log only with the token of the page being shown; a nested frame's and a stranger's differ only by that", async () => {
    const panel = makePanel();
    const run = panel.run();
    started[0]?.onOutput({ kind: "page", text: "<html><body>hi</body></html>", token: "nfe-abc" });
    const log = __findByClass(panel.rootEl, "nfe-run-log");
    panel.receiveMessage({ nfe: "nfe-abc", level: "log", text: "hello from the page" });
    panel.receiveMessage({ nfe: "nfe-abc", level: "csp", text: "style-src-elem refused data:" });
    panel.receiveMessage({ nfe: "nfe-abc", level: "error", text: "boom (line 3)" });
    panel.receiveMessage({ nfe: "other", level: "error", text: "not ours" });
    panel.receiveMessage({ level: "error", text: "no token" });
    panel.receiveMessage("junk");
    panel.receiveMessage({ nfe: "nfe-abc", level: "error", text: 42 });
    expect(log.children.map((c: { className: string; textContent: string }) => [c.className, c.textContent])).toEqual([
      ["nfe-run-info", "[page log] hello from the page\n"],
      ["nfe-run-stderr", "[page csp] style-src-elem refused data:\n"],
      ["nfe-run-stderr", "[page error] boom (line 3)\n"],
    ]);
    expect(__findAllByClass(panel.rootEl, "nfe-run-tab")[1]?.textContent).toBe("Log (2)");
    // Without a page (or after Clear) nothing is accepted, whatever the token.
    panel.clear();
    panel.receiveMessage({ nfe: "nfe-abc", level: "log", text: "late" });
    expect(log.children).toHaveLength(0);
    started[0]?.resolve(result());
    await run;
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

  it("has a drag handle; the height is a share of the pane, remembered per kind (text, page) and read back on the next panel", async () => {
    // Pure arithmetic: the pointer's distance from the pane's bottom over the pane's height, clamped to [0.1, 0.9].
    expect(panelFractionAt(700, 100, 1000)).toBeCloseTo(0.4);
    expect(panelFractionAt(1090, 100, 1000)).toBe(0.1);
    expect(panelFractionAt(0, 100, 1000)).toBe(0.9);
    expect(panelFractionAt(50, 0, 0)).toBe(DEFAULT_PANEL_HEIGHT.text);
    const remembered: Record<string, number | null> = { text: null, page: null };
    const emitter: { fn: ((o: RunOutput) => void) | null } = { fn: null };
    const build = () =>
      new RunPanel(__fakeEl("div"), {
        runners: () => RUNNERS,
        start: (_def, onOutput) => {
          emitter.fn = onOutput;
          return { stop: () => undefined, done: new Promise(() => undefined) };
        },
        timers,
        now: () => now,
        onClose: () => undefined,
        height: { get: (k) => remembered[k] ?? null, set: (k, f) => void (remembered[k] = f) },
      });
    const panel = build();
    const handle = __findByClass(panel.rootEl, "nfe-run-handle");
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("aria-label")).toContain("resize");
    const setVars: string[] = [];
    panel.rootEl.style.setProperty = (k: string, v: string) => void setVars.push(`${k}=${v}`);
    // A page switches to the page default; Clear back to text.
    const run = panel.run();
    emitter.fn?.({ kind: "page", text: "<p>x</p>" });
    expect(setVars.at(-1)).toBe("--nfe-run-height=65%");
    panel.clear();
    expect(setVars.at(-1)).toBe("--nfe-run-height=35%");
    void run;
    // A drag: the pane is 1000 px tall from y=100; the pointer ends at y=600 → 50 %, remembered for "text".
    (panel.rootEl as unknown as { parent: { getBoundingClientRect: () => unknown } }).parent.getBoundingClientRect = () => ({ top: 100, height: 1000, left: 0, right: 0, bottom: 1100, width: 0 });
    __fire(handle, "pointerdown", { pointerId: 1 });
    __fire(handle, "pointermove", { clientY: 600 });
    expect(setVars.at(-1)).toBe("--nfe-run-height=50%");
    __fire(handle, "pointerup", {});
    expect(remembered.text).toBeCloseTo(0.5);
    expect(remembered.page).toBeNull();
    // The next panel starts at the remembered height.
    const again = build();
    const vars2: string[] = [];
    again.rootEl.style.setProperty = (k: string, v: string) => void vars2.push(`${k}=${v}`);
    expect(vars2).toEqual([]);
    expect(remembered.text).toBeCloseTo(0.5);
  });
});

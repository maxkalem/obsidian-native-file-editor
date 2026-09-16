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

  it("Run starts the selected runner; stdout is the Output, everything is the Log in order; the view opens on the Log and moves to Output with the first result", async () => {
    const panel = makePanel();
    const tabs = __findAllByClass(panel.rootEl, "nfe-run-tab");
    const run = panel.run();
    expect(started).toHaveLength(1);
    expect(started[0]?.def.name).toBe("Sandbox (Web Worker)");
    expect(panel.isRunning).toBe(true);
    expect(__findByClass(panel.rootEl, "nfe-run-button").textContent).toBe("Stop");
    expect(tabs[1]?.hasClass("is-active")).toBe(true);
    started[0]?.onOutput({ kind: "info", text: "[Sandbox]\n" });
    started[0]?.onOutput({ kind: "console", text: "logged\n" });
    expect(tabs[1]?.hasClass("is-active")).toBe(true);
    started[0]?.onOutput({ kind: "stdout", text: "a" });
    started[0]?.onOutput({ kind: "stdout", text: "b\n" });
    started[0]?.onOutput({ kind: "stderr", text: "oops\n" });
    started[0]?.onOutput({ kind: "stdout", text: "c\n" });
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    const spans = __findByClass(panel.rootEl, "nfe-run-output").children;
    expect(spans.map((s: { className: string; textContent: string }) => [s.className, s.textContent])).toEqual([["nfe-run-stdout", "ab\nc\n"]]);
    const log = __findByClass(panel.rootEl, "nfe-run-log").children;
    expect(log.map((s: { className: string; textContent: string }) => [s.className, s.textContent])).toEqual([
      ["nfe-run-info", "[Sandbox]\n"],
      ["nfe-run-stdout", "logged\n"],
      ["nfe-run-stdout", "ab\n"],
      ["nfe-run-stderr", "oops\n"],
      ["nfe-run-stdout", "c\n"],
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
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-log"))).toContain("[could not start: node: not found]");

    run = panel.run();
    started[3]?.resolve(result({ exitCode: 1, step: 1, steps: 2, ms: 800 }));
    await run;
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-status"))).toBe("step 1 of 2 exited with 1, 0.80 s");
  });

  it("stderr is mirrored into the Log; a run that ended badly shows its status in the error colour and ends the Log with a counted error line; a good one ends it with a grey line", async () => {
    const panel = makePanel();
    const status = __findByClass(panel.rootEl, "nfe-run-status");
    const logTab = __findAllByClass(panel.rootEl, "nfe-run-tab")[1];
    const outputTab = __findAllByClass(panel.rootEl, "nfe-run-tab")[0];
    const log = __findByClass(panel.rootEl, "nfe-run-log");
    // A traceback on stderr with exit 1, seen from the Log tab (2026-09-16: "чому у випадку помилки ніяк не видно що є помилка?" — and the Log tab, not the Output tab, is where it should show, as for a page).
    panel.setView("log");
    let run = panel.run();
    started[0]?.onOutput({ kind: "stderr", text: "Traceback (most recent call last):\n" });
    started[0]?.onOutput({ kind: "stderr", text: "ModuleNotFoundError: No module named 'sys1'" });
    expect(outputTab.hasClass("has-errors")).toBe(false);
    // stderr is the Log's as it comes (one span, chunks joined), not the Output's, and not counted.
    expect(__textOf(logTab)).toBe("Log");
    expect(__findByClass(panel.rootEl, "nfe-run-output").children).toHaveLength(0);
    started[0]?.resolve(result({ exitCode: 1, ms: 140 }));
    await run;
    expect(__textOf(status)).toBe("exit 1, 0.14 s");
    expect(status.hasClass("is-error")).toBe(true);
    expect(__textOf(logTab)).toBe("Log (1)");
    expect(logTab.hasClass("has-errors")).toBe(true);
    // The outcome line starts on its own line even after a chunk without a newline.
    expect(log.children.slice(-2).map((c: { className: string; textContent: string }) => [c.className, c.textContent])).toEqual([
      ["nfe-run-stderr", "Traceback (most recent call last):\nModuleNotFoundError: No module named 'sys1'\n"],
      ["nfe-run-stderr", "[exit 1, 0.14 s]\n"],
    ]);
    expect(outputTab.hasClass("has-errors")).toBe(false);
    // With nothing in Output the view stayed on the Log.
    expect(logTab.hasClass("is-active")).toBe(true);
    // Clear takes the marks away; a clean run ends the Log with a grey line and no count.
    panel.clear();
    expect(status.hasClass("is-error")).toBe(false);
    expect(__textOf(logTab)).toBe("Log");
    run = panel.run();
    started[1]?.onOutput({ kind: "stdout", text: "fine\n" });
    started[1]?.resolve(result({ exitCode: 0, ms: 50 }));
    await run;
    expect(__textOf(status)).toBe("exit 0, 0.05 s");
    expect(status.hasClass("is-error")).toBe(false);
    expect(__textOf(logTab)).toBe("Log");
    expect(log.children.map((c: { className: string; textContent: string }) => [c.className, c.textContent]).at(-1)).toEqual(["nfe-run-info", "[exit 0, 0.05 s]\n"]);
    // Timed out, truncated and failed to start are errors; stopped by hand is not.
    run = panel.run();
    started[2]?.resolve(result({ exitCode: null, timedOut: true, ms: 5000 }));
    await run;
    expect(status.hasClass("is-error")).toBe(true);
    expect(__textOf(logTab)).toBe("Log (1)");
    run = panel.run();
    started[3]?.resolve(result({ exitCode: 0, truncated: true, ms: 100 }));
    await run;
    expect(status.hasClass("is-error")).toBe(true);
    run = panel.run();
    started[4]?.resolve(result({ exitCode: null, error: "python: not found", ms: 3 }));
    await run;
    expect(status.hasClass("is-error")).toBe(true);
    expect(log.children.slice(-2).map((c: { className: string; textContent: string }) => [c.className, c.textContent])).toEqual([["nfe-run-info", "[could not start: python: not found]\n"], ["nfe-run-stderr", "[failed to start]\n"]]);
    run = panel.run();
    __fire(__findByClass(panel.rootEl, "nfe-run-button"), "click");
    await run;
    expect(__textOf(status)).toBe("stopped after 0.50 s");
    expect(status.hasClass("is-error")).toBe(false);
    expect(__textOf(logTab)).toBe("Log");
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

  it("Output | Log: info lines go to the Log only, the Log tab counts errors, Copy copies the view showing, a click pins the view, Clear resets", async () => {
    const panel = makePanel();
    const run = panel.run();
    started[0]?.onOutput({ kind: "info", text: "[Sandbox]\n" });
    started[0]?.onOutput({ kind: "stdout", text: "a\n" });
    const tabs = __findAllByClass(panel.rootEl, "nfe-run-tab");
    expect(tabs.map((t: { textContent: string }) => t.textContent)).toEqual(["Output", "Log"]);
    // The first result moved the view to Output.
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    expect(__findByClass(panel.rootEl, "nfe-run-log-wrap").hasClass("nfe-hidden")).toBe(true);
    const log = __findByClass(panel.rootEl, "nfe-run-log");
    expect(log.children.map((c: { textContent: string }) => c.textContent)).toEqual(["[Sandbox]\n", "a\n"]);
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("a\n");
    panel.log("something failed", "error");
    expect(tabs[1]?.textContent).toBe("Log (1)");
    // Copy copies the view that is showing: the output now, the whole Log once the Log tab is active.
    __fire(__findAllByClass(panel.rootEl, "nfe-run-tool")[1], "click");
    expect(copied).toEqual(["a\n"]);
    expect(tabs[1]?.hasClass("has-errors")).toBe(true);
    __fire(tabs[1], "click");
    expect(tabs[1]?.hasClass("is-active")).toBe(true);
    expect(tabs[0]?.hasClass("is-active")).toBe(false);
    expect(__findByClass(panel.rootEl, "nfe-run-log-wrap").hasClass("nfe-hidden")).toBe(false);
    expect(__findByClass(panel.rootEl, "nfe-run-output-wrap").hasClass("nfe-hidden")).toBe(true);
    expect(log.children.map((c: { className: string }) => c.className)).toEqual(["nfe-run-info", "nfe-run-stdout", "nfe-run-stderr"]);
    // A click pinned the view: more output does not pull it back to Output.
    started[0]?.onOutput({ kind: "stdout", text: "b\n" });
    expect(tabs[1]?.hasClass("is-active")).toBe(true);
    __fire(__findAllByClass(panel.rootEl, "nfe-run-tool")[1], "click");
    expect(copied).toEqual(["a\n", "[Sandbox]\na\nsomething failed\nb\n"]);
    panel.clear();
    __fire(__findAllByClass(panel.rootEl, "nfe-run-tool")[1], "click");
    expect(copied[2]).toBe("");
    expect(log.children).toHaveLength(0);
    expect(tabs[1]?.textContent).toBe("Log");
    expect(tabs[1]?.hasClass("has-errors")).toBe(false);
    started[0]?.resolve(result());
    await run;
  });

  it("stdout that is an SVG or HTML document is rendered in the frame when the run ends, with the policy and a token of the panel's; text stdout flows as it comes; cut documents show as text", async () => {
    const panel = makePanel();
    const tabs = __findAllByClass(panel.rootEl, "nfe-run-tab");
    let run = panel.run();
    started[0]?.onOutput({ kind: "info", text: "[python] python.exe file.py\n" });
    started[0]?.onOutput({ kind: "stdout", text: '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">' });
    started[0]?.onOutput({ kind: "stdout", text: '<circle cx="5" cy="5" r="4"/></svg>\n' });
    // Nothing shows until the run ends; the Log is still the view.
    expect(__findByClass(panel.rootEl, "nfe-run-frame")).toBeNull();
    expect(__findByClass(panel.rootEl, "nfe-run-output").children).toHaveLength(0);
    expect(tabs[1]?.hasClass("is-active")).toBe(true);
    started[0]?.resolve(result({ exitCode: 0, ms: 300 }));
    await run;
    const frame = __findByClass(panel.rootEl, "nfe-run-frame");
    expect(frame).not.toBeNull();
    expect(frame.srcdoc).toMatch(/^<!doctype html><html><head><meta http-equiv="Content-Security-Policy"/);
    expect(frame.srcdoc).toContain("<title>SVG output</title>");
    expect(frame.srcdoc).toMatch(/<body>\s*<svg xmlns="http:\/\/www.w3.org\/2000\/svg" width="10" height="10"><circle cx="5" cy="5" r="4"\/><\/svg>\s*<\/body>/);
    expect(frame.srcdoc).not.toContain("<?xml");
    expect(frame.srcdoc).toContain("nfe-out-1000-1");
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    const log = __findByClass(panel.rootEl, "nfe-run-log");
    expect(log.children.map((c: { textContent: string }) => c.textContent)).toEqual(["[python] python.exe file.py\n", "[output] SVG document, 0 KB, rendered\n", "[exit 0, 0.30 s]\n"]);
    // A page's report with that token reaches the Log.
    panel.receiveMessage({ nfe: "nfe-out-1000-1", level: "log", text: "drawn" });
    expect(log.children.at(-1)?.textContent).toBe("[page log] drawn\n");
    // Plain text: decided at once, shown as it comes.
    panel.clear();
    run = panel.run();
    started[1]?.onOutput({ kind: "stdout", text: "Python 3.12\n" });
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("Python 3.12\n");
    expect(tabs[0]?.hasClass("is-active")).toBe(true);
    started[1]?.onOutput({ kind: "stdout", text: "<not a document>\n" });
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("Python 3.12\n<not a document>\n");
    started[1]?.resolve(result());
    await run;
    expect(__findByClass(panel.rootEl, "nfe-run-frame")).toBeNull();
    // Markup that is not a document (an inline tag first) is text too, decided at the first newline.
    panel.clear();
    run = panel.run();
    started[2]?.onOutput({ kind: "stdout", text: "<b>bold</b> and plain\n" });
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("<b>bold</b> and plain\n");
    started[2]?.resolve(result());
    await run;
    // An HTML document, cut by the output cap, is shown as text rather than rendered broken.
    panel.clear();
    run = panel.run();
    started[3]?.onOutput({ kind: "stdout", text: "<!DOCTYPE html><html><body><p>half" });
    started[3]?.resolve(result({ exitCode: 0, truncated: true }));
    await run;
    expect(__findByClass(panel.rootEl, "nfe-run-frame")).toBeNull();
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("<!DOCTYPE html><html><body><p>half");
    // A `<` with nothing decisive yet, and the run ends: text.
    panel.clear();
    run = panel.run();
    started[4]?.onOutput({ kind: "stdout", text: "<sv" });
    expect(__findByClass(panel.rootEl, "nfe-run-output").children).toHaveLength(0);
    started[4]?.resolve(result());
    await run;
    expect(__textOf(__findByClass(panel.rootEl, "nfe-run-output"))).toBe("<sv");
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

  it("has a drag handle; the height is a share of the pane, read once per panel for the runner's kind and never moved by Run, Clear or a page", async () => {
    // Pure arithmetic: the pointer's distance from the pane's bottom over the pane's height, clamped to [0.1, 0.9].
    expect(panelFractionAt(700, 100, 1000)).toBeCloseTo(0.4);
    expect(panelFractionAt(1090, 100, 1000)).toBe(0.1);
    expect(panelFractionAt(0, 100, 1000)).toBe(0.9);
    expect(panelFractionAt(50, 0, 0)).toBe(DEFAULT_PANEL_HEIGHT.text);
    const remembered: Record<string, number | null> = { text: null, page: null };
    const emitter: { fn: ((o: RunOutput) => void) | null } = { fn: null };
    const build = (runners: RunnerDef[] = RUNNERS) => {
      const panel = new RunPanel(__fakeEl("div"), {
        runners: () => runners,
        start: (_def, onOutput) => {
          emitter.fn = onOutput;
          return { stop: () => undefined, done: new Promise(() => undefined) };
        },
        timers,
        now: () => now,
        onClose: () => undefined,
        height: { get: (k) => remembered[k] ?? null, set: (k, f) => void (remembered[k] = f) },
      });
      const vars: string[] = [];
      panel.rootEl.style.setProperty = (k: string, v: string) => void vars.push(`${k}=${v}`);
      return { panel, vars };
    };
    const { panel, vars } = build();
    const handle = __findByClass(panel.rootEl, "nfe-run-handle");
    expect(handle).not.toBeNull();
    expect(handle.getAttribute("aria-label")).toContain("resize");
    // A text runner: the text default was applied when the panel was built, before the spy; nothing since.
    expect(vars).toEqual([]);
    // A page arriving in a text-runner panel does not move the height, nor does Clear (2026-09-15: the user's dragged height was reset by both).
    const run = panel.run();
    emitter.fn?.({ kind: "page", text: "<p>x</p>" });
    expect(__findByClass(panel.rootEl, "nfe-run-frame")).not.toBeNull();
    expect(vars).toEqual([]);
    panel.clear();
    expect(vars).toEqual([]);
    void run;
    // A drag: the pane is 1000 px tall from y=100; the pointer ends at y=600 → 50 %, remembered for the running kind (worker → text).
    (panel.rootEl as unknown as { parent: { getBoundingClientRect: () => unknown } }).parent.getBoundingClientRect = () => ({ top: 100, height: 1000, left: 0, right: 0, bottom: 1100, width: 0 });
    __fire(handle, "pointerdown", { pointerId: 1 });
    __fire(handle, "pointermove", { clientY: 600 });
    expect(vars.at(-1)).toBe("--nfe-run-height=50%");
    __fire(handle, "pointerup", {});
    expect(remembered.text).toBeCloseTo(0.5);
    expect(remembered.page).toBeNull();
    // Another Run after the drag: the height stays where it was dragged.
    void panel.run();
    emitter.fn?.({ kind: "stdout", text: "y" });
    expect(vars.at(-1)).toBe("--nfe-run-height=50%");
    // The next panel starts at the remembered height for its runner's kind: text here (applied before the spy, so no call recorded).
    const second = build();
    expect(second.vars).toEqual([]);
    // A page runner opens at the page height (the default, nothing remembered yet) and a drag there is remembered for "page".
    const pageRunner: RunnerDef[] = [{ language: "HTML", name: "Page (inside Obsidian)", kind: "page" }];
    const third = build(pageRunner);
    expect(third.panel.rootEl.style.getPropertyValue("--nfe-run-height")).toBe("65%");
    const handle3 = __findByClass(third.panel.rootEl, "nfe-run-handle");
    (third.panel.rootEl as unknown as { parent: { getBoundingClientRect: () => unknown } }).parent.getBoundingClientRect = () => ({ top: 100, height: 1000, left: 0, right: 0, bottom: 1100, width: 0 });
    __fire(handle3, "pointerdown", { pointerId: 1 });
    __fire(handle3, "pointermove", { clientY: 300 });
    __fire(handle3, "pointerup", {});
    expect(remembered.page).toBeCloseTo(0.8);
    expect(remembered.text).toBeCloseTo(0.5);
    // Run and Clear on the page panel leave it at 80 %.
    void third.panel.run();
    emitter.fn?.({ kind: "page", text: "<p>z</p>" });
    third.panel.clear();
    expect(third.vars.at(-1)).toBe("--nfe-run-height=80%");
    // A fourth panel with the page runner starts at the remembered 80 %.
    const fourth = build(pageRunner);
    expect(fourth.panel.rootEl.style.getPropertyValue("--nfe-run-height")).toBe("80%");
  });
});

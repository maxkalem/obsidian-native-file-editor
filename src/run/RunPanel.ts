import { t } from "../core/i18n";
import { setIcon } from "obsidian";
import type { Timers } from "../core/autosave";
import type { ExecuteHandle } from "./execute";
import { pageDocument } from "./mhtml";
import type { RunOutput } from "./runner";
import type { RunnerDef } from "./runners";

/**
 * The output panel under the editor: Run/Stop, the runner to use when several
 * match, elapsed time and exit code, the program's text. It talks to
 * `start()` and never to a process or a worker; a test drives it with a fake
 * handle. Output is appended as text (`createSpan` with `text`, then
 * `textContent`), one span per run of the same kind; never `innerHTML`.
 *
 * Two views, Output and Log. Output is the RESULT: a rendered page, or what
 * the program hands out (a process's stdout, a sandbox script's
 * `postMessage`) — rendered in the page frame when it is an SVG or HTML
 * document, shown as text otherwise. Log is the CONSOLE, the whole run in
 * order: the command line and the `[…]` info lines, the program's console
 * (`console.log` as well as `warn`/`error`, a process's stderr, its stdout
 * again when it is text), a page's reports (mhtml.ts `pageReporter`:
 * console, errors, policy refusals, the load line, each frame with the run's
 * token) and the outcome as the last line. The split is the user's
 * (2026-09-16): "console.log це буквально вивід який має попадати в лог", and
 * Output is for something to look at. A run opens on the Log and switches to
 * Output when a result arrives, unless the user picked a view meanwhile. The
 * Log tab counts the problems while Output is showing. Text goes in through
 * `createSpan`/`textContent`; never `innerHTML`.
 */

export interface RunPanelDeps {
  /** The runners that apply to the file, in order; the first is the default. */
  readonly runners: () => readonly RunnerDef[];
  readonly start: (def: RunnerDef, onOutput: (out: RunOutput) => void) => ExecuteHandle;
  readonly timers: Timers;
  readonly now: () => number;
  /** Copy to the clipboard; absent when the platform offers none. */
  readonly copy?: (text: string) => void;
  readonly onClose: () => void;
  /**
   * The panel's height as a share of the pane it sits in, per kind of
   * content (text output, a rendered page), read when the panel is built and
   * written when the user drags the handle. Absent: the defaults below.
   */
  readonly height?: {
    readonly get: (kind: "text" | "page") => number | null;
    readonly set: (kind: "text" | "page", fraction: number) => void;
  };
}

/** The panel's share of the pane until the user drags: a third for text, two thirds for a page. */
export const DEFAULT_PANEL_HEIGHT: Readonly<Record<"text" | "page", number>> = { text: 0.35, page: 0.65 };
const MIN_PANEL_FRACTION = 0.1;
const MAX_PANEL_FRACTION = 0.9;

/**
 * Where the handle is dragged to, as the panel's share of the pane: the pane's
 * bottom minus the pointer, over the pane's height, clamped so neither the
 * editor nor the panel disappears. Pure, for the test.
 */
export function panelFractionAt(pointerY: number, paneTop: number, paneHeight: number): number {
  if (paneHeight <= 0) return DEFAULT_PANEL_HEIGHT.text;
  const fraction = (paneTop + paneHeight - pointerY) / paneHeight;
  return Math.min(MAX_PANEL_FRACTION, Math.max(MIN_PANEL_FRACTION, fraction));
}

/** How often the elapsed-time label refreshes while a run is going. */
const TICK_MS = 250;

/** The kind of content a runner puts in the panel, for the remembered height. */
function kindOf(def: RunnerDef | null): "text" | "page" {
  return def?.kind === "page" ? "page" : "text";
}

/** One class per printed output kind, as plain literals so the styles test sees them. */
const OUTPUT_CLASS: Readonly<Record<Exclude<RunOutput["kind"], "page">, string>> = {
  stdout: "nfe-run-stdout",
  console: "nfe-run-stdout",
  stderr: "nfe-run-stderr",
  info: "nfe-run-info",
};

/** stdout that starts like this is a document to render, not text to print: an SVG, or an HTML page. */
const DOCUMENT_START = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*(?:<!doctype\s+html|<html[\s>]|<svg[\s>])/i;
/** How much of stdout to see before deciding whether it is a document. */
const DOCUMENT_PROBE = 512;

export class RunPanel {
  readonly rootEl: HTMLElement;
  private readonly deps: RunPanelDeps;
  private readonly runButton: HTMLButtonElement;
  private readonly select: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly outputEl: HTMLElement;
  private readonly wrapEl: HTMLElement;
  private readonly logEl: HTMLElement;
  private readonly logWrapEl: HTMLElement;
  private readonly outputTab: HTMLButtonElement;
  private readonly logTab: HTMLButtonElement;
  private view: "output" | "log" = "output";
  private logErrors = 0;
  /** The token of the page shown now; a message without it is somebody else's. */
  private pageToken: string | null = null;
  private readonly onMessage = (evt: { data?: unknown }) => this.receiveMessage(evt.data);
  private handle: ExecuteHandle | null = null;
  private startedAt = 0;
  private ticker: number | null = null;
  private lastKind: RunOutput["kind"] | null = null;
  private lastSpan: HTMLElement | null = null;
  /** The program's output as text (the Output view), for Copy. */
  private text = "";
  /** stdout is held back while it may still be a document: "document" collects in `text` and renders when the run ends, "text" flows to the view as it comes. */
  private docMode: "undecided" | "text" | "document" = "undecided";
  /** The Log as one string, for Copy while the Log is showing. */
  private logText = "";
  /** The span a program stream (console, stderr, stdout) is being written into, so consecutive chunks join; null once a panel line follows. */
  private logStreamSpan: HTMLElement | null = null;
  private logStreamKind: RunOutput["kind"] | null = null;
  /** The user clicked a tab during this run: the panel stops switching views on its own. */
  private viewPinned = false;
  private tokenCounter = 0;

  /** A program stream into the Log as it comes: consecutive chunks of one kind share a span. */
  private logStream(kind: "stdout" | "stderr" | "console", text: string): void {
    this.logText += text;
    if (this.logStreamSpan && this.logStreamKind === kind) this.logStreamSpan.textContent = (this.logStreamSpan.textContent ?? "") + text;
    else {
      this.logStreamSpan = this.logEl.createSpan({ cls: OUTPUT_CLASS[kind], text });
      this.logStreamKind = kind;
    }
    if (this.view === "log") this.logWrapEl.scrollTop = this.logWrapEl.scrollHeight;
  }
  private frame: HTMLIFrameElement | null = null;
  /**
   * What the selected runner shows (text output, a rendered page), for the
   * remembered height: read once when the panel is built, written by a drag.
   * The height itself never moves after that on its own: not on Run, not on
   * Clear, not when a page replaces text (2026-09-15, the user: a height he
   * dragged was reset by every Run and Clear while text and page swapped
   * their remembered values).
   */
  private kind: "text" | "page" = "text";
  /** The height in force, as a share of the pane. */
  private fraction = DEFAULT_PANEL_HEIGHT.text;

  /** `parent` only lends its `createDiv`; the view attaches and re-attaches `rootEl` where it wants it. */
  constructor(parent: HTMLElement, deps: RunPanelDeps) {
    this.deps = deps;
    this.rootEl = parent.createDiv({ cls: "nfe-run-panel" });
    // The handle above the head: drag it to resize; the height is a share of
    // the pane so it survives a window resize, and is remembered per kind.
    const handle = this.rootEl.createDiv({ cls: "nfe-run-handle" });
    handle.setAttribute("aria-label", t("run.resize"));
    handle.addEventListener("pointerdown", (evt: PointerEvent) => {
      evt.preventDefault();
      (handle as HTMLElement & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(evt.pointerId);
      handle.addClass("is-dragging");
      const move = (e: PointerEvent) => {
        const pane = this.rootEl.parentElement?.getBoundingClientRect();
        if (!pane) return;
        this.applyHeight(panelFractionAt(e.clientY, pane.top, pane.height));
      };
      const up = () => {
        handle.removeClass("is-dragging");
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", up);
        handle.removeEventListener("pointercancel", up);
        this.deps.height?.set(this.kind, this.fraction);
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", up);
      handle.addEventListener("pointercancel", up);
    });
    const head = this.rootEl.createDiv({ cls: "nfe-run-head" });
    this.runButton = head.createEl("button", { cls: "nfe-run-button", text: t("run.button") });
    this.runButton.addEventListener("click", () => (this.handle ? this.stop() : void this.run()));
    this.select = head.createEl("select", { cls: "nfe-run-select dropdown" });
    this.select.setAttribute("aria-label", t("run.runner"));
    const tabs = head.createDiv({ cls: "nfe-run-tabs" });
    this.outputTab = tabs.createEl("button", { cls: "nfe-run-tab is-active", text: t("run.tab.output") });
    this.outputTab.setAttribute("aria-label", t("run.tab.output.tooltip"));
    this.outputTab.addEventListener("click", () => this.setView("output", true));
    this.logTab = tabs.createEl("button", { cls: "nfe-run-tab", text: t("run.tab.log") });
    this.logTab.setAttribute("aria-label", t("run.tab.log.tooltip"));
    this.logTab.addEventListener("click", () => this.setView("log", true));
    this.statusEl = head.createSpan({ cls: "nfe-run-status", text: "" });
    const spacer = head.createSpan({ cls: "nfe-run-spacer" });
    spacer.setText("");
    const clear = head.createEl("button", { cls: "nfe-run-tool", text: t("run.clear") });
    clear.addEventListener("click", () => this.clear());
    if (deps.copy) {
      const copy = head.createEl("button", { cls: "nfe-run-tool", text: t("run.copy") });
      copy.setAttribute("aria-label", t("run.copy.tooltip"));
      // Copies what is on screen: the Log when the Log tab is active, else the output.
      copy.addEventListener("click", () => deps.copy?.(this.view === "log" ? this.logText : this.text));
    }
    // A square icon, not a word: the same x the search panel closes with.
    const close = head.createEl("button", { cls: "clickable-icon nfe-run-close" });
    setIcon(close, "x");
    close.setAttribute("aria-label", t("run.close.tooltip"));
    close.setAttribute("data-tooltip-position", "top");
    close.addEventListener("click", () => deps.onClose());
    this.wrapEl = this.rootEl.createDiv({ cls: "nfe-run-output-wrap" });
    this.outputEl = this.wrapEl.createEl("pre", { cls: "nfe-run-output" });
    this.logWrapEl = this.rootEl.createDiv({ cls: "nfe-run-output-wrap nfe-run-log-wrap nfe-hidden" });
    this.logEl = this.logWrapEl.createEl("pre", { cls: "nfe-run-output nfe-run-log" });
    // The page's reports arrive at Obsidian's window (window.top of every frame, nested ones included).
    (globalThis as { window?: { addEventListener?: (t: string, fn: (e: { data?: unknown }) => void) => void } }).window?.addEventListener?.("message", this.onMessage);
    this.refreshRunners();
    this.kind = kindOf(this.selectedRunner());
    this.applyHeight(this.deps.height?.get(this.kind) ?? DEFAULT_PANEL_HEIGHT[this.kind]);
  }

  /** The panel's height as a CSS custom property the stylesheet reads; the class rule stays in styles.css. */
  private applyHeight(fraction: number): void {
    this.fraction = fraction;
    this.rootEl.style.setProperty("--nfe-run-height", `${Math.round(fraction * 1000) / 10}%`);
  }

  get isRunning(): boolean {
    return this.handle !== null;
  }

  /** The runner list may change in settings while the panel is open. */
  refreshRunners(): void {
    const runners = this.deps.runners();
    const previous = this.select.value;
    this.select.empty();
    for (const r of runners) this.select.createEl("option", { text: r.name, value: r.name });
    if (runners.some((r) => r.name === previous)) this.select.value = previous;
    this.select.toggleClass("nfe-hidden", runners.length < 2);
    this.runButton.disabled = runners.length === 0 && this.handle === null;
    this.runButton.title = runners.length === 0 ? t("run.noRunner") : "";
  }

  /** The runner picked in the dropdown, or the first, or null. */
  selectedRunner(): RunnerDef | null {
    const runners = this.deps.runners();
    return runners.find((r) => r.name === this.select.value) ?? runners[0] ?? null;
  }

  async run(): Promise<void> {
    if (this.handle) return;
    const def = this.selectedRunner();
    if (!def) return;
    this.clear();
    // The drag that may follow remembers the height for what this run shows.
    this.kind = kindOf(def);
    // The console first; the result switches the view when it arrives.
    this.viewPinned = false;
    this.setView("log");
    this.startedAt = this.deps.now();
    this.runButton.setText(t("run.stop"));
    this.runButton.addClass("nfe-run-running");
    this.setStatus("running");
    this.tick();
    const handle = this.deps.start(def, (out) => this.append(out));
    this.handle = handle;
    const result = await handle.done;
    if (this.handle !== handle) return;
    this.handle = null;
    this.stopTicker();
    this.runButton.setText(t("run.button"));
    this.runButton.removeClass("nfe-run-running");
    const seconds = (result.ms / 1000).toFixed(result.ms < 10000 ? 2 : 1);
    // A run that did not end well says so in the error colour, and the Log
    // gets the outcome as its last line, counted on the tab when it is bad,
    // the way a page's refusals are (2026-09-16, the user: with the Log
    // showing, a traceback and "exit 1" looked like nothing had happened;
    // then: the Log tab lighting up, as it does for a page, is the logical
    // place). Stopped by hand is not an error.
    let status: string;
    let bad: boolean;
    if (result.error !== null) {
      this.append({ kind: "info", text: `[could not start: ${result.error}]\n` });
      status = t("run.status.failedToStart");
      bad = true;
    } else if (result.stopped) {
      status = t("run.status.stopped", { seconds });
      bad = false;
    } else if (result.timedOut) {
      status = t("run.status.timedOut", { seconds });
      bad = true;
    } else if (result.steps > 1 && result.step < result.steps) {
      status = t("run.status.step", { step: result.step, steps: result.steps, code: String(result.exitCode), seconds });
      bad = true;
    } else {
      status = t("run.status.exit", { code: result.exitCode ?? "?", seconds }) + (result.truncated ? t("run.status.truncated") : "");
      bad = result.exitCode !== 0 || result.truncated;
    }
    if (this.docMode !== "text") this.flushHeldOutput(result.truncated);
    this.setStatus(status, bad);
    this.log(`[${status}]`, bad ? "error" : "info");
    this.refreshRunners();
  }

  stop(): void {
    this.handle?.stop();
  }

  /** Output or Log in the body; the tab says which. `byUser`: a click, which pins the view for the rest of the run. */
  setView(view: "output" | "log", byUser = false): void {
    if (byUser) this.viewPinned = true;
    this.view = view;
    this.wrapEl.toggleClass("nfe-hidden", view !== "output");
    this.logWrapEl.toggleClass("nfe-hidden", view !== "log");
    this.outputTab.toggleClass("is-active", view === "output");
    this.logTab.toggleClass("is-active", view === "log");
  }

  /** A line into the Log; an error or a policy refusal is counted on the tab. */
  log(text: string, level: "info" | "error" = "info"): void {
    if (this.logStreamSpan) {
      // A panel line starts on its own line, whatever the program's last chunk ended with.
      if (!this.logText.endsWith("\n")) {
        this.logStreamSpan.textContent = `${this.logStreamSpan.textContent ?? ""}\n`;
        this.logText += "\n";
      }
      this.logStreamSpan = null;
      this.logStreamKind = null;
    }
    const line = text.endsWith("\n") ? text : `${text}\n`;
    this.logText += line;
    this.logEl.createSpan({ cls: level === "error" ? "nfe-run-stderr" : "nfe-run-info", text: line });
    if (level === "error") {
      this.logErrors++;
      this.logTab.setText(`Log (${this.logErrors})`);
      this.logTab.addClass("has-errors");
    }
    if (this.view === "log") this.logWrapEl.scrollTop = this.logWrapEl.scrollHeight;
  }

  /** A message from a page frame (or a nested one): kept only with this run's token. */
  receiveMessage(data: unknown): void {
    if (!data || typeof data !== "object") return;
    const m = data as { nfe?: unknown; level?: unknown; text?: unknown };
    if (m.nfe !== this.pageToken || this.pageToken === null || typeof m.text !== "string") return;
    const level = typeof m.level === "string" ? m.level : "log";
    this.log(`[page ${level}] ${m.text}`, level === "error" || level === "csp" ? "error" : "info");
  }

  clear(): void {
    this.outputEl.empty();
    this.logEl.empty();
    this.logText = "";
    this.logStreamSpan = null;
    this.logStreamKind = null;
    this.logErrors = 0;
    this.logTab.setText(t("run.tab.log"));
    this.logTab.removeClass("has-errors");
    this.pageToken = null;
    this.frame?.remove();
    this.frame = null;
    this.rootEl.removeClass("nfe-run-page-mode");
    this.lastKind = null;
    this.lastSpan = null;
    this.text = "";
    this.docMode = "undecided";
    if (!this.handle) this.setStatus("");
  }

  destroy(): void {
    this.stop();
    this.stopTicker();
    (globalThis as { window?: { removeEventListener?: (t: string, fn: (e: { data?: unknown }) => void) => void } }).window?.removeEventListener?.("message", this.onMessage);
    this.rootEl.remove();
  }

  private append(out: RunOutput): void {
    if (out.kind === "page") {
      this.showPage(out.text, out.token ?? null);
      return;
    }
    // The Log is the console: a panel line, or the program's own stream. Nothing here is counted on the tab; the count is problems (a bad outcome, a page's errors and refusals).
    if (out.kind === "info") {
      this.log(out.text);
      return;
    }
    if (out.kind === "console" || out.kind === "stderr") {
      this.logStream(out.kind, out.text);
      return;
    }
    // stdout is the result: held back until it is clear whether it is a document (rendered when the run ends) or text (shown as it comes, in the Log too).
    if (this.docMode === "text") {
      this.appendText(out.text);
      return;
    }
    this.text += out.text;
    if (this.docMode === "document") return;
    const probe = this.text.slice(0, DOCUMENT_PROBE);
    if (DOCUMENT_START.test(probe)) this.docMode = "document";
    else if (this.text.length >= DOCUMENT_PROBE || (/\S/.test(probe) && !/^\s*</.test(probe)) || /<[^>]*>[\s\S]*\n/.test(probe)) this.flushHeldOutput(false);
    // Else: blank so far, or a `<` with nothing decisive after it yet; wait for more (or for the end of the run).
  }

  /** What was held back turns out to be text (or the run is over): into the view. A held document renders instead. */
  private flushHeldOutput(truncated: boolean): void {
    const held = this.text;
    this.text = "";
    if (this.docMode === "document" && !truncated) {
      this.docMode = "text";
      this.renderDocument(held);
      return;
    }
    this.docMode = "text";
    if (held.length > 0) this.appendText(held);
  }

  /** A chunk of text output into the Output view (one span per run of stdout) and the Log. */
  private appendText(chunk: string): void {
    this.text += chunk;
    this.logStream("stdout", chunk);
    if (this.lastSpan && this.lastKind === "stdout") {
      this.lastSpan.textContent = (this.lastSpan.textContent ?? "") + chunk;
    } else {
      this.lastSpan = this.outputEl.createSpan({ cls: OUTPUT_CLASS.stdout, text: chunk });
      this.lastKind = "stdout";
    }
    const wrap = this.outputEl.parentElement;
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
    if (!this.viewPinned) this.setView("output");
  }

  /**
   * stdout that was a document: rendered in the page frame with the policy
   * and a token of this panel's, so a script inside it reports to the Log
   * like any page. An XML prolog is dropped: the frame parses srcdoc as
   * HTML and would show it as text.
   */
  private renderDocument(doc: string): void {
    const kind = /^\s*(?:<\?xml[^>]*>\s*)?(?:<!--[\s\S]*?-->\s*)*<svg[\s>]/i.test(doc) ? "SVG" : "HTML";
    this.log(`[output] ${kind} document, ${(doc.length / 1024).toFixed(0)} KB, rendered`);
    const token = `nfe-out-${this.deps.now()}-${++this.tokenCounter}`;
    const body = doc.replace(/^\s*<\?xml[^>]*>/i, "");
    // A bare SVG gets a page around it with a title (the load line names it) and no margin; an HTML document is its own page.
    const html = kind === "SVG" ? `<!doctype html><html><head><title>SVG output</title><style>body{margin:0}</style></head><body>${body}</body></html>` : body;
    this.showPage(pageDocument(html, token), token);
  }

  /**
   * A web page rendered in the panel: an iframe whose `sandbox` allows scripts
   * and nothing else (no same-origin access, so the page lives in an opaque
   * origin with no way to Obsidian's window, storage or Electron; no forms,
   * popups, navigation or modals), and the document as `srcdoc`, whose CSP
   * (run/mhtml.ts) lets nothing load from anywhere. Scripts were off until
   * 2026-09-07; saved pages are interactive (a sudoku, say), and a script in
   * an opaque origin without network is what the JavaScript sandbox already
   * grants a Worker. The panel keeps whatever height it has; a page runner
   * opens the panel at the remembered page height (the constructor).
   */
  private showPage(html: string, token: string | null): void {
    this.frame?.remove();
    this.pageToken = token;
    const frame = this.wrapEl.createEl("iframe", { cls: "nfe-run-frame" });
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Page");
    frame.addEventListener("load", () => this.log("[frame] the page's frame finished loading"));
    frame.srcdoc = html;
    this.frame = frame;
    this.rootEl.addClass("nfe-run-page-mode");
    // The page is the output (Copy hands it over); nothing is held back any more.
    this.docMode = "text";
    this.text = html;
    if (!this.viewPinned) this.setView("output");
  }

  private setStatus(text: string, error = false): void {
    this.statusEl.setText(text);
    this.statusEl.toggleClass("is-error", error);
  }

  private tick(): void {
    this.ticker = this.deps.timers.setTimeout(() => {
      if (!this.handle) return;
      this.setStatus(`running, ${((this.deps.now() - this.startedAt) / 1000).toFixed(1)} s`);
      this.tick();
    }, TICK_MS);
  }

  private stopTicker(): void {
    if (this.ticker !== null) this.deps.timers.clearTimeout(this.ticker);
    this.ticker = null;
  }
}

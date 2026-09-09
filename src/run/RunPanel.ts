import { setIcon } from "obsidian";
import type { Timers } from "../core/autosave";
import type { ExecuteHandle } from "./execute";
import type { RunOutput } from "./runner";
import type { RunnerDef } from "./runners";

/**
 * The output panel under the editor: Run/Stop, the runner to use when several
 * match, elapsed time and exit code, the program's text. It talks to
 * `start()` and never to a process or a worker; a test drives it with a fake
 * handle. Output is appended as text (`createSpan` with `text`, then
 * `textContent`), one span per run of the same kind; never `innerHTML`.
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

/** One class per printed output kind, as plain literals so the styles test sees them. */
const OUTPUT_CLASS: Readonly<Record<Exclude<RunOutput["kind"], "page">, string>> = {
  stdout: "nfe-run-stdout",
  stderr: "nfe-run-stderr",
  info: "nfe-run-info",
};

export class RunPanel {
  readonly rootEl: HTMLElement;
  private readonly deps: RunPanelDeps;
  private readonly runButton: HTMLButtonElement;
  private readonly select: HTMLSelectElement;
  private readonly statusEl: HTMLElement;
  private readonly outputEl: HTMLElement;
  private readonly wrapEl: HTMLElement;
  private handle: ExecuteHandle | null = null;
  private startedAt = 0;
  private ticker: number | null = null;
  private lastKind: RunOutput["kind"] | null = null;
  private lastSpan: HTMLElement | null = null;
  private text = "";
  private frame: HTMLIFrameElement | null = null;
  /** What the panel shows, for the remembered height. */
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
    handle.setAttribute("aria-label", "Drag to resize the output panel");
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
    this.runButton = head.createEl("button", { cls: "nfe-run-button", text: "Run" });
    this.runButton.addEventListener("click", () => (this.handle ? this.stop() : void this.run()));
    this.select = head.createEl("select", { cls: "nfe-run-select dropdown" });
    this.select.setAttribute("aria-label", "Runner");
    this.statusEl = head.createSpan({ cls: "nfe-run-status", text: "" });
    const spacer = head.createSpan({ cls: "nfe-run-spacer" });
    spacer.setText("");
    const clear = head.createEl("button", { cls: "nfe-run-tool", text: "Clear" });
    clear.addEventListener("click", () => this.clear());
    if (deps.copy) {
      const copy = head.createEl("button", { cls: "nfe-run-tool", text: "Copy" });
      copy.addEventListener("click", () => deps.copy?.(this.text));
    }
    // A square icon, not a word: the same x the search panel closes with (USER, 2026-09-09).
    const close = head.createEl("button", { cls: "clickable-icon nfe-run-close" });
    setIcon(close, "x");
    close.setAttribute("aria-label", "Close the output panel");
    close.setAttribute("data-tooltip-position", "top");
    close.addEventListener("click", () => deps.onClose());
    this.wrapEl = this.rootEl.createDiv({ cls: "nfe-run-output-wrap" });
    this.outputEl = this.wrapEl.createEl("pre", { cls: "nfe-run-output" });
    this.refreshRunners();
    this.applyHeight(this.deps.height?.get("text") ?? DEFAULT_PANEL_HEIGHT.text);
  }

  /** The panel's height as a CSS custom property the stylesheet reads; the class rule stays in styles.css. */
  private applyHeight(fraction: number): void {
    this.fraction = fraction;
    this.rootEl.style.setProperty("--nfe-run-height", `${Math.round(fraction * 1000) / 10}%`);
  }

  /** Text and a page have their own remembered heights; switching kinds switches the height. */
  private setKind(kind: "text" | "page"): void {
    if (this.kind === kind) return;
    this.kind = kind;
    this.applyHeight(this.deps.height?.get(kind) ?? DEFAULT_PANEL_HEIGHT[kind]);
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
    this.runButton.title = runners.length === 0 ? "No runner for this file; add one in settings" : "";
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
    this.startedAt = this.deps.now();
    this.runButton.setText("Stop");
    this.runButton.addClass("nfe-run-running");
    this.setStatus("running");
    this.tick();
    const handle = this.deps.start(def, (out) => this.append(out));
    this.handle = handle;
    const result = await handle.done;
    if (this.handle !== handle) return;
    this.handle = null;
    this.stopTicker();
    this.runButton.setText("Run");
    this.runButton.removeClass("nfe-run-running");
    const seconds = (result.ms / 1000).toFixed(result.ms < 10000 ? 2 : 1);
    if (result.error !== null) {
      this.append({ kind: "info", text: `[could not start: ${result.error}]\n` });
      this.setStatus(`failed to start`);
    } else if (result.stopped) this.setStatus(`stopped after ${seconds} s`);
    else if (result.timedOut) this.setStatus(`timed out after ${seconds} s`);
    else if (result.steps > 1 && result.step < result.steps) this.setStatus(`step ${result.step} of ${result.steps} exited with ${result.exitCode}, ${seconds} s`);
    else this.setStatus(`exit ${result.exitCode ?? "?"}, ${seconds} s${result.truncated ? ", output truncated" : ""}`);
    this.refreshRunners();
  }

  stop(): void {
    this.handle?.stop();
  }

  clear(): void {
    this.outputEl.empty();
    this.frame?.remove();
    this.frame = null;
    this.rootEl.removeClass("nfe-run-page-mode");
    this.setKind("text");
    this.lastKind = null;
    this.lastSpan = null;
    this.text = "";
    if (!this.handle) this.setStatus("");
  }

  destroy(): void {
    this.stop();
    this.stopTicker();
    this.rootEl.remove();
  }

  private append(out: RunOutput): void {
    if (out.kind === "page") {
      this.showPage(out.text);
      return;
    }
    this.text += out.text;
    if (this.lastSpan && this.lastKind === out.kind) {
      this.lastSpan.textContent = (this.lastSpan.textContent ?? "") + out.text;
    } else {
      this.lastSpan = this.outputEl.createSpan({ cls: OUTPUT_CLASS[out.kind], text: out.text });
      this.lastKind = out.kind;
    }
    const wrap = this.outputEl.parentElement;
    if (wrap) wrap.scrollTop = wrap.scrollHeight;
  }

  /**
   * A web page rendered in the panel: an iframe whose `sandbox` allows scripts
   * and nothing else (no same-origin access, so the page lives in an opaque
   * origin with no way to Obsidian's window, storage or Electron; no forms,
   * popups, navigation or modals), and the document as `srcdoc`, whose CSP
   * (run/mhtml.ts) lets nothing load from anywhere. Scripts were off until
   * 2026-09-07; the user's pages are interactive (a sudoku), and a script in
   * an opaque origin without network is what the JavaScript sandbox already
   * grants a Worker. The panel grows to page size while it shows one.
   */
  private showPage(html: string): void {
    this.frame?.remove();
    const frame = this.wrapEl.createEl("iframe", { cls: "nfe-run-frame" });
    frame.setAttribute("sandbox", "allow-scripts");
    frame.setAttribute("referrerpolicy", "no-referrer");
    frame.setAttribute("title", "Page");
    frame.srcdoc = html;
    this.frame = frame;
    this.rootEl.addClass("nfe-run-page-mode");
    this.setKind("page");
    this.text = html;
  }

  private setStatus(text: string): void {
    this.statusEl.setText(text);
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

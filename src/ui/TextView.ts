import { FileView, Keymap, type Menu, Notice, Scope, type TFile, type WorkspaceLeaf, setIcon, setTooltip } from "obsidian";
import { AUTOSAVE_DELAY_MS, VIEW_TYPE_TEXT } from "../constants";
import { Autosave, type Timers } from "../core/autosave";
import type { Logger } from "../core/log";
import { type ViewMode, decideOpenMode } from "../core/openMode";
import { OBSIDIAN_SCHEME_CLASS } from "../highlight/highlighter";
import { type ResolvedLanguage, languageFor, resolveLanguage } from "../highlight/registry";
import {
  type DecodedText,
  UnencodableError,
  confirmEncoding,
  decodeText,
  describeEncoding,
  describeLineEnding,
  encodeText,
  utf8CopyInfo,
} from "../model/text/encoding";
import { newFilePath } from "../core/newFile";
import { ReadOnlyModal } from "./ReadOnlyModal";
import { type Transport, TransportError } from "../platform/transport";
import type { ExecuteHandle, ExecuteRequest } from "../run/execute";
import { RunPanel } from "../run/RunPanel";
import type { RunnerDef } from "../run/runners";
import type { DeviceLocalStore } from "../settings/DeviceLocalStore";
import type { SharedSettings } from "../settings/settings";
import { LargeFileModal, formatBytes } from "./LargeFileModal";
import type { EditorFactory, EditorHandle } from "./editor";

/**
 * What the view needs to run the file it shows (ADR-004). Absent on mobile and
 * when the device has Run turned off: then there is no button, no panel and
 * no command. The view never sees a process; `execute` does.
 */
export interface RunViewDeps {
  readonly enabled: () => boolean;
  readonly runnersFor: (extension: string) => readonly RunnerDef[];
  /** The file's absolute OS path, folder and stem, or null when this device cannot say. */
  readonly locate: (vaultPath: string) => { file: string; dir: string; stem: string } | null;
  readonly execute: (req: ExecuteRequest) => ExecuteHandle;
  readonly timeoutMs: () => number;
  readonly outputCapBytes: () => number;
  readonly copy?: (text: string) => void;
}

export interface TextViewDeps {
  readonly settings: () => SharedSettings;
  readonly device: DeviceLocalStore;
  readonly transport: Transport;
  readonly editorFactory: EditorFactory;
  readonly timers: Timers;
  readonly now: () => number;
  readonly log: Logger;
  /** Called after every successful write with the vault path; the plugin reloads palettes saved from inside Obsidian. */
  readonly afterSave?: (path: string) => void;
  /**
   * Called when a file Obsidian lists is not on disk any more (renamed or
   * deleted outside Obsidian while its watcher missed it): the plugin asks
   * Obsidian to drop the stale index entry so the explorer stops showing it.
   */
  readonly onMissing?: (path: string) => void;
  /** Called when the pane menu flips Word wrap: the plugin stores it as the shared setting. */
  readonly setWordWrap?: (on: boolean) => void;
  /** Called when the header button or the pane menu flips Show invisibles: the plugin stores it as the shared setting. */
  readonly setShowInvisibles?: (on: boolean) => void;
  /** Called when the pane menu picks a text direction: the plugin stores it as the shared setting. */
  readonly setTextDirection?: (direction: SharedSettings["textDirection"]) => void;
  /** F2 or a click on the title: Obsidian's own rename dialog for the file. */
  readonly rename?: (file: TFile) => void;
  /**
   * The read-only modal's "Create UTF-8 copy": whether a vault path is taken,
   * and the write that makes Obsidian index the new file at once. The view
   * then opens the copy in its own leaf.
   */
  readonly copy?: {
    readonly exists: (path: string) => boolean;
    readonly create: (path: string, bytes: Uint8Array) => Promise<TFile>;
  };
  readonly run?: RunViewDeps;
}

/**
 * How long after this view's own write a `modify` event is taken as the echo
 * of that write rather than an external change.
 */
const SELF_WRITE_ECHO_MS = 1500;

/**
 * One pane for every text and code file: a preview that renders in under a
 * frame, and an editor built when asked for. The view never sees bytes beyond
 * handing them to the text model; the transport is the only thing that knows
 * where the file lives.
 *
 * Every field the view owns carries the `nfe` prefix: a generic name on a
 * FileView subclass can shadow an untyped runtime member of Obsidian's own
 * class, and tsc cannot see it.
 */
export class TextView extends FileView {
  private readonly nfeDeps: TextViewDeps;
  private readonly nfeHeadEl: HTMLElement;
  private readonly nfeBodyEl: HTMLElement;
  private nfeDoc: DecodedText | null = null;
  private nfeSizeBytes = 0;
  private nfeMode: ViewMode = "preview";
  private nfeLarge = false;
  private nfeEditor: EditorHandle | null = null;
  private nfeAutosave: Autosave | null = null;
  private nfeLastWriteAt = 0;
  private nfeLoadedPath: string | null = null;
  private nfeLanguage: ResolvedLanguage | null = null;
  private nfeRunPanel: RunPanel | null = null;
  /** The last save the encoding refused, shown in the head until a save succeeds. */
  private nfeSaveProblem: UnencodableError | null = null;
  /** The three header actions; their icon and label follow the state (nfeSyncActions). */
  private readonly nfeSearchAction: HTMLElement;
  private readonly nfeModeAction: HTMLElement;
  private readonly nfeInvisiblesAction: HTMLElement;

  constructor(leaf: WorkspaceLeaf, deps: TextViewDeps) {
    super(leaf);
    this.nfeDeps = deps;
    this.navigation = true;
    this.contentEl.addClass("nfe-text-content");
    this.nfeHeadEl = this.contentEl.createDiv({ cls: "nfe-head" });
    this.nfeBodyEl = this.contentEl.createDiv({ cls: "nfe-body" });
    // Header actions are added right to left; the mode toggle sits next to the
    // three dots, the search button to its left, the invisibles toggle left of that.
    this.nfeModeAction = this.addAction("pencil", "Edit", () => {
      void this.toggleMode();
    });
    this.nfeSearchAction = this.addAction("search", "Search", () => this.toggleSearch());
    this.nfeInvisiblesAction = this.addAction("pilcrow", "Show invisibles", () => this.toggleInvisibles());
    // Obsidian's keymap listens on the window in the capture phase and takes
    // Mod+F for "Search current file" before CodeMirror's keymap sees it; a
    // scope on the view is consulted first while the pane is active, which is
    // how CM Code Editor gets the same keys.
    // One handler for every key, matched on the PHYSICAL key (`evt.code`), so
    // Ctrl+F is Ctrl+F on a Ukrainian layout too: Obsidian's Scope matches a
    // named key against `evt.key`, which is the layout's letter. Registered
    // with null modifiers and a null key so that a key this handler does not
    // take falls through to the other bindings and to Obsidian's own.
    this.scope = new Scope(this.app.scope);
    this.scope.register(null, null, (evt) => {
      if (!this.nfeEditor) return;
      const action = this.nfeKeyAction(evt);
      if (!action) return;
      evt.preventDefault();
      action();
      return false;
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.file && file.path === this.file.path) void this.nfeOnExternalModify();
      })
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (this.nfeLoadedPath !== null && file.path === this.nfeLoadedPath) void this.nfeOnDeleted(file.path);
      })
    );
  }

  override getViewType(): string {
    return VIEW_TYPE_TEXT;
  }

  /** A click on the tab's title renames the file, as it does on a note. The element exists once the view is open. */
  override async onOpen(): Promise<void> {
    await super.onOpen();
    const title = this.containerEl.querySelector<HTMLElement>(".view-header-title");
    if (title) {
      title.addClass("nfe-title-renamable");
      this.registerDomEvent(title, "click", () => this.renameFile());
    }
  }

  override getDisplayText(): string {
    return this.file?.basename ?? "Text";
  }

  override getIcon(): string {
    return "file-text";
  }

  override canAcceptExtension(extension: string): boolean {
    return languageFor(extension) !== null;
  }

  get mode(): ViewMode {
    return this.nfeMode;
  }

  /**
   * Nothing may escape from here: an exception out of onLoadFile is what
   * Obsidian reports as "Failed to open", with no way to tell why. Every step
   * that can fail is caught, logged, and degraded (no language, plain preview,
   * an error panel) rather than thrown.
   */
  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.nfeLoadedPath = file.path;
    try {
      await this.nfeLoad(file);
    } catch (e) {
      this.nfeDeps.log.error("view", `open ${file.path} failed`, e);
      this.nfeRenderError(`Cannot open ${file.path}: ${e instanceof Error ? e.message : String(e)}. Details are in the plugin log.`);
    }
  }

  private async nfeLoad(file: TFile): Promise<void> {
    const log = this.nfeDeps.log;
    let bytes: Uint8Array;
    try {
      bytes = await this.nfeDeps.transport.readBinary(file.path);
    } catch (e) {
      if (e instanceof TransportError && e.code === "not-found") {
        // Obsidian's index still lists a file the disk no longer has: the
        // explorer entry is stale (open item 9). Say so and let the plugin
        // ask Obsidian to reconcile it.
        log.info("view", `${file.path} is listed by Obsidian but not on disk; asking Obsidian to drop the stale entry`);
        this.nfeRenderError(`${file.path} no longer exists on disk. The file list was out of date; it has been refreshed.`);
        this.nfeDeps.onMissing?.(file.path);
        return;
      }
      log.error("view", `read ${file.path} failed`, e);
      this.nfeRenderError(`Cannot read ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // The file may have been swapped while the read was in flight.
    if (this.nfeLoadedPath !== file.path) return;
    this.nfeSizeBytes = bytes.byteLength;
    this.nfeDoc = decodeText(bytes);
    const entry = languageFor(file.extension);
    this.nfeLanguage = null;
    if (entry) {
      try {
        this.nfeLanguage = resolveLanguage(entry);
      } catch (e) {
        log.error("lang", `${entry.name} (${entry.source}) failed to load; opening ${file.path} as plain text`, e);
        new Notice(`Native File Editor: the ${entry.name} language failed to load; ${file.name} opened as plain text.`);
      }
    }
    const settings = this.nfeDeps.settings();
    const device = this.nfeDeps.device.get();
    const decision = decideOpenMode({
      setting: settings.initialMode,
      remembered: device.lastMode[file.path] ?? null,
      sizeBytes: this.nfeSizeBytes,
      largeFileBytes: device.largeFileBytes,
      lossy: this.nfeDoc.info.lossy,
    });
    this.nfeLarge = decision.large;
    log.info(
      "view",
      `open ${file.path}: ${formatBytes(this.nfeSizeBytes)}, ${describeEncoding(this.nfeDoc.info)}, ${describeLineEnding(this.nfeDoc.info.eol)}, language ${entry ? `${entry.name}/${entry.source ?? "plain"}` : "none"}${this.nfeLanguage ? "" : " (no highlighter)"}, mode ${decision.mode}${decision.large ? " (large)" : ""}`
    );
    if (decision.large) {
      new Notice(`${file.name} is ${formatBytes(this.nfeSizeBytes)}; opened as a preview.`);
    }
    this.nfeAutosave = new Autosave({
      delayMs: AUTOSAVE_DELAY_MS,
      timers: this.nfeDeps.timers,
      save: () => this.nfeSave(),
      onError: (e) => {
        log.error("save", `${file.path} failed`, e);
        // A character the confirmed code page cannot hold: the text stays in
        // the editor, marked unsaved, and the next change tries again.
        if (e instanceof UnencodableError) {
          // The head gets a red badge naming the character and its line; the
          // editor marks and selects the character. Both go when a save succeeds.
          this.nfeSaveProblem = e;
          this.nfeRenderHead();
          this.nfeEditor?.markProblem({ line: e.line, column: e.column, length: e.char.length });
        } else {
          new Notice(`Native File Editor could not save ${file.name}: ${e instanceof Error ? e.message : String(e)}`);
        }
      },
    });
    if (this.nfeRunAvailable() && device.runPanelOpen[file.path] === true) this.nfeOpenRunPanel(false);
    this.nfeShow(decision.mode);
  }

  /** Run is on this device, turned on, and knows a runner for this file. */
  nfeRunAvailable(): boolean {
    const run = this.nfeDeps.run;
    if (!run || !this.file || !run.enabled()) return false;
    return run.runnersFor(this.file.extension).length > 0;
  }

  get runPanelOpen(): boolean {
    return this.nfeRunPanel !== null;
  }

  get running(): boolean {
    return this.nfeRunPanel?.isRunning ?? false;
  }

  /** The Run button and the command: save what the editor holds, open the panel, start the selected runner. */
  async runFile(): Promise<void> {
    if (!this.nfeRunAvailable() || !this.nfeDoc) return;
    await this.nfeAutosave?.flush();
    this.nfeOpenRunPanel(true);
    await this.nfeRunPanel?.run();
  }

  stopRun(): void {
    this.nfeRunPanel?.stop();
  }

  toggleRunPanel(): void {
    if (this.nfeRunPanel) this.nfeCloseRunPanel();
    else if (this.nfeRunAvailable()) this.nfeOpenRunPanel(true);
  }

  private nfeOpenRunPanel(remember: boolean): void {
    const run = this.nfeDeps.run;
    if (this.nfeRunPanel || !run || !this.file) return;
    const panel = new RunPanel(this.nfeBodyEl, {
      runners: () => (this.file ? run.runnersFor(this.file.extension) : []),
      start: (def, onOutput) => {
        const path = this.nfeLoadedPath ?? this.file?.path ?? "";
        const where = run.locate(path);
        const text = this.nfeEditor?.getText() ?? this.nfeDoc?.text ?? "";
        if (!where) {
          return {
            stop: () => undefined,
            done: Promise.resolve({ exitCode: null, timedOut: false, stopped: false, truncated: false, ms: 0, error: "this device cannot resolve the file's path", step: 0, steps: 0 }),
          };
        }
        this.nfeDeps.log.info("run", `${path} with ${def.name}`);
        return run.execute({ def, ...where, text, timeoutMs: run.timeoutMs(), outputCapBytes: run.outputCapBytes(), onOutput });
      },
      timers: this.nfeDeps.timers,
      now: this.nfeDeps.now,
      copy: run.copy,
      onClose: () => this.nfeCloseRunPanel(),
    });
    this.nfeRunPanel = panel;
    this.nfeSyncRunButton();
    if (remember) this.nfeDeps.device.rememberRunPanel(this.file.path, true);
  }

  private nfeCloseRunPanel(): void {
    if (!this.nfeRunPanel) return;
    this.nfeRunPanel.destroy();
    this.nfeRunPanel = null;
    this.nfeSyncRunButton();
    if (this.file) this.nfeDeps.device.rememberRunPanel(this.file.path, false);
  }

  override async onUnloadFile(file: TFile): Promise<void> {
    await this.nfeTeardown();
    if (this.nfeLoadedPath === file.path) this.nfeLoadedPath = null;
    await super.onUnloadFile(file);
  }

  override async onClose(): Promise<void> {
    await this.nfeTeardown();
    await super.onClose();
  }

  /** The command and the header action both land here. */
  async toggleMode(): Promise<void> {
    await this.setMode(this.nfeMode === "preview" ? "edit" : "preview");
  }

  /** `<name> (utf-8).<ext>` beside the file, numbered while taken (`newFilePath`). */
  private nfeCopyPath(file: TFile): string {
    const folder = file.parent?.path ?? "";
    return newFilePath(folder, `${file.basename} (utf-8)`, file.extension, (p) => this.nfeDeps.copy?.exists(p) ?? false);
  }

  /**
   * The read-only modal's first action: the text as UTF-8 without a BOM, with
   * the file's line ending, written beside the original, then opened in this
   * leaf in the editor. The original is not touched.
   */
  async createUtf8Copy(): Promise<void> {
    const copy = this.nfeDeps.copy;
    if (!this.nfeDoc || !this.file || !copy) return;
    const from = this.file;
    const path = this.nfeCopyPath(from);
    try {
      const bytes = encodeText(this.nfeDoc.text, utf8CopyInfo(this.nfeDoc.info));
      const file = await copy.create(path, bytes);
      this.nfeDeps.log.info("view", `${from.path}: UTF-8 copy written to ${path} (${bytes.byteLength} B)`);
      await this.leaf.openFile(file);
      const view = this.leaf.view;
      if (view instanceof TextView) await view.setMode("edit");
    } catch (e) {
      this.nfeDeps.log.error("view", `${from.path}: UTF-8 copy to ${path} failed`, e);
      new Notice(`Native File Editor could not create ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * The read-only modal's second action: the user says the guess is right, so
   * the same encoding is written back from now on. The badge loses its
   * "(guess)" and the red mark; the editor opens editable.
   */
  async editInGuessedEncoding(): Promise<void> {
    if (!this.nfeDoc || !this.file) return;
    this.nfeDoc = { text: this.nfeDoc.text, info: confirmEncoding(this.nfeDoc.info) };
    this.nfeDeps.log.info("view", `${this.file.path}: encoding ${this.nfeDoc.info.encoding} confirmed by the user; editing`);
    this.nfeShow("edit");
    if (this.nfeDeps.settings().initialMode === "remember") this.nfeDeps.device.rememberMode(this.file.path, "edit");
  }

  /**
   * What a key does in this pane, by physical key: Mod+F and Mod+H open the
   * search panel (H is "replace" elsewhere; the panel has both rows), F3 and
   * Mod+G move to the next match, Shift+F3 and Shift+Mod+G to the previous,
   * F2 renames the file. Null when the key is not this pane's.
   */
  nfeKeyAction(evt: KeyboardEvent): (() => void) | null {
    const mod = Keymap.isModifier(evt, "Mod");
    const shift = evt.shiftKey;
    if (evt.altKey) return null;
    switch (evt.code) {
      case "KeyF":
      case "KeyH":
        return mod && !shift ? () => this.openSearch() : null;
      case "KeyG":
        return mod ? () => (shift ? this.nfeEditor?.findPrevious() : this.nfeEditor?.findNext()) : null;
      case "F3":
        return !mod ? () => (shift ? this.nfeEditor?.findPrevious() : this.nfeEditor?.findNext()) : null;
      case "F2":
        return !mod && !shift ? () => this.renameFile() : null;
      default:
        return null;
    }
  }

  /** F2, or a click on the tab's title: Obsidian's rename dialog, as a Markdown note has. */
  renameFile(): void {
    if (this.file) this.nfeDeps.rename?.(this.file);
  }

  /** The search panel works in both modes; in preview it finds and cannot replace. */
  openSearch(): void {
    this.nfeEditor?.openSearch();
  }

  closeSearch(): void {
    this.nfeEditor?.closeSearch();
  }

  toggleSearch(): void {
    if (!this.nfeEditor) return;
    if (this.nfeEditor.isSearchOpen()) this.nfeEditor.closeSearch();
    else this.nfeEditor.openSearch();
  }

  get searchOpen(): boolean {
    return this.nfeEditor?.isSearchOpen() ?? false;
  }

  /** Word wrap from the pane menu: live in this editor, stored as the shared setting for every other. */
  setWordWrap(on: boolean): void {
    this.nfeEditor?.setWordWrap(on);
    this.nfeDeps.setWordWrap?.(on);
  }

  /** Invisibles (spaces, tabs, line ends) from the header button or the menu: live here, stored as the shared setting. */
  setShowInvisibles(on: boolean): void {
    this.nfeEditor?.setInvisibles(on);
    this.nfeDeps.setShowInvisibles?.(on);
    this.nfeSyncActions();
  }

  toggleInvisibles(): void {
    this.setShowInvisibles(!this.nfeDeps.settings().showInvisibles);
  }

  /** Text direction from the pane menu: live here, stored as the shared setting. */
  setTextDirection(direction: SharedSettings["textDirection"]): void {
    this.nfeEditor?.setTextDirection(direction);
    this.nfeDeps.setTextDirection?.(direction);
  }

  /** The header's two buttons say what a click will do, not what the state is. */
  private nfeSyncActions(): void {
    // The same pair Obsidian's own header uses: the book while editing (click
    // for the reading view), the pencil while reading (click to edit).
    const editing = this.nfeMode === "edit";
    setIcon(this.nfeModeAction, editing ? "book-open" : "pencil");
    setTooltip(this.nfeModeAction, editing ? "Reading view" : "Editing view");
    const open = this.searchOpen;
    setIcon(this.nfeSearchAction, open ? "search-x" : "search");
    setTooltip(this.nfeSearchAction, open ? "Close search" : "Search");
    this.nfeSearchAction.toggleClass("is-active", open);
    const marks = this.nfeDeps.settings().showInvisibles;
    setTooltip(this.nfeInvisiblesAction, marks ? "Hide invisibles" : "Show invisibles");
    this.nfeInvisiblesAction.toggleClass("is-active", marks);
  }

  /**
   * The three-dots menu, in the shape of Obsidian's own: both views with a
   * check on the active one, a separator, then the pane's switches (search,
   * wrap, invisibles, direction) and Run. No sections: Obsidian sorts its own
   * items by section and appends the rest in order, separators included.
   */
  override onPaneMenu(menu: Menu, source: string): void {
    super.onPaneMenu(menu, source);
    if (!this.nfeDoc) return;
    const editing = this.nfeMode === "edit";
    menu.addItem((item) =>
      item
        .setTitle("Reading view")
        .setIcon("book-open")
        .setChecked(!editing)
        .onClick(() => void this.setMode("preview"))
    );
    menu.addItem((item) =>
      item
        .setTitle("Editing view")
        .setIcon("pencil")
        .setChecked(editing)
        .onClick(() => void this.setMode("edit"))
    );
    menu.addSeparator();
    const open = this.searchOpen;
    menu.addItem((item) =>
      item
        .setTitle(open ? "Close search" : "Search")
        .setIcon(open ? "search-x" : "search")
        .onClick(() => this.toggleSearch())
    );
    const s = this.nfeDeps.settings();
    menu.addItem((item) =>
      item
        .setTitle("Word wrap")
        .setIcon("wrap-text")
        .setChecked(s.wordWrap)
        .onClick(() => this.setWordWrap(!s.wordWrap))
    );
    menu.addItem((item) =>
      item
        .setTitle("Show invisibles")
        .setIcon("pilcrow")
        .setChecked(s.showInvisibles)
        .onClick(() => this.setShowInvisibles(!s.showInvisibles))
    );
    menu.addSeparator();
    const directions: Array<[SharedSettings["textDirection"], string, string]> = [
      ["auto", "Direction: by line", "languages"],
      ["ltr", "Left to right", "pilcrow-left"],
      ["rtl", "Right to left", "pilcrow-right"],
    ];
    for (const [value, title, icon] of directions) {
      menu.addItem((item) =>
        item
          .setTitle(title)
          .setIcon(icon)
          .setChecked(s.textDirection === value)
          .onClick(() => this.setTextDirection(value))
      );
    }
    if (this.nfeRunAvailable()) {
      menu.addSeparator();
      menu.addItem((item) =>
        item
          .setTitle("Run file")
          .setIcon("play")
          .onClick(() => void this.runFile())
      );
    }
  }

  /**
   * Switching to edit on a large file goes through the warning modal unless
   * `force` says the user already answered it.
   */
  async setMode(mode: ViewMode, force = false): Promise<void> {
    if (!this.nfeDoc || !this.file) return;
    if (mode === this.nfeMode) return;
    if (mode === "edit" && this.nfeDoc.info.lossy) {
      // A decode by guess is never edited unasked: the modal offers a UTF-8
      // copy or editing in the guessed encoding, which confirms it.
      const copyPath = this.nfeCopyPath(this.file);
      new ReadOnlyModal(this.app, {
        fileName: this.file.name,
        copyName: copyPath.slice(copyPath.lastIndexOf("/") + 1),
        encoding: this.nfeDoc.info.encoding,
        onCopy: () => void this.createUtf8Copy(),
        onEditAs: () => void this.editInGuessedEncoding(),
      }).open();
      return;
    }
    if (mode === "edit" && this.nfeLarge && !force) {
      new LargeFileModal(this.app, {
        sizeBytes: this.nfeSizeBytes,
        thresholdBytes: this.nfeDeps.device.get().largeFileBytes,
        onEdit: () => void this.setMode("edit", true),
      }).open();
      return;
    }
    if (this.nfeMode === "edit") {
      // Leaving the editor: the text it holds is the truth; write it first.
      await this.nfeAutosave?.flush();
      if (this.nfeEditor && this.nfeDoc) {
        this.nfeDoc = { text: this.nfeEditor.getText(), info: this.nfeDoc.info };
      }
    }
    this.nfeShow(mode);
    if (this.nfeDeps.settings().initialMode === "remember") {
      this.nfeDeps.device.rememberMode(this.file.path, mode);
    }
  }

  /**
   * Both modes are the same CodeMirror view; preview is the read-only one.
   * CodeMirror renders only the visible lines and parses incrementally, so a
   * large file previews in a frame either way; what the editing mode adds is
   * the undo history and the write path, which is why a large file asks first.
   */
  private nfeShow(mode: ViewMode): void {
    this.nfeMode = mode;
    this.nfeDestroyEditor();
    // The run panel survives a mode switch: detach it, empty the body, put it back under the new editor.
    const panelEl = this.nfeRunPanel?.rootEl ?? null;
    this.nfeBodyEl.empty();
    if (!this.nfeDoc) return;
    const s = this.nfeDeps.settings();
    const readOnly = mode === "preview" || this.nfeDoc.info.lossy;
    const host = this.nfeBodyEl.createDiv({ cls: "nfe-editor" });
    host.addClass(OBSIDIAN_SCHEME_CLASS);
    if (readOnly) host.addClass("nfe-readonly");
    // What a palette scopes on: the extension, the language badge, the file
    // name and the vault path, as data attributes on the host (see
    // palette/render.ts). Empty when the file has none.
    if (this.file) {
      host.setAttribute("data-nfe-ext", this.file.extension.toLowerCase());
      host.setAttribute("data-nfe-lang", this.nfeLanguage?.entry.name ?? languageFor(this.file.extension)?.name ?? "");
      host.setAttribute("data-nfe-name", this.file.name);
      host.setAttribute("data-nfe-path", this.file.path);
    }
    const options = {
      text: this.nfeDoc.text,
      readOnly,
      lineNumbers: s.lineNumbers,
      wordWrap: s.wordWrap,
      showInvisibles: s.showInvisibles,
      eolLabel: describeLineEnding(this.nfeDoc.info.eol),
      textDirection: s.textDirection,
      searchHints: () => this.nfeDeps.settings().searchHints,
      tabSize: s.tabSize,
      tabInsertsSpaces: s.tabInsertsSpaces,
      onChange: () => {
        if (!readOnly) this.nfeAutosave?.schedule();
      },
      onSearchToggle: () => this.nfeSyncActions(),
    };
    const started = this.nfeDeps.now();
    try {
      this.nfeEditor = this.nfeDeps.editorFactory.create(host, { ...options, language: this.nfeLanguage?.support ?? null });
    } catch (e) {
      // The language extension is the only part that varies per file; try
      // once more without it before giving up on the view.
      this.nfeDeps.log.error("editor", `building the ${mode} view with ${this.nfeLanguage?.entry.name ?? "no language"} failed; retrying as plain text`, e);
      host.empty();
      this.nfeLanguage = null;
      this.nfeEditor = this.nfeDeps.editorFactory.create(host, { ...options, language: null });
      new Notice("Native File Editor: highlighting failed for this file; shown as plain text. Details are in the plugin log.");
    }
    if (!readOnly) this.nfeEditor.focus();
    if (panelEl) this.nfeBodyEl.appendChild(panelEl);
    this.nfeDeps.log.debug("view", `${mode} ${this.nfeLoadedPath ?? "?"}: view built in ${this.nfeDeps.now() - started} ms`);
    this.nfeRenderHead();
    this.nfeSyncActions();
  }

  private nfeRenderHead(): void {
    this.nfeHeadEl.empty();
    if (!this.nfeDoc || !this.file) return;
    const info = this.nfeDoc.info;
    const lang = languageFor(this.file.extension);
    const meta = this.nfeHeadEl.createDiv({ cls: "nfe-head-meta" });
    meta.createSpan({ cls: "nfe-badge", text: lang?.name ?? "Text" });
    meta.createSpan({ cls: "nfe-badge", text: describeEncoding(info) });
    meta.createSpan({ cls: "nfe-badge", text: describeLineEnding(info.eol) });
    meta.createSpan({ cls: "nfe-badge", text: formatBytes(this.nfeSizeBytes) });
    if (info.lossy) {
      meta.createSpan({
        cls: "nfe-badge nfe-badge-warn",
        text: "read-only: not valid UTF-8, shown as a guess",
      });
    }
    const problem = this.nfeSaveProblem;
    if (problem) {
      const badge = meta.createSpan({
        cls: "nfe-badge nfe-badge-warn nfe-badge-problem",
        text: `not saved: "${problem.char}" on line ${problem.line} has no byte in ${problem.encoding}`,
      });
      badge.setAttribute("aria-label", "Click to go to the character. Remove it, or create a UTF-8 copy from the menu.");
      badge.addEventListener("click", () => this.nfeEditor?.markProblem({ line: problem.line, column: problem.column, length: problem.char.length }));
    }
    const buttons = this.nfeHeadEl.createDiv({ cls: "nfe-head-buttons" });
    if (this.nfeRunAvailable()) {
      // Accent colour only while the panel is open (a run is always inside an open panel).
      const runBtn = buttons.createEl("button", { cls: "nfe-mode-button nfe-run-head-button", text: "Run" });
      runBtn.toggleClass("is-active", this.runPanelOpen);
      setIcon(runBtn.createSpan({ cls: "nfe-mode-icon" }), "play");
      runBtn.addEventListener("click", () => void this.runFile());
    }
    const btn = buttons.createEl("button", {
      cls: "nfe-mode-button",
      text: this.nfeMode === "preview" ? "Edit" : "Preview",
    });
    setIcon(btn.createSpan({ cls: "nfe-mode-icon" }), this.nfeMode === "preview" ? "pencil" : "book-open");
    btn.addEventListener("click", () => void this.toggleMode());
  }

  /** The head's Run button follows the panel: lit while it is open. */
  private nfeSyncRunButton(): void {
    const btn = this.nfeHeadEl.querySelector(".nfe-run-head-button");
    if (btn) btn.toggleClass("is-active", this.runPanelOpen);
  }

  private nfeRenderError(message: string): void {
    this.nfeDoc = null;
    this.nfeHeadEl.empty();
    this.nfeBodyEl.empty();
    this.nfeBodyEl.createDiv({ cls: "nfe-error", text: message });
    this.nfeSyncActions();
  }

  private async nfeSave(): Promise<void> {
    // The path the bytes were loaded from, not `this.file`: during onUnloadFile
    // the view may already have been pointed elsewhere, and the text still
    // belongs to the file it came from.
    const path = this.nfeLoadedPath;
    if (!path || !this.nfeDoc || !this.nfeEditor) return;
    const text = this.nfeEditor.getText();
    const bytes = encodeText(text, this.nfeDoc.info);
    this.nfeLastWriteAt = this.nfeDeps.now();
    await this.nfeDeps.transport.writeBinaryAtomic(path, bytes);
    this.nfeLastWriteAt = this.nfeDeps.now();
    this.nfeSizeBytes = bytes.byteLength;
    this.nfeDoc = { text, info: this.nfeDoc.info };
    if (this.nfeSaveProblem) {
      this.nfeSaveProblem = null;
      this.nfeRenderHead();
    }
    this.nfeDeps.log.debug("save", `${path}: ${bytes.byteLength} B`);
    this.nfeDeps.afterSave?.(path);
  }

  /** The file is gone from the vault: drop the text, say so, write nothing. */
  private async nfeOnDeleted(path: string): Promise<void> {
    this.nfeDeps.log.info("view", `${path} was deleted while open`);
    this.nfeAutosave?.cancel();
    await this.nfeTeardown();
    this.nfeRenderError(`${path} was deleted.`);
  }

  /**
   * Another program, another device through sync, or another pane changed the
   * file. Reload unless this pane has unsaved typing, in which case its text
   * wins and the next autosave writes it; a merge is not something a text
   * editor should invent.
   */
  private async nfeOnExternalModify(): Promise<void> {
    if (!this.file || !this.nfeDoc) return;
    if (this.nfeDeps.now() - this.nfeLastWriteAt < SELF_WRITE_ECHO_MS) return;
    if (this.nfeAutosave?.isDirty) {
      this.nfeDeps.log.info("view", `${this.file.path} changed externally while the editor has unsaved typing; keeping the editor's text`);
      return;
    }
    let bytes: Uint8Array;
    try {
      bytes = await this.nfeDeps.transport.readBinary(this.file.path);
    } catch {
      return;
    }
    const decoded = decodeText(bytes);
    if (decoded.text === this.nfeDoc.text) return;
    this.nfeDeps.log.info("view", `${this.file.path} changed externally; reloaded (${bytes.byteLength} B)`);
    this.nfeSizeBytes = bytes.byteLength;
    this.nfeDoc = decoded;
    if (this.nfeEditor) {
      this.nfeEditor.setText(decoded.text);
      this.nfeRenderHead();
    } else {
      this.nfeShow(this.nfeMode);
    }
  }

  private nfeDestroyEditor(): void {
    if (this.nfeEditor) {
      this.nfeEditor.destroy();
      this.nfeEditor = null;
    }
  }

  private async nfeTeardown(): Promise<void> {
    // onUnloadFile and onClose can both run this while a flush is awaited;
    // the second caller must find nothing to do (2026-09-07: `null.cancel()`).
    const autosave = this.nfeAutosave;
    this.nfeAutosave = null;
    if (autosave) {
      await autosave.flush();
      autosave.cancel();
    }
    this.nfeSaveProblem = null;
    // Leaving the file stops its program; whether the panel was open is already remembered.
    if (this.nfeRunPanel) {
      this.nfeRunPanel.destroy();
      this.nfeRunPanel = null;
    }
    this.nfeDestroyEditor();
    this.nfeDoc = null;
    this.nfeHeadEl.empty();
    this.nfeBodyEl.empty();
  }
}

import { FileView, Notice, type TFile, type WorkspaceLeaf, setIcon } from "obsidian";
import { AUTOSAVE_DELAY_MS, PREVIEW_HIGHLIGHT_MAX_BYTES, VIEW_TYPE_TEXT } from "../constants";
import { Autosave, type Timers } from "../core/autosave";
import { type ViewMode, decideOpenMode } from "../core/openMode";
import { tokenizeForPreview } from "../highlight/highlighter";
import { type ResolvedLanguage, languageFor, resolveLanguage } from "../highlight/registry";
import {
  type DecodedText,
  decodeText,
  describeEncoding,
  describeLineEnding,
  encodeText,
} from "../model/text/encoding";
import type { Transport } from "../platform/transport";
import type { DeviceLocalStore } from "../settings/DeviceLocalStore";
import type { SharedSettings } from "../settings/settings";
import { LargeFileModal, formatBytes } from "./LargeFileModal";
import type { EditorFactory, EditorHandle } from "./editor";

export interface TextViewDeps {
  readonly settings: () => SharedSettings;
  readonly device: DeviceLocalStore;
  readonly transport: Transport;
  readonly editorFactory: EditorFactory;
  readonly timers: Timers;
  readonly now: () => number;
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

  constructor(leaf: WorkspaceLeaf, deps: TextViewDeps) {
    super(leaf);
    this.nfeDeps = deps;
    this.navigation = true;
    this.contentEl.addClass("nfe-text-content");
    this.nfeHeadEl = this.contentEl.createDiv({ cls: "nfe-head" });
    this.nfeBodyEl = this.contentEl.createDiv({ cls: "nfe-body" });
    this.addAction("pencil", "Toggle preview and edit", () => {
      void this.toggleMode();
    });
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.file && file.path === this.file.path) void this.nfeOnExternalModify();
      })
    );
  }

  override getViewType(): string {
    return VIEW_TYPE_TEXT;
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

  override async onLoadFile(file: TFile): Promise<void> {
    await super.onLoadFile(file);
    this.nfeLoadedPath = file.path;
    let bytes: Uint8Array;
    try {
      bytes = await this.nfeDeps.transport.readBinary(file.path);
    } catch (e) {
      this.nfeRenderError(`Cannot read ${file.path}: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    // The file may have been swapped while the read was in flight.
    if (this.nfeLoadedPath !== file.path) return;
    this.nfeSizeBytes = bytes.byteLength;
    this.nfeDoc = decodeText(bytes);
    const entry = languageFor(file.extension);
    this.nfeLanguage = entry ? resolveLanguage(entry) : null;
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
    if (decision.large) {
      new Notice(`${file.name} is ${formatBytes(this.nfeSizeBytes)}; opened as a preview.`);
    }
    this.nfeAutosave = new Autosave({
      delayMs: AUTOSAVE_DELAY_MS,
      timers: this.nfeDeps.timers,
      save: () => this.nfeSave(),
      onError: (e) => new Notice(`Native File Editor could not save ${file.name}: ${e instanceof Error ? e.message : String(e)}`),
    });
    this.nfeShow(decision.mode);
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

  /**
   * Switching to edit on a large file goes through the warning modal unless
   * `force` says the user already answered it.
   */
  async setMode(mode: ViewMode, force = false): Promise<void> {
    if (!this.nfeDoc || !this.file) return;
    if (mode === this.nfeMode) return;
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

  private nfeShow(mode: ViewMode): void {
    this.nfeMode = mode;
    this.nfeDestroyEditor();
    this.nfeBodyEl.empty();
    if (!this.nfeDoc) return;
    if (mode === "edit") {
      const s = this.nfeDeps.settings();
      this.nfeEditor = this.nfeDeps.editorFactory.create(this.nfeBodyEl.createDiv({ cls: "nfe-editor" }), {
        text: this.nfeDoc.text,
        language: this.nfeLanguage?.support ?? null,
        readOnly: this.nfeDoc.info.lossy,
        lineNumbers: s.lineNumbers,
        wordWrap: s.wordWrap,
        tabSize: s.tabSize,
        tabInsertsSpaces: s.tabInsertsSpaces,
        onChange: () => {
          if (!this.nfeDoc?.info.lossy) this.nfeAutosave?.schedule();
        },
      });
      this.nfeEditor.focus();
    } else {
      const pre = this.nfeBodyEl.createEl("pre", { cls: "nfe-preview" });
      if (this.nfeDeps.settings().wordWrap) pre.addClass("nfe-wrap");
      this.nfeRenderPreview(pre, this.nfeDoc.text);
    }
    this.nfeRenderHead();
  }

  /**
   * Highlighted when there is a language and the file is small enough for one
   * parse to be cheap; otherwise the text as one node. Either way no editor is
   * built, which is what makes the preview the fast path.
   */
  private nfeRenderPreview(pre: HTMLElement, text: string): void {
    if (!this.nfeLanguage || this.nfeSizeBytes > PREVIEW_HIGHLIGHT_MAX_BYTES) {
      pre.setText(text);
      return;
    }
    for (const token of tokenizeForPreview(text, this.nfeLanguage.language)) {
      if (token.classes === null) pre.appendText(token.text);
      else pre.createSpan({ cls: token.classes, text: token.text });
    }
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
    const btn = this.nfeHeadEl.createEl("button", {
      cls: "nfe-mode-button",
      text: this.nfeMode === "preview" ? "Edit" : "Preview",
    });
    setIcon(btn.createSpan({ cls: "nfe-mode-icon" }), this.nfeMode === "preview" ? "pencil" : "eye");
    btn.addEventListener("click", () => void this.toggleMode());
  }

  private nfeRenderError(message: string): void {
    this.nfeDoc = null;
    this.nfeHeadEl.empty();
    this.nfeBodyEl.empty();
    this.nfeBodyEl.createDiv({ cls: "nfe-error", text: message });
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
    if (this.nfeAutosave?.isDirty) return;
    let bytes: Uint8Array;
    try {
      bytes = await this.nfeDeps.transport.readBinary(this.file.path);
    } catch {
      return;
    }
    const decoded = decodeText(bytes);
    if (decoded.text === this.nfeDoc.text) return;
    this.nfeSizeBytes = bytes.byteLength;
    this.nfeDoc = decoded;
    if (this.nfeMode === "edit" && this.nfeEditor) {
      this.nfeEditor.setText(decoded.text);
      this.nfeRenderHead();
    } else {
      this.nfeShow("preview");
    }
  }

  private nfeDestroyEditor(): void {
    if (this.nfeEditor) {
      this.nfeEditor.destroy();
      this.nfeEditor = null;
    }
  }

  private async nfeTeardown(): Promise<void> {
    if (this.nfeAutosave) {
      await this.nfeAutosave.flush();
      this.nfeAutosave.cancel();
      this.nfeAutosave = null;
    }
    this.nfeDestroyEditor();
    this.nfeDoc = null;
    this.nfeHeadEl.empty();
    this.nfeBodyEl.empty();
  }
}

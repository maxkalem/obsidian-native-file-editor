import { type App, Modal } from "obsidian";
import { newFilePath, sanitizeBaseName } from "../core/newFile";
import { __allEntries } from "../highlight/registry";

export interface NewFileChoice {
  readonly folder: string;
  readonly path: string;
  readonly extension: string;
}

/**
 * "New file" for any type this plugin edits: a name and an extension picked
 * from the registry, sorted by language name so ".ts (TypeScript)" is found
 * by either half. One action, no Cancel button; tapping outside dismisses.
 */
export class NewFileModal extends Modal {
  readonly title = "New file";
  private readonly folder: string;
  private readonly initialExtension: string;
  private readonly exists: (path: string) => boolean;
  private readonly onCreate: (choice: NewFileChoice) => void;

  constructor(
    app: App,
    opts: {
      folder: string;
      initialExtension: string;
      exists: (path: string) => boolean;
      onCreate: (choice: NewFileChoice) => void;
    }
  ) {
    super(app);
    this.folder = opts.folder;
    this.initialExtension = opts.initialExtension;
    this.exists = opts.exists;
    this.onCreate = opts.onCreate;
  }

  /** Every registered extension with its language, sorted by extension. */
  static options(): Array<{ extension: string; label: string }> {
    const out: Array<{ extension: string; label: string }> = [];
    for (const e of __allEntries()) {
      for (const ext of e.extensions) out.push({ extension: ext, label: `.${ext}  (${e.name})` });
    }
    return out.sort((a, b) => a.extension.localeCompare(b.extension));
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createEl("p", {
      cls: "nfe-modal-note",
      text: `Creating in ${this.folder === "" || this.folder === "/" ? "the vault root" : this.folder}`,
    });
    const row = this.contentEl.createDiv({ cls: "nfe-newfile-row" });
    const nameEl = row.createEl("input", { cls: "nfe-newfile-name", type: "text", placeholder: "File name" });
    const extEl = row.createEl("select", { cls: "nfe-newfile-ext dropdown" });
    for (const o of NewFileModal.options()) {
      const opt = extEl.createEl("option", { text: o.label, value: o.extension });
      if (o.extension === this.initialExtension) opt.selected = true;
    }
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const create = actions.createEl("button", { text: "Create", cls: "mod-cta" });
    const submit = () => {
      const extension = extEl.value;
      const base = sanitizeBaseName(nameEl.value, extension);
      const path = newFilePath(this.folder, base, extension, this.exists);
      this.close();
      this.onCreate({ folder: this.folder, path, extension });
    };
    create.addEventListener("click", submit);
    nameEl.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });
    nameEl.focus();
  }
}

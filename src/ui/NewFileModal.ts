import { type App, Modal } from "obsidian";
import { type ExtensionOption, filterExtensions, newFilePath, sanitizeBaseName } from "../core/newFile";
import { __allEntries } from "../highlight/registry";

export interface NewFileChoice {
  readonly folder: string;
  readonly path: string;
  readonly extension: string;
}

/**
 * "New file" for any type this plugin edits: a name, and an extension found
 * by typing into a filter (the letters in order: `tt` shows `.txt`, `.http`,
 * `.targets`; a language name works too) and picked from the list under it
 * with the arrow keys, Enter or a click. One action, no Cancel button;
 * tapping outside dismisses. The 2026-09-09 replacement for a 330-entry
 * dropdown.
 */

/** How many matches the list shows at once; the rest scroll. */
const LIST_ROWS = 8;
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
  static options(): ExtensionOption[] {
    const out: ExtensionOption[] = [];
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
    const extEl = row.createEl("input", { cls: "nfe-newfile-ext", type: "text", placeholder: "Extension or language" });
    extEl.setAttribute("aria-label", "Type letters of the extension or language: tt finds txt, http, targets");
    extEl.setAttribute("spellcheck", "false");
    const listEl = this.contentEl.createDiv({ cls: "nfe-newfile-list" });
    listEl.style.setProperty("--nfe-list-rows", String(LIST_ROWS));
    const all = NewFileModal.options();
    let shown: ExtensionOption[] = [];
    let selected = 0;
    const chosen = (): string | null => shown[selected]?.extension ?? null;
    const render = () => {
      listEl.empty();
      shown.forEach((o, i) => {
        const item = listEl.createDiv({ cls: "nfe-newfile-item", text: o.label });
        item.toggleClass("is-selected", i === selected);
        item.setAttribute("data-extension", o.extension);
        item.addEventListener("click", () => {
          selected = i;
          extEl.value = o.extension;
          render();
          nameEl.focus();
        });
      });
      if (shown.length === 0) listEl.createDiv({ cls: "nfe-newfile-item nfe-newfile-none", text: "No file type matches" });
    };
    const filter = () => {
      shown = filterExtensions(extEl.value, all);
      selected = 0;
      render();
    };
    extEl.value = this.initialExtension;
    filter();
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const create = actions.createEl("button", { text: "Create", cls: "mod-cta" });
    const submit = () => {
      const extension = chosen();
      if (extension === null) return;
      const base = sanitizeBaseName(nameEl.value, extension);
      const path = newFilePath(this.folder, base, extension, this.exists);
      this.close();
      this.onCreate({ folder: this.folder, path, extension });
    };
    create.addEventListener("click", submit);
    const move = (delta: number) => {
      if (shown.length === 0) return;
      selected = (selected + delta + shown.length) % shown.length;
      render();
      const item = listEl.children[selected];
      if (item && "scrollIntoView" in item && typeof (item as { scrollIntoView?: unknown }).scrollIntoView === "function") (item as HTMLElement).scrollIntoView({ block: "nearest" });
    };
    const onKeys = (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      }
    };
    extEl.addEventListener("input", filter);
    extEl.addEventListener("keydown", onKeys);
    nameEl.addEventListener("keydown", onKeys);
    nameEl.focus();
  }
}

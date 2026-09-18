import { t } from "../core/i18n";
import { type App, Modal } from "obsidian";
import { type ExtensionOption, chosenExtension, filterExtensions, newFilePath, ownExtension, sanitizeBaseName, typedExtension } from "../core/newFile";
import { __allEntries } from "../highlight/registry";

export interface NewFileChoice {
  readonly folder: string;
  readonly path: string;
  readonly extension: string;
}

/**
 * t("newFile.title") for any type this plugin edits: a name, and a type found by
 * typing into a filter (the letters in order: `tt` shows `.txt`, `.http`,
 * `.targets`; a language name works too) and picked from the list under it
 * with the arrow keys, Enter or a click. One action, no Cancel button;
 * tapping outside dismisses. The 2026-09-09 replacement for a 330-entry
 * dropdown.
 *
 * The rules of the two fields: the type field starts
 * empty and the list appears at the first character typed into it, then
 * stays until the dialog closes, even if the field is emptied again. An
 * extension typed in the name (`1.ts`) is the file's extension while the
 * type field is empty; a type in the field wins otherwise, with the same
 * suffix stripped from the name so `notes.ts` + `.ts` is `notes.ts`; a type
 * typed into the field that matches nothing is taken as typed. A type this
 * plugin cannot open, or no extension at all, is allowed after a warning
 * (Create must never do nothing).
 */

/** How many matches the list shows at once; the rest scroll. */
const LIST_ROWS = 8;
export class NewFileModal extends Modal {
  readonly title = t("newFile.title");
  private readonly folder: string;
  private readonly lastExtension: string;
  private readonly exists: (path: string) => boolean;
  private readonly onCreate: (choice: NewFileChoice) => void;

  constructor(
    app: App,
    opts: {
      folder: string;
      /** The extension of the last file created here, shown in the type field's placeholder. */
      lastExtension: string;
      exists: (path: string) => boolean;
      onCreate: (choice: NewFileChoice) => void;
    }
  ) {
    super(app);
    this.folder = opts.folder;
    this.lastExtension = opts.lastExtension;
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
      text: t("newFile.creatingIn", { folder: this.folder === "" || this.folder === "/" ? t("newFile.vaultRoot") : this.folder }),
    });
    const row = this.contentEl.createDiv({ cls: "nfe-newfile-row" });
    const nameEl = row.createEl("input", { cls: "nfe-newfile-name", type: "text", placeholder: t("newFile.name.placeholder") });
    const extEl = row.createEl("input", {
      cls: "nfe-newfile-ext",
      type: "text",
      placeholder: this.lastExtension ? t("newFile.type.nameWithLast", { extension: this.lastExtension }) : t("newFile.type.name"),
    });
    extEl.setAttribute("aria-label", t("newFile.type.desc"));
    extEl.setAttribute("spellcheck", "false");
    const listEl = this.contentEl.createDiv({ cls: "nfe-newfile-list nfe-hidden" });
    listEl.style.setProperty("--nfe-list-rows", String(LIST_ROWS));
    const warnEl = this.contentEl.createDiv({ cls: "nfe-newfile-warning nfe-hidden" });
    const all = NewFileModal.options();
    const known = new Set(all.map((o) => o.extension.toLowerCase()));
    let listShown = false;
    let shown: ExtensionOption[] = [];
    // The highlighted row: an exact spelling of the typed text, or what the arrows or a click chose (`picked`);
    // -1 when the typed text is its own extension (`z` makes `.z`, not the first match `.z80`).
    let selected = -1;
    let picked = false;
    let warnedFor: string | null = null;
    const render = () => {
      listEl.empty();
      shown.forEach((o, i) => {
        const item = listEl.createDiv({ cls: "nfe-newfile-item", text: o.label });
        item.toggleClass("is-selected", i === selected);
        item.setAttribute("data-extension", o.extension);
        item.addEventListener("click", () => {
          selected = i;
          picked = true;
          extEl.value = o.extension;
          render();
          nameEl.focus();
        });
      });
      if (shown.length === 0) listEl.createDiv({ cls: "nfe-newfile-item nfe-newfile-none", text: t("newFile.type.none") });
    };
    const filter = () => {
      listShown = true;
      listEl.removeClass("nfe-hidden");
      shown = filterExtensions(extEl.value, all);
      picked = false;
      const typed = typedExtension(extEl.value).toLowerCase();
      selected = shown.findIndex((o) => o.extension.toLowerCase() === typed);
      render();
    };
    const clearWarning = () => {
      warnedFor = null;
      warnEl.addClass("nfe-hidden");
      warnEl.setText("");
      create.setText(t("button.create"));
    };
    /**
     * The extension the file gets: the type field's when it has text (the
     * selected match, else the text as typed), else the one typed in the
     * name, else none. Null only when the type field holds nothing usable.
     */
    const decide = (): { extension: string; base: string } | null => {
      const pick = picked ? (shown[selected] ?? null) : null;
      if (extEl.value.trim().length > 0 || pick) {
        const extension = chosenExtension(extEl.value, listShown ? shown : all, pick);
        if (extension.length === 0) return null;
        return { extension, base: sanitizeBaseName(nameEl.value, extension) };
      }
      const own = ownExtension(nameEl.value) ?? "";
      return { extension: own, base: sanitizeBaseName(nameEl.value, own) };
    };
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const create = actions.createEl("button", { text: t("button.create"), cls: "mod-cta" });
    const submit = () => {
      const choice = decide();
      if (choice === null) return;
      const { extension, base } = choice;
      // A dot-file (`.gitignore`) is a legitimate wish, and Obsidian hides every path whose name starts
      // with a dot: no explorer entry, no TFile, so this plugin cannot open it either. Said once; the second Create goes through.
      const dotFile = base.length === 0;
      const warnKey = dotFile ? `.${extension}` : extension;
      if ((dotFile || !known.has(extension.toLowerCase())) && warnedFor !== warnKey) {
        // Once: the second Create goes through.
        warnedFor = warnKey;
        warnEl.setText(
          dotFile
            ? t("newFile.warn.dotFile", { extension })
            : extension.length === 0
              ? t("newFile.warn.noExtension")
              : t("newFile.warn.unknown", { extension })
        );
        warnEl.removeClass("nfe-hidden");
        create.setText(t("newFile.create.anyway"));
        return;
      }
      const path = newFilePath(this.folder, base, extension, this.exists);
      this.close();
      this.onCreate({ folder: this.folder, path, extension });
    };
    create.addEventListener("click", submit);
    const move = (delta: number) => {
      if (!listShown || shown.length === 0) return;
      selected = selected < 0 ? (delta > 0 ? 0 : shown.length - 1) : (selected + delta + shown.length) % shown.length;
      picked = true;
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
    extEl.addEventListener("input", () => {
      clearWarning();
      filter();
    });
    nameEl.addEventListener("input", clearWarning);
    extEl.addEventListener("keydown", onKeys);
    nameEl.addEventListener("keydown", onKeys);
    nameEl.focus();
  }
}

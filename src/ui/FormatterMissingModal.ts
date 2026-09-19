import { type App, Modal } from "obsidian";
import { t } from "../core/i18n";

/**
 * Format was asked for a language the plugin CAN format, once the user
 * installs the file for it — or for one whose file is there and did not work.
 * Both are the same conversation: which file, where it goes, and where to get
 * it. A notice would scroll away with the answer in it; this stays until it
 * is read, and carries the link.
 *
 * It is never shown for a language nothing can format: that entry is not in
 * the menu at all.
 */

export interface FormatterMissingDeps {
  /** The language as the menu named it, for the first line. */
  readonly language: string;
  /** The file names to copy, in the order they are needed. */
  readonly files: readonly string[];
  /** The folder they go into, as a vault-relative path. */
  readonly folder: string;
  /** What went wrong, when a file IS there and failed; absent when nothing is installed. */
  readonly problem?: string;
  /** Opens the repository's instruction in a browser. */
  readonly openInstruction: () => void;
}

/** Where the instruction lives. The repository, not a service: the plugin downloads nothing. */
export const FORMATTER_INSTRUCTION_URL = "https://github.com/maxkalem/obsidian-native-file-editor/blob/main/formatters/README.md";

export class FormatterMissingModal extends Modal {
  private readonly deps: FormatterMissingDeps;

  constructor(app: App, deps: FormatterMissingDeps) {
    super(app);
    this.deps = deps;
  }

  override onOpen(): void {
    const { language, files, folder, problem, openInstruction } = this.deps;
    this.titleEl.setText(problem === undefined ? t("formatter.missing.title", { language }) : t("formatter.broken.title", { language }));
    this.contentEl.addClass("nfe-modal", "nfe-formatter-missing");
    if (problem !== undefined) this.contentEl.createEl("p", { cls: "nfe-modal-note", text: t("formatter.broken.desc", { error: problem }) });
    this.contentEl.createEl("p", { text: t("formatter.missing.desc", { language }) });
    const list = this.contentEl.createEl("ul", { cls: "nfe-formatter-files" });
    for (const file of files) list.createEl("li").createEl("code", { text: file });
    this.contentEl.createEl("p", { text: t("formatter.missing.folder") });
    this.contentEl.createEl("p").createEl("code", { cls: "nfe-formatter-folder", text: folder });
    this.contentEl.createEl("p", { cls: "nfe-modal-note", text: t("formatter.missing.note") });
    // The address in full beside the button: a WebView that refuses to open a
    // browser leaves the button doing nothing, and then this line is the answer.
    this.contentEl.createEl("p", { cls: "nfe-modal-note" }).createEl("code", { text: FORMATTER_INSTRUCTION_URL });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const open = actions.createEl("button", { text: t("formatter.missing.open"), cls: "mod-cta" });
    open.addEventListener("click", () => {
      this.close();
      openInstruction();
    });
    const close = actions.createEl("button", { text: t("button.close") });
    close.addEventListener("click", () => this.close());
  }
}

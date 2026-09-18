import { t } from "../core/i18n";
import { type App, Modal } from "obsidian";

/**
 * Shown when the user asks to edit a file whose bytes were not valid UTF-8 and
 * whose text is a decode by guess (windows-1251 or windows-1252). Writing a
 * guess back unasked could change bytes the user never touched, so the file
 * opened read-only; here the user decides. Two actions, the safe one first:
 * a UTF-8 copy beside the original, opened in the editor; or edit the original
 * in the guessed encoding, which the user confirms by choosing it. No Cancel
 * button: tapping outside dismisses.
 */
export class ReadOnlyModal extends Modal {
  readonly title: string;
  private readonly fileName: string;
  private readonly copyName: string;
  private readonly encoding: string;
  private readonly onCopy: () => void;
  private readonly onEditAs: () => void;

  constructor(app: App, opts: { fileName: string; copyName: string; encoding: string; onCopy: () => void; onEditAs: () => void }) {
    super(app);
    this.title = t("readOnly.title");
    this.fileName = opts.fileName;
    this.copyName = opts.copyName;
    this.encoding = opts.encoding;
    this.onCopy = opts.onCopy;
    this.onEditAs = opts.onEditAs;
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createEl("p", {
      text: t("readOnly.body", { file: this.fileName, encoding: this.encoding }),
    });
    this.contentEl.createEl("p", {
      text: t("readOnly.choices", { copy: this.copyName, encoding: this.encoding }),
      cls: "nfe-modal-note",
    });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const copy = actions.createEl("button", { text: t("readOnly.createCopy"), cls: "mod-cta" });
    copy.addEventListener("click", () => {
      this.close();
      this.onCopy();
    });
    const edit = actions.createEl("button", { text: t("readOnly.editAs", { encoding: this.encoding }) });
    edit.addEventListener("click", () => {
      this.close();
      this.onEditAs();
    });
  }
}

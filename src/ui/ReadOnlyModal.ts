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
    this.title = "Read-only file";
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
      text: `${this.fileName} is not valid UTF-8. It is shown decoded as ${this.encoding}, which is a guess, so it opened read-only: writing a guess back could change bytes you never touched.`,
    });
    this.contentEl.createEl("p", {
      text: `Create UTF-8 copy writes ${this.copyName} beside it and opens the copy in the editor; the original is left alone. Edit as ${this.encoding} edits the original and writes it back in that encoding; a character the encoding has no byte for stops the save until it is removed.`,
      cls: "nfe-modal-note",
    });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const copy = actions.createEl("button", { text: "Create UTF-8 copy", cls: "mod-cta" });
    copy.addEventListener("click", () => {
      this.close();
      this.onCopy();
    });
    const edit = actions.createEl("button", { text: `Edit as ${this.encoding}` });
    edit.addEventListener("click", () => {
      this.close();
      this.onEditAs();
    });
  }
}

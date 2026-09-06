import { type App, FuzzySuggestModal, Modal, Setting } from "obsidian";

/**
 * Two small dialogs the settings tab needs: pick a language from a list, and
 * ask for one line of text (a file extension). Both resolve a promise so the
 * settings code reads top to bottom.
 */

export class LanguagePickerModal extends FuzzySuggestModal<string> {
  private readonly languages: readonly string[];
  private readonly onPick: (language: string | null) => void;
  private picked = false;

  constructor(app: App, languages: readonly string[], placeholder: string, onPick: (language: string | null) => void) {
    super(app);
    this.languages = languages;
    this.onPick = onPick;
    this.setPlaceholder(placeholder);
  }

  getItems(): string[] {
    return [...this.languages];
  }

  getItemText(item: string): string {
    return item;
  }

  onChooseItem(item: string): void {
    this.picked = true;
    this.onPick(item);
  }

  /**
   * Obsidian closes the modal BEFORE it calls onChooseItem, so the "cancelled"
   * answer waits one tick: if a choice follows in the same turn it wins, and
   * only a plain dismissal resolves null. (Found on the device: every pick
   * came back as null.)
   */
  override onClose(): void {
    activeWindow.setTimeout(() => {
      if (!this.picked) this.onPick(null);
    }, 0);
  }
}

export function pickLanguage(app: App, languages: readonly string[], placeholder: string): Promise<string | null> {
  return new Promise((resolve) => new LanguagePickerModal(app, languages, placeholder, resolve).open());
}

/** One text field with OK and Cancel; resolves the trimmed text or null. */
export class TextPromptModal extends Modal {
  private value = "";
  private done = false;
  private readonly onDone: (text: string | null) => void;
  private readonly title: string;
  private readonly description: string;
  private readonly placeholder: string;

  constructor(app: App, title: string, description: string, placeholder: string, onDone: (text: string | null) => void) {
    super(app);
    this.title = title;
    this.description = description;
    this.placeholder = placeholder;
    this.onDone = onDone;
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createDiv({ cls: "nfe-modal-note", text: this.description });
    new Setting(this.contentEl).addText((t) => {
      t.setPlaceholder(this.placeholder);
      t.onChange((v) => (this.value = v));
      t.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
        if (e.key === "Enter") this.finish(true);
      });
    });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const ok = actions.createEl("button", { cls: "mod-cta", text: "OK" });
    ok.addEventListener("click", () => this.finish(true));
    const cancel = actions.createEl("button", { text: "Cancel" });
    cancel.addEventListener("click", () => this.finish(false));
  }

  private finish(ok: boolean): void {
    if (this.done) return;
    this.done = true;
    this.onDone(ok && this.value.trim().length > 0 ? this.value.trim() : null);
    this.close();
  }

  override onClose(): void {
    activeWindow.setTimeout(() => {
      if (!this.done) {
        this.done = true;
        this.onDone(null);
      }
    }, 0);
  }
}

export function promptText(app: App, title: string, description: string, placeholder: string): Promise<string | null> {
  return new Promise((resolve) => new TextPromptModal(app, title, description, placeholder, resolve).open());
}

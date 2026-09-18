import { t } from "../core/i18n";
import { type App, Modal, Setting } from "obsidian";
import { DEFAULT_WRAP_OPTIONS, MAX_WRAP_LINE_WIDTH, MIN_WRAP_LINE_WIDTH } from "../fmt/wrap";

export interface WrapChoice {
  readonly width: number;
  readonly breakWords: boolean;
}

/** The last choice, kept for the session: the same width is wanted again far more often than a new one. */
let lastChoice: WrapChoice = { width: DEFAULT_WRAP_OPTIONS.width, breakWords: DEFAULT_WRAP_OPTIONS.breakWords };

/**
 * t("wrap.title") asks two things before it acts: the width, and what to do with
 * a word longer than the room left (cut it, or let it stand on its own line).
 * One action button, as in every dialog of this plugin; Escape, the X and a
 * tap outside dismiss. Enter in the width field is the button.
 */
export class WrapLinesModal extends Modal {
  private readonly onWrap: (choice: WrapChoice) => void;
  private width = lastChoice.width;
  private breakWords = lastChoice.breakWords;
  private done = false;

  constructor(app: App, onWrap: (choice: WrapChoice) => void) {
    super(app);
    this.onWrap = onWrap;
  }

  override onOpen(): void {
    this.titleEl.setText(t("wrap.title"));
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createEl("p", {
      text: t("wrap.intro"),
    });
    new Setting(this.contentEl)
      .setName(t("wrap.width.name"))
      .setDesc(t("wrap.width.desc", { min: MIN_WRAP_LINE_WIDTH, max: MAX_WRAP_LINE_WIDTH }))
      .addText((field) => {
        field.inputEl.type = "number";
        field.inputEl.min = String(MIN_WRAP_LINE_WIDTH);
        field.inputEl.max = String(MAX_WRAP_LINE_WIDTH);
        field.setValue(String(this.width));
        field.onChange((v) => {
          const n = Number.parseInt(v, 10);
          if (Number.isFinite(n)) this.width = n;
        });
        field.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter") this.finish();
        });
      });
    new Setting(this.contentEl)
      .setName(t("wrap.breakWords.name"))
      .setDesc(t("wrap.breakWords.desc"))
      .addToggle((t) => {
        t.setValue(this.breakWords);
        t.onChange((v) => (this.breakWords = v));
      });
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const btn = actions.createEl("button", { text: t("wrap.button"), cls: "mod-cta" });
    btn.addEventListener("click", () => this.finish());
  }

  private finish(): void {
    if (this.done) return;
    const width = Math.min(MAX_WRAP_LINE_WIDTH, Math.max(MIN_WRAP_LINE_WIDTH, Math.floor(this.width)));
    this.done = true;
    lastChoice = { width, breakWords: this.breakWords };
    this.close();
    this.onWrap(lastChoice);
  }
}

import { t } from "../core/i18n";
import { type App, Modal, Setting } from "obsidian";

/** What the dialog hands back: one word, and where it goes. */
export type DictionaryChoice =
  | { readonly kind: "text"; readonly language: string; readonly word: string }
  | { readonly kind: "programming"; readonly language: string; readonly role: string; readonly word: string };

export interface AddToDictionaryDeps {
  /** The word under the cursor or the selection; the field is editable, so `кое-` and `-нибудь` can be typed. */
  readonly word: string;
  /** Text languages in force, bundled and from the vault. */
  readonly textLanguages: () => string[];
  /** Languages with word lists: the keyword tables and the vault's definitions. A grammar has nothing to add a word to. */
  readonly programmingLanguages: () => string[];
  /** The language of the open file, preselected when it has word lists. */
  readonly currentLanguage: string | null;
  readonly onAdd: (choice: DictionaryChoice) => void;
}

/** The value of the "a language not in the list" entry of the text dropdown. */
const NEW_DICTIONARY = "__new__";

export const KEYWORD_ROLES: readonly string[] = ["keyword", "builtin", "type", "constant", "property", "meta", "special"];

/** The name of a keyword set, as the dialog and the notices show it. */
export function keywordRoleName(role: string): string {
  return t(`keywordRole.${role}`);
}

/**
 * "Add to dictionary…": one word into a text language's word lists (which
 * decide the hyphens of Unwrap) or into a programming language's keyword set
 * (which decides its colour). The word is prefilled and editable; a text
 * language can be one that does not exist yet, and then the name field makes
 * it. One action button, as in every dialog of this plugin; Escape, the X and
 * a tap outside dismiss.
 */
export class AddToDictionaryModal extends Modal {
  private readonly deps: AddToDictionaryDeps;
  private word: string;
  private kind: "text" | "programming" = "text";
  private textLanguage: string;
  private newName = "";
  private programmingLanguage: string;
  private role = "keyword";
  private done = false;
  /** The rows that change with the kind, re-rendered in place rather than by reopening. */
  private bodyEl: HTMLElement | null = null;

  constructor(app: App, deps: AddToDictionaryDeps) {
    super(app);
    this.deps = deps;
    this.word = deps.word.trim();
    this.textLanguage = deps.textLanguages()[0] ?? NEW_DICTIONARY;
    const programming = deps.programmingLanguages();
    this.programmingLanguage = deps.currentLanguage !== null && programming.includes(deps.currentLanguage) ? deps.currentLanguage : (programming[0] ?? "");
  }

  override onOpen(): void {
    this.titleEl.setText(t("addWord.title"));
    this.contentEl.addClass("nfe-modal");
    this.contentEl.createEl("p", {
      text: t("addWord.intro"),
    });
    new Setting(this.contentEl)
      .setName(t("addWord.word.name"))
      .setDesc(t("addWord.word.desc"))
      .addText((field) => {
        field.setValue(this.word);
        field.onChange((v) => (this.word = v));
        field.inputEl.addEventListener("keydown", (e: KeyboardEvent) => {
          if (e.key === "Enter") this.finish();
        });
      });
    new Setting(this.contentEl)
      .setName(t("addWord.kind.name"))
      .addDropdown((d) => {
        d.addOption("text", t("addWord.kind.text"));
        d.addOption("programming", t("addWord.kind.programming"));
        d.setValue(this.kind);
        d.onChange((v) => {
          this.kind = v === "programming" ? "programming" : "text";
          this.renderBody();
        });
      });
    this.bodyEl = this.contentEl.createDiv();
    this.renderBody();
    const actions = this.contentEl.createDiv({ cls: "nfe-modal-actions" });
    const btn = actions.createEl("button", { text: t("button.add"), cls: "mod-cta" });
    btn.addEventListener("click", () => this.finish());
  }

  private renderBody(): void {
    const body = this.bodyEl;
    if (!body) return;
    body.empty();
    if (this.kind === "text") {
      const languages = this.deps.textLanguages();
      new Setting(body)
        .setName(t("addWord.kind.text"))
        .setDesc(t("addWord.text.desc"))
        .addDropdown((d) => {
          for (const name of languages) d.addOption(name, name);
          d.addOption(NEW_DICTIONARY, t("addWord.text.new"));
          d.setValue(this.textLanguage);
          d.onChange((v) => {
            this.textLanguage = v;
            this.renderBody();
          });
        });
      if (this.textLanguage === NEW_DICTIONARY) {
        new Setting(body)
          .setName(t("addWord.newName.name"))
          .setDesc(t("addWord.newName.desc"))
          .addText((field) => {
            field.setValue(this.newName);
            field.onChange((v) => (this.newName = v));
          });
      }
      return;
    }
    const languages = this.deps.programmingLanguages();
    new Setting(body)
      .setName(t("addWord.kind.programming"))
      .setDesc(t("addWord.programming.desc"))
      .addDropdown((d) => {
        for (const name of languages) d.addOption(name, name);
        d.setValue(this.programmingLanguage);
        d.onChange((v) => (this.programmingLanguage = v));
      });
    new Setting(body)
      .setName(t("addWord.role.name"))
      .setDesc(t("addWord.role.desc"))
      .addDropdown((d) => {
        for (const role of KEYWORD_ROLES) d.addOption(role, keywordRoleName(role));
        d.setValue(this.role);
        d.onChange((v) => (this.role = v));
      });
  }

  private finish(): void {
    if (this.done) return;
    const word = this.word.trim();
    if (word.length === 0) return;
    if (this.kind === "text") {
      const language = this.textLanguage === NEW_DICTIONARY ? this.newName.trim() : this.textLanguage;
      if (language.length === 0) return;
      this.done = true;
      this.close();
      this.deps.onAdd({ kind: "text", language, word });
      return;
    }
    if (this.programmingLanguage.length === 0) return;
    this.done = true;
    this.close();
    this.deps.onAdd({ kind: "programming", language: this.programmingLanguage, role: this.role, word });
  }
}

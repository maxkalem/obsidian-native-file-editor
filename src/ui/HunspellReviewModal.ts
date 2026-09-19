import { type App, Modal, Setting } from "obsidian";
import { plural, t } from "../core/i18n";
import type { RejoinedWord } from "../fmt/unwrap";
import type { HunspellCheck, HunspellPair } from "../fmt/vaultHunspell";

/**
 * The review step after Unwrap (open item 21, the user's design): a dictionary
 * is not a word list to hold but a place to look things up, so the only words
 * that go to it are the ones Unwrap put together by dropping a hyphen — the
 * single decision a text cannot always settle on its own.
 *
 * The dialog asks first, because reading someone's 8.5 MB dictionary should be
 * a choice; then it names the words the dictionary does not know, with the
 * hyphen restored beside each, and applies the ones the user picks in one edit.
 * A word the dictionary does not know either way is shown too, without a
 * recommendation: a dictionary is evidence, not a verdict.
 */

export interface ReviewRow {
  readonly join: RejoinedWord;
  /** Whether the dictionary knows the word with the hyphen put back: the reason to restore it. */
  readonly hyphenKnown: boolean;
  /** What the user decided; restoring puts the hyphen back into the text. */
  restore: boolean;
}

export interface HunspellReviewDeps {
  /** The words Unwrap rejoined, in the order they stand in the text. */
  readonly joins: readonly RejoinedWord[];
  /** The `.dic` files found beside the plugin's own word lists. */
  readonly dictionaries: readonly HunspellPair[];
  readonly check: (pair: HunspellPair, words: readonly string[]) => Promise<HunspellCheck>;
  /** Text languages in force, for "add to the plugin's own dictionary". */
  readonly textLanguages: () => string[];
  /** Put the hyphens back; the callback reports whether the text was still the one Unwrap had left. */
  readonly onApply: (restore: readonly RejoinedWord[]) => void;
  readonly onAddWord: (word: string, language: string) => void;
  readonly onProblem: (file: string, error: string) => void;
}

export class HunspellReviewModal extends Modal {
  private readonly deps: HunspellReviewDeps;
  private pair: HunspellPair;
  private language: string;
  private rows: ReviewRow[] = [];
  private known = 0;
  private bodyEl: HTMLElement | null = null;

  constructor(app: App, deps: HunspellReviewDeps) {
    super(app);
    this.deps = deps;
    this.pair = deps.dictionaries[0] as HunspellPair;
    this.language = deps.textLanguages()[0] ?? "";
  }

  override onOpen(): void {
    this.titleEl.setText(t("hunspell.title"));
    this.contentEl.addClass("nfe-modal", "nfe-hunspell");
    this.bodyEl = this.contentEl.createDiv();
    this.renderQuestion();
  }

  /** The gate: how many words there are, which dictionary they would go to, and nothing read yet. */
  private renderQuestion(): void {
    const body = this.bodyEl;
    if (!body) return;
    body.empty();
    body.createEl("p", { text: plural(this.deps.joins.length, "hunspell.ask.one", "hunspell.ask.other") });
    body.createEl("p", { cls: "nfe-modal-note", text: t("hunspell.ask.desc") });
    if (this.deps.dictionaries.length > 1) {
      new Setting(body).setName(t("hunspell.dictionary.name")).addDropdown((d) => {
        for (const pair of this.deps.dictionaries) d.addOption(pair.name, pair.name);
        d.setValue(this.pair.name);
        d.onChange((v) => (this.pair = this.deps.dictionaries.find((p) => p.name === v) ?? this.pair));
      });
    } else {
      new Setting(body).setName(t("hunspell.dictionary.name")).setDesc(this.pair.name);
    }
    const actions = body.createDiv({ cls: "nfe-modal-actions" });
    const check = actions.createEl("button", { text: t("button.check"), cls: "mod-cta" });
    check.addEventListener("click", () => void this.run());
    const no = actions.createEl("button", { text: t("button.notNow") });
    no.addEventListener("click", () => this.close());
  }

  private async run(): Promise<void> {
    const body = this.bodyEl;
    if (!body) return;
    body.empty();
    body.createEl("p", { text: t("hunspell.checking", { dictionary: this.pair.name }) });
    // Both forms in one pass: the joined word, and the word with its hyphen.
    const words = [...new Set(this.deps.joins.flatMap((j) => [j.word, j.hyphenated]))];
    const result = await this.deps.check(this.pair, words);
    if (result.problem !== null) {
      this.deps.onProblem(this.pair.dic, result.problem);
      this.close();
      return;
    }
    const seen = new Set<string>();
    this.rows = [];
    this.known = 0;
    for (const join of this.deps.joins) {
      if (result.known.has(join.word)) {
        this.known++;
        continue;
      }
      // The same word twice in a text is one row; applying it fixes every place.
      if (seen.has(join.word)) continue;
      seen.add(join.word);
      this.rows.push({ join, hyphenKnown: result.known.has(join.hyphenated), restore: result.known.has(join.hyphenated) });
    }
    this.renderResult();
  }

  private renderResult(): void {
    const body = this.bodyEl;
    if (!body) return;
    body.empty();
    if (this.rows.length === 0) {
      body.createEl("p", { text: plural(this.known, "hunspell.allKnown.one", "hunspell.allKnown.other") });
      const actions = body.createDiv({ cls: "nfe-modal-actions" });
      const close = actions.createEl("button", { text: t("button.close"), cls: "mod-cta" });
      close.addEventListener("click", () => this.close());
      return;
    }
    body.createEl("p", { text: plural(this.rows.length, "hunspell.unknown.one", "hunspell.unknown.other") });
    body.createEl("p", { cls: "nfe-modal-note", text: t("hunspell.unknown.desc") });
    for (const row of this.rows) {
      const setting = new Setting(body)
        .setName(row.join.word)
        .setDesc(row.hyphenKnown ? t("hunspell.row.hyphenKnown", { word: row.join.hyphenated }) : t("hunspell.row.neither", { word: row.join.hyphenated }));
      setting.setClass("nfe-hunspell-row");
      setting.addButton((b) => {
        b.setButtonText(t("hunspell.keep"));
        b.setTooltip(t("hunspell.keep.tooltip", { word: row.join.word }));
        if (!row.restore) b.setCta();
        b.onClick(() => {
          row.restore = false;
          this.renderResult();
        });
      });
      setting.addButton((b) => {
        b.setButtonText(t("hunspell.restore"));
        b.setTooltip(t("hunspell.restore.tooltip", { word: row.join.hyphenated }));
        if (row.restore) b.setCta();
        b.onClick(() => {
          row.restore = true;
          this.renderResult();
        });
      });
      setting.addExtraButton((b) => {
        b.setIcon("book-plus");
        b.setTooltip(t("hunspell.add.tooltip", { word: row.restore ? row.join.hyphenated : row.join.word, language: this.language }));
        b.onClick(() => this.deps.onAddWord(row.restore ? row.join.hyphenated : row.join.word, this.language));
      });
    }
    const languages = this.deps.textLanguages();
    if (languages.length > 0) {
      new Setting(body)
        .setName(t("hunspell.language.name"))
        .setDesc(t("hunspell.language.desc"))
        .addDropdown((d) => {
          for (const name of languages) d.addOption(name, name);
          d.setValue(this.language);
          d.onChange((v) => (this.language = v));
        });
    }
    const actions = body.createDiv({ cls: "nfe-modal-actions" });
    const apply = actions.createEl("button", { text: t("button.apply"), cls: "mod-cta" });
    apply.addEventListener("click", () => {
      const restore = this.deps.joins.filter((join) => this.rows.some((row) => row.restore && row.join.word === join.word));
      this.close();
      this.deps.onApply(restore);
    });
    const cancel = actions.createEl("button", { text: t("button.cancel") });
    cancel.addEventListener("click", () => this.close());
  }
}

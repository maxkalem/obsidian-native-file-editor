import { type App, Modal } from "obsidian";

/**
 * A short guide to regular expressions as the search panel uses them
 * (JavaScript's syntax, since the search runs on CodeMirror's `RegExp`), with
 * the examples people reach for. Opened from Settings → Editor and from the
 * `?` in the search panel. Plain DOM, no HTML strings.
 */

interface Row {
  readonly pattern: string;
  readonly meaning: string;
}

const SYNTAX: readonly Row[] = [
  { pattern: ".", meaning: "any one character except a line break" },
  { pattern: "\\d  \\w  \\s", meaning: "a digit; a letter, digit or _; a space or tab (capitals negate: \\D \\W \\S)" },
  { pattern: "[abc]  [a-z]  [^0-9]", meaning: "one of these; one in the range; anything but these" },
  { pattern: "*  +  ?", meaning: "the previous item zero or more, one or more, zero or one times" },
  { pattern: "{3}  {2,}  {1,5}", meaning: "exactly 3; 2 or more; 1 to 5 times" },
  { pattern: "^  $", meaning: "start of a line; end of a line" },
  { pattern: "\\b", meaning: "a word boundary (\\bcat\\b does not match concatenate)" },
  { pattern: "a|b", meaning: "a or b" },
  { pattern: "( )", meaning: "a group: what it matched is $1, $2, … in the Replace field" },
  { pattern: "(?: )", meaning: "a group that is not numbered" },
  { pattern: "(?= )  (?! )", meaning: "followed by / not followed by, without taking it" },
  { pattern: "\\.  \\(  \\*", meaning: "a literal dot, bracket, star: the backslash removes the special meaning" },
  { pattern: "*?  +?", meaning: "as few as possible (lazy), where * and + take as many as they can" },
];

const EXAMPLES: readonly (Row & { readonly replace?: string })[] = [
  { pattern: "^\\s+", meaning: "leading spaces and tabs on every line", replace: "(empty) — removes the indentation" },
  { pattern: "\\s+$", meaning: "trailing whitespace at the end of every line", replace: "(empty)" },
  { pattern: "^$\\n", meaning: "empty lines (with Replace empty: removes them)" },
  { pattern: "^(\\s*)//.*$", meaning: "a whole-line // comment, keeping its indentation in $1" },
  { pattern: "\\b\\d+\\b", meaning: "a whole number" },
  { pattern: "\\d+\\.\\d+", meaning: "a decimal number like 3.14" },
  { pattern: "\\d{4}-\\d{2}-\\d{2}", meaning: "a date like 2026-09-08" },
  { pattern: "(\\d{2})\\.(\\d{2})\\.(\\d{4})", meaning: "a date like 08.09.2026 …", replace: "$3-$2-$1 — turns it into 2026-09-08" },
  { pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]+", meaning: "an e-mail address" },
  { pattern: "https?://\\S+", meaning: "a web address" },
  { pattern: "\"([^\"]*)\"", meaning: "text in double quotes, the text itself in $1", replace: "'$1' — swaps the quotes" },
  { pattern: "^(\\w+)\\s*=\\s*(.*)$", meaning: "a key = value line: $1 the key, $2 the value", replace: "$2 = $1 — swaps them" },
  { pattern: "\\bTODO\\b|\\bFIXME\\b", meaning: "either word, whole words only" },
  { pattern: "^(?!.*keep).*$", meaning: "every line that does not contain keep" },
  { pattern: "(\\w+) \\1", meaning: "a word repeated (the the): \\1 is the first group again" },
];

export class RegexHelpModal extends Modal {
  readonly title = "Regular expressions in search";

  constructor(app: App) {
    super(app);
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal", "nfe-regex-help");
    this.contentEl.createEl("p", {
      text: "With the .* switch on, the Find field is a pattern rather than exact text, in JavaScript's syntax. Match case decides whether letters must match in case; Whole word adds \\b around the pattern. In the Replace field, $1, $2 … stand for the numbered groups of the match and $& for the whole match.",
    });
    this.section("Syntax", SYNTAX);
    this.section("Common searches", EXAMPLES);
    this.contentEl.createEl("p", {
      cls: "nfe-modal-note",
      text: "Select all (Alt+Enter) turns every match into a cursor: what you then type replaces all of them at once, Escape leaves one cursor. F3 and Shift+F3 step through matches without the panel.",
    });
  }

  private section(heading: string, rows: readonly (Row & { readonly replace?: string })[]): void {
    this.contentEl.createEl("h3", { text: heading });
    const table = this.contentEl.createEl("table", { cls: "nfe-regex-table" });
    for (const row of rows) {
      const tr = table.createEl("tr");
      tr.createEl("td").createEl("code", { text: row.pattern });
      const td = tr.createEl("td", { text: row.meaning });
      if (row.replace) {
        td.createEl("br");
        td.createSpan({ cls: "nfe-regex-replace", text: `Replace: ${row.replace}` });
      }
    }
  }
}

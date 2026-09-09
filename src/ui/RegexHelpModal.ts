import { type App, Modal, Notice, Platform } from "obsidian";

/**
 * A short guide to regular expressions as the search panel uses them
 * (JavaScript's syntax, since the search runs on CodeMirror's `RegExp`), with
 * the examples people reach for, and the keys the editor answers to. Opened
 * from Settings → Editor and from the `?` in the search panel. A click on a
 * pattern copies it (USER, 2026-09-09: no copy icon, the pattern itself is
 * the button). Plain DOM, no HTML strings.
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

/** `replaceNote` says what goes into the Replace field and what it does. */
const EXAMPLES: readonly (Row & { readonly replaceNote?: string })[] = [
  { pattern: "^\\s+", meaning: "leading spaces and tabs on every line", replaceNote: "(empty) — removes the indentation" },
  { pattern: "\\s+$", meaning: "trailing whitespace at the end of every line", replaceNote: "(empty)" },
  { pattern: "^$\\n", meaning: "empty lines (with Replace empty: removes them)" },
  { pattern: "^(\\s*)//.*$", meaning: "a whole-line // comment, keeping its indentation in $1" },
  { pattern: "\\b\\d+\\b", meaning: "a whole number" },
  { pattern: "\\d+\\.\\d+", meaning: "a decimal number like 3.14" },
  { pattern: "\\d{4}-\\d{2}-\\d{2}", meaning: "a date like 2026-09-08" },
  { pattern: "(\\d{2})\\.(\\d{2})\\.(\\d{4})", meaning: "a date like 08.09.2026 …", replaceNote: "$3-$2-$1 — turns it into 2026-09-08" },
  { pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]+", meaning: "an e-mail address" },
  { pattern: "https?://\\S+", meaning: "a web address" },
  { pattern: "\"([^\"]*)\"", meaning: "text in double quotes, the text itself in $1", replaceNote: "'$1' — swaps the quotes" },
  { pattern: "^(\\w+)\\s*=\\s*(.*)$", meaning: "a key = value line: $1 the key, $2 the value", replaceNote: "$2 = $1 — swaps them" },
  { pattern: "\\bTODO\\b|\\bFIXME\\b", meaning: "either word, whole words only" },
  { pattern: "^(?!.*keep).*$", meaning: "every line that does not contain keep" },
  { pattern: "(\\w+) \\1", meaning: "a word repeated (the the): \\1 is the first group again" },
];

const MOD = Platform.isMacOS ? "Cmd" : "Ctrl";

/**
 * What the editor answers to, by group. Only keys that reach the editor are
 * listed: Obsidian's own hotkeys (Ctrl+D, Ctrl+I, Ctrl+K, Ctrl+B, Ctrl+Enter,
 * Ctrl+/ …) are consumed before CodeMirror sees them unless the pane takes
 * them itself (TextView.nfeKeyAction), which is the case for the ones here.
 */
const KEYS: readonly { readonly group: string; readonly rows: readonly Row[] }[] = [
  {
    group: "Search",
    rows: [
      { pattern: `${MOD}+F  ${MOD}+H`, meaning: "open the panel; the same panel with Replace (editor only). Escape closes it" },
      { pattern: `F3  Shift+F3  ${MOD}+G  Shift+${MOD}+G`, meaning: "next / previous match, panel open or not" },
      { pattern: "Alt+Enter", meaning: "every match becomes a selection and the text takes the focus: typing changes all of them" },
      { pattern: `${MOD}+Alt+Enter`, meaning: "replace all (in the Replace field: Enter replaces one)" },
    ],
  },
  {
    group: "Several cursors",
    rows: [
      { pattern: `${MOD}+Alt+↑  ${MOD}+Alt+↓`, meaning: "add a cursor on the line above / below, in the same column (at the end of a shorter line)" },
      { pattern: `${MOD}+D`, meaning: "add the next occurrence of the selected text as another selection" },
      { pattern: `${MOD}+Shift+L`, meaning: "select every occurrence of the selected text" },
      { pattern: "Alt+drag", meaning: "column selection: one range per line over the rectangle" },
      { pattern: `${MOD}+click`, meaning: "add a cursor where you click" },
      { pattern: "Escape", meaning: "back to one cursor (with the search panel closed)" },
    ],
  },
  {
    group: "Lines",
    rows: [
      { pattern: "Alt+↑  Alt+↓", meaning: "move the line (or the selected lines) up / down" },
      { pattern: "Shift+Alt+↑  Shift+Alt+↓", meaning: "copy the line up / down" },
      { pattern: `Shift+${MOD}+K`, meaning: "delete the line" },
      { pattern: "Alt+L", meaning: "select the line" },
      { pattern: `Tab  Shift+Tab  ${MOD}+]  ${MOD}+[`, meaning: "indent / unindent the selected lines" },
      { pattern: `${MOD}+Alt+\\`, meaning: "reindent the selection by the language's rules" },
    ],
  },
  {
    group: "Editing",
    rows: [
      { pattern: `${MOD}+/  Alt+A`, meaning: "toggle the line comment / the block comment of the language" },
      { pattern: `${MOD}+Space`, meaning: "word completion: the words of this file and what the language knows" },
      { pattern: `${MOD}+Z  ${MOD}+Y`, meaning: "undo / redo" },
      { pattern: `${MOD}+U  Alt+U`, meaning: "undo / redo a selection change" },
      { pattern: `Shift+${MOD}+\\`, meaning: "jump to the matching bracket" },
      { pattern: `${MOD}+Shift+[  ${MOD}+Shift+]`, meaning: "fold / unfold the block at the cursor (the gutter triangles do the same)" },
      { pattern: `${MOD}+Alt+[  ${MOD}+Alt+]`, meaning: "fold / unfold everything" },
      { pattern: "Right click", meaning: "the context menu: clipboard, case, comments, completion, date, this line's direction, web search" },
    ],
  },
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
    this.contentEl.createEl("p", {
      cls: "nfe-modal-note",
      text: "Click a pattern to copy it.",
    });
    this.section("Syntax", SYNTAX);
    this.section("Common searches", EXAMPLES);
    this.contentEl.createEl("h3", { text: "Keys in the editor" });
    for (const { group, rows } of KEYS) {
      this.contentEl.createEl("h4", { text: group });
      this.table(rows, false);
    }
  }

  private section(heading: string, rows: readonly (Row & { readonly replaceNote?: string })[]): void {
    this.contentEl.createEl("h3", { text: heading });
    this.table(rows, true);
  }

  private table(rows: readonly (Row & { readonly replaceNote?: string })[], patterns: boolean): void {
    const table = this.contentEl.createEl("table", { cls: "nfe-regex-table" });
    for (const row of rows) {
      const tr = table.createEl("tr");
      const cell = tr.createEl("td");
      const code = cell.createEl("code", { text: row.pattern });
      if (patterns) {
        code.addClass("nfe-regex-copy");
        code.setAttribute("aria-label", "Click to copy");
        code.setAttribute("data-tooltip-position", "top");
        code.addEventListener("click", () => void copyText(row.pattern));
      }
      const td = tr.createEl("td", { text: row.meaning });
      if (row.replaceNote) {
        td.createEl("br");
        td.createSpan({ cls: "nfe-regex-replace", text: `Replace: ${row.replaceNote}` });
      }
    }
  }
}

/** The clipboard where the platform has one; a Notice says what happened either way. */
async function copyText(text: string): Promise<void> {
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") {
    new Notice("No clipboard here; select the pattern and copy it.");
    return;
  }
  try {
    await clipboard.writeText(text);
    new Notice(`Copied ${text}`);
  } catch (e) {
    new Notice(`Copy failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

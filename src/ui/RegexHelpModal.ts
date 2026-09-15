import { type App, Modal, Notice, Platform } from "obsidian";
import { HOTKEY_ACTIONS, type HotkeyAction, type HotkeyOverrides, NO_OVERRIDES, chordFor, describeChord, platformOf } from "../core/hotkeys";

/**
 * A short guide to regular expressions as the search panel uses them
 * (JavaScript's syntax, since the search runs on CodeMirror's `RegExp`), with
 * the examples people reach for, and the keys the editor answers to. Opened
 * from Settings → Editor and from the `?` in the pane's head bar. A click on a
 * pattern copies it (no copy icon, the pattern itself is the button); the
 * keys are shown as the user has mapped them. Plain DOM, no
 * HTML strings.
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

/**
 * The keys the editor answers to, by group: the remappable ones from
 * core/hotkeys.ts as the user has them, plus the fixed ones (CodeMirror's
 * own bindings the plugin does not remap, the mouse, the menu). Only keys
 * that reach the editor are listed: Obsidian's own hotkeys (Ctrl+I, Ctrl+K,
 * Ctrl+B, Ctrl+Enter …) are consumed before CodeMirror sees them unless the
 * pane takes them itself.
 */
function keyRows(overrides: HotkeyOverrides): ReadonlyArray<{ readonly group: string; readonly rows: readonly Row[] }> {
  const platform = platformOf(Platform);
  const mac = platform === "mac";
  const MOD = mac ? "Cmd" : "Ctrl";
  const key = (id: string) => describeChord(chordFor(id, overrides[platform], platform), mac);
  const mapped = (group: HotkeyAction["group"]): Row[] => HOTKEY_ACTIONS.filter((a) => a.group === group).map((a) => ({ pattern: key(a.id), meaning: a.meaning }));
  return [
    {
      group: "Search",
      rows: [
        ...mapped("Search"),
        { pattern: `Shift+${key("find-next-alt")}`, meaning: "previous match (the second key with Shift)" },
        { pattern: "Enter  Shift+Enter  Escape", meaning: "in the Find field: next / previous match; close the panel" },
      ],
    },
    {
      group: "Several cursors",
      rows: [
        ...mapped("Several cursors"),
        { pattern: "Alt+drag", meaning: "column selection: one range per line over the rectangle; on a shorter line the rectangle goes on past its end and the first keystroke pads with spaces (Notepad++'s column mode)" },
        { pattern: `${MOD}+click`, meaning: "add a cursor where you click" },
        { pattern: `←  →  ${MOD}+←  ${MOD}+→`, meaning: "with several cursors, each stays on its own line: past the line's end it goes on into virtual space instead of wrapping (← and Backspace come back through it; the first keystroke pads with spaces)" },
        { pattern: "Escape", meaning: "back to one cursor (with the search panel closed)" },
      ],
    },
    {
      group: "Lines",
      rows: [
        ...mapped("Lines"),
        { pattern: `Shift+${MOD}+K`, meaning: "delete the line" },
        { pattern: `Tab  Shift+Tab  ${MOD}+]  ${MOD}+[`, meaning: "indent / unindent the selected lines" },
        { pattern: `${MOD}+Alt+\\`, meaning: "reindent the selection by the language's rules" },
      ],
    },
    {
      group: "Editing",
      rows: [
        ...mapped("Editing"),
        { pattern: `${MOD}+Z  ${MOD}+Y`, meaning: "undo / redo" },
        { pattern: `${MOD}+U  Alt+U`, meaning: "undo / redo a selection change" },
        { pattern: `Shift+${MOD}+\\`, meaning: "jump to the matching bracket" },
        { pattern: `${MOD}+Shift+[  ${MOD}+Shift+]`, meaning: "fold / unfold the block at the cursor (the gutter triangles do the same)" },
        { pattern: `${MOD}+Alt+[  ${MOD}+Alt+]`, meaning: "fold / unfold everything" },
        { pattern: "Right click", meaning: "the context menu: clipboard, case, comments, completion, date, this line's direction, web search" },
      ],
    },
  ];
}

export class RegexHelpModal extends Modal {
  readonly title = "Keys and regular expressions";
  private readonly hotkeys: HotkeyOverrides;

  /** `hotkeys` is the user's remapping (settings, per platform), so the guide names the keys as they are on this one. */
  constructor(app: App, hotkeys: HotkeyOverrides = NO_OVERRIDES) {
    super(app);
    this.hotkeys = hotkeys;
  }

  override onOpen(): void {
    this.titleEl.setText(this.title);
    this.contentEl.addClass("nfe-modal", "nfe-regex-help");
    this.contentEl.createEl("p", {
      cls: "nfe-modal-note",
      text: "The keys with a row under Settings → Native File Editor → Hotkeys can be changed there; this list shows them as they are now.",
    });
    this.contentEl.createEl("h3", { text: "Keys in the editor" });
    for (const { group, rows } of keyRows(this.hotkeys)) {
      this.contentEl.createEl("h4", { text: group });
      this.table(rows, false);
    }
    this.contentEl.createEl("h3", { text: "Regular expressions in search" });
    this.contentEl.createEl("p", {
      text: "With the .* switch on, the Find field is a pattern rather than exact text, in JavaScript's syntax. Match case decides whether letters must match in case; Whole word adds \\b around the pattern. In the Replace field, $1, $2 … stand for the numbered groups of the match and $& for the whole match.",
    });
    // Under the patterns it speaks of, not at the top with the keys.
    this.contentEl.createEl("p", { cls: "nfe-modal-note", text: "Click a pattern below to copy it." });
    this.section("Syntax", SYNTAX);
    this.section("Common searches", EXAMPLES);
  }

  private section(heading: string, rows: readonly (Row & { readonly replaceNote?: string })[]): void {
    this.contentEl.createEl("h3", { text: heading });
    this.table(rows, true);
  }

  /**
   * A pattern is one `code` you can click; a key row is keycaps (the look of
   * the Hotkeys page, `nfe-hotkey-key`), one per key where the row names
   * several (`Ctrl+Z  Ctrl+Y`), so keys and patterns read as different things
   * (in one style they did not).
   */
  private table(rows: readonly (Row & { readonly replaceNote?: string })[], patterns: boolean): void {
    const table = this.contentEl.createEl("table", { cls: "nfe-regex-table" });
    for (const row of rows) {
      const tr = table.createEl("tr");
      const cell = tr.createEl("td");
      if (patterns) {
        const code = cell.createEl("code", { cls: "nfe-regex-copy", text: row.pattern });
        code.setAttribute("aria-label", "Click to copy");
        code.setAttribute("data-tooltip-position", "top");
        code.addEventListener("click", () => void copyText(row.pattern));
      } else {
        cell.addClass("nfe-regex-keys");
        for (const key of row.pattern.split("  ")) cell.createEl("kbd", { cls: "nfe-hotkey-key", text: key });
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

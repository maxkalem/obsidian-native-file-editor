import { type App, Modal, Notice, Platform } from "obsidian";
import { HOTKEY_ACTIONS, type HotkeyAction, type HotkeyOverrides, NO_OVERRIDES, chordFor, describeChord, hotkeyGroupName, hotkeyMeaning, platformOf } from "../core/hotkeys";
import { t } from "../core/i18n";

/**
 * A short guide to regular expressions as the search panel uses them
 * (JavaScript's syntax, since the search runs on CodeMirror's `RegExp`), with
 * the examples people reach for, and the keys the editor answers to. Opened
 * from Settings → Editor and from the `?` in the pane's head bar. A click on a
 * pattern copies it (no copy icon, the pattern itself is the button); the
 * keys are shown as the user has mapped them. Plain DOM, no
 * HTML strings.
 *
 * The patterns and the keycaps are the same in every language and stay as
 * they are; everything a reader reads goes through `t()`, and the tables are
 * built when the dialog opens rather than at module load, so the catalogue in
 * force is the one used.
 */

interface Row {
  readonly pattern: string;
  readonly meaning: string;
}

function syntaxRows(): readonly Row[] {
  return [
    { pattern: ".", meaning: t("guide.syntax.any") },
    { pattern: "\\d  \\w  \\s", meaning: t("guide.syntax.classes") },
    { pattern: "[abc]  [a-z]  [^0-9]", meaning: t("guide.syntax.set") },
    { pattern: "*  +  ?", meaning: t("guide.syntax.repeat") },
    { pattern: "{3}  {2,}  {1,5}", meaning: t("guide.syntax.counts") },
    { pattern: "^  $", meaning: t("guide.syntax.anchors") },
    { pattern: "\\b", meaning: t("guide.syntax.boundary") },
    { pattern: "a|b", meaning: t("guide.syntax.alternative") },
    { pattern: "( )", meaning: t("guide.syntax.group") },
    { pattern: "(?: )", meaning: t("guide.syntax.groupPlain") },
    { pattern: "(?= )  (?! )", meaning: t("guide.syntax.lookahead") },
    { pattern: "\\.  \\(  \\*", meaning: t("guide.syntax.escape") },
    { pattern: "*?  +?", meaning: t("guide.syntax.lazy") },
  ];
}

/** `replaceNote` says what goes into the Replace field and what it does. */
function exampleRows(): readonly (Row & { readonly replaceNote?: string })[] {
  return [
    { pattern: "^\\s+", meaning: t("guide.example.leadingSpace"), replaceNote: t("guide.example.leadingSpace.replace") },
    { pattern: "\\s+$", meaning: t("guide.example.trailingSpace"), replaceNote: t("guide.example.trailingSpace.replace") },
    { pattern: "^$\\n", meaning: t("guide.example.emptyLines") },
    { pattern: "^(\\s*)//.*$", meaning: t("guide.example.lineComment") },
    { pattern: "\\b\\d+\\b", meaning: t("guide.example.integer") },
    { pattern: "\\d+\\.\\d+", meaning: t("guide.example.decimal") },
    { pattern: "\\d{4}-\\d{2}-\\d{2}", meaning: t("guide.example.isoDate") },
    { pattern: "(\\d{2})\\.(\\d{2})\\.(\\d{4})", meaning: t("guide.example.dottedDate"), replaceNote: t("guide.example.dottedDate.replace") },
    { pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]+", meaning: t("guide.example.email") },
    { pattern: "https?://\\S+", meaning: t("guide.example.url") },
    { pattern: "\"([^\"]*)\"", meaning: t("guide.example.quoted"), replaceNote: t("guide.example.quoted.replace") },
    { pattern: "^(\\w+)\\s*=\\s*(.*)$", meaning: t("guide.example.keyValue"), replaceNote: t("guide.example.keyValue.replace") },
    { pattern: "\\bTODO\\b|\\bFIXME\\b", meaning: t("guide.example.todo") },
    { pattern: "^(?!.*keep).*$", meaning: t("guide.example.withoutWord") },
    { pattern: "(\\w+) \\1", meaning: t("guide.example.repeatedWord") },
  ];
}

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
  const mapped = (group: HotkeyAction["group"]): Row[] => HOTKEY_ACTIONS.filter((a) => a.group === group).map((a) => ({ pattern: key(a.id), meaning: hotkeyMeaning(a) }));
  return [
    {
      group: hotkeyGroupName("Search"),
      rows: [
        ...mapped("Search"),
        { pattern: `Shift+${key("find-next-alt")}`, meaning: t("guide.keys.previousAlt") },
        { pattern: "Enter  Shift+Enter  Escape", meaning: t("guide.keys.findField") },
      ],
    },
    {
      group: hotkeyGroupName("Several cursors"),
      rows: [
        ...mapped("Several cursors"),
        { pattern: t("guide.key.altDrag"), meaning: t("guide.keys.altDrag") },
        { pattern: t("guide.key.modClick", { mod: MOD }), meaning: t("guide.keys.modClick") },
        { pattern: `←  →  ${MOD}+←  ${MOD}+→`, meaning: t("guide.keys.virtualSpace") },
        { pattern: "Escape", meaning: t("guide.keys.oneCursor") },
      ],
    },
    {
      group: hotkeyGroupName("Lines"),
      rows: [
        ...mapped("Lines"),
        { pattern: `Shift+${MOD}+K`, meaning: t("guide.keys.deleteLine") },
        { pattern: `Tab  Shift+Tab  ${MOD}+]  ${MOD}+[`, meaning: t("guide.keys.indent") },
        { pattern: `${MOD}+Alt+\\`, meaning: t("guide.keys.reindent") },
      ],
    },
    {
      group: hotkeyGroupName("Editing"),
      rows: [
        ...mapped("Editing"),
        { pattern: `${MOD}+Z  ${MOD}+Y`, meaning: t("guide.keys.undo") },
        { pattern: `${MOD}+U  Alt+U`, meaning: t("guide.keys.undoSelection") },
        { pattern: `Shift+${MOD}+\\`, meaning: t("guide.keys.matchingBracket") },
        { pattern: `${MOD}+Shift+[  ${MOD}+Shift+]`, meaning: t("guide.keys.fold") },
        { pattern: `${MOD}+Alt+[  ${MOD}+Alt+]`, meaning: t("guide.keys.foldAll") },
        { pattern: t("guide.key.rightClick"), meaning: t("guide.keys.contextMenu") },
      ],
    },
  ];
}

export class RegexHelpModal extends Modal {
  private readonly hotkeys: HotkeyOverrides;

  /** `hotkeys` is the user's remapping (settings, per platform), so the guide names the keys as they are on this one. */
  constructor(app: App, hotkeys: HotkeyOverrides = NO_OVERRIDES) {
    super(app);
    this.hotkeys = hotkeys;
  }

  override onOpen(): void {
    this.titleEl.setText(t("guide.title"));
    this.contentEl.addClass("nfe-modal", "nfe-regex-help");
    this.contentEl.createEl("p", { cls: "nfe-modal-note", text: t("guide.note") });
    this.contentEl.createEl("h3", { text: t("guide.keys.heading") });
    for (const { group, rows } of keyRows(this.hotkeys)) {
      this.contentEl.createEl("h4", { text: group });
      this.table(rows, false);
    }
    this.contentEl.createEl("h3", { text: t("guide.regex.heading") });
    this.contentEl.createEl("p", { text: t("guide.regex.intro") });
    // Under the patterns it speaks of, not at the top with the keys.
    this.contentEl.createEl("p", { cls: "nfe-modal-note", text: t("guide.copy.note") });
    this.section(t("guide.syntax.heading"), syntaxRows());
    this.section(t("guide.examples.heading"), exampleRows());
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
        code.setAttribute("aria-label", t("guide.copy.tooltip"));
        code.setAttribute("data-tooltip-position", "top");
        code.addEventListener("click", () => void copyText(row.pattern));
      } else {
        cell.addClass("nfe-regex-keys");
        for (const key of row.pattern.split("  ")) cell.createEl("kbd", { cls: "nfe-hotkey-key", text: key });
      }
      const td = tr.createEl("td", { text: row.meaning });
      if (row.replaceNote) {
        td.createEl("br");
        td.createSpan({ cls: "nfe-regex-replace", text: t("guide.replace", { note: row.replaceNote }) });
      }
    }
  }
}

/** The clipboard where the platform has one; a Notice says what happened either way. */
async function copyText(text: string): Promise<void> {
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?: (t: string) => Promise<void> } } }).navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") {
    new Notice(t("notice.copy.noClipboard"));
    return;
  }
  try {
    await clipboard.writeText(text);
    new Notice(t("notice.copy.done", { pattern: text }));
  } catch (e) {
    new Notice(t("notice.copy.failed", { error: e instanceof Error ? e.message : String(e) }));
  }
}

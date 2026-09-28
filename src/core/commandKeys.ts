/**
 * The plugin's Obsidian commands and their default keys, and the two
 * conversions between this plugin's chord text and Obsidian's hotkey shape.
 *
 * Obsidian binds keys to commands and keeps the bindings in the vault's
 * `hotkeys.json`; its Settings → Hotkeys page is where they are normally
 * changed. This plugin's own Hotkeys page shows the same bindings in the same
 * list as the editor's keys and changes them through Obsidian's hotkey
 * manager, so that every key the plugin answers to is on ONE page (USER
 * 2026-09-22). The defaults below are his; Reread and Create example palette
 * ship without a key, also his word.
 *
 * Obsidian's hotkey is `{ modifiers: ["Mod", "Alt", "Shift"], key: "F" }`:
 * `Mod` is Ctrl on Windows and Linux and Cmd on macOS, the key is
 * `KeyboardEvent.key` (`"F"`, `"1"`, `"Pause"`, `"ArrowUp"`, `" "`), compared
 * without case (read in app.js 1.13.7, 2026-09-22: `getHotkeys`,
 * `getDefaultHotkeys`, `setHotkeys`, `removeHotkeys`, `save`, `bake`). Obsidian
 * does not tell the numeric keypad from the digit row — both arrive as the
 * digit — so a default written as `1` answers to Num1 as well.
 *
 * Pure: no Obsidian import. The probing of `app.hotkeyManager` is in `main.ts`.
 */

import { type Chord, chordText, parseChord } from "./hotkeys";
import { COMMAND_COMPRESS, COMMAND_FORMAT, COMMAND_NEW_FILE, COMMAND_RELOAD_PALETTES, COMMAND_RUN_FILE, COMMAND_STOP_RUN, COMMAND_TOGGLE_MODE, COMMAND_WRITE_EXAMPLE_PALETTE } from "../constants";

export const COMMAND_CASE_UPPER = "case-upper";
export const COMMAND_CASE_LOWER = "case-lower";
export const COMMAND_CASE_TITLE = "case-title";
export const COMMAND_CASE_SENTENCE = "case-sentence";
export const COMMAND_CASE_INVERT = "case-invert";
// The rest of what the menus offer, as commands with no key, so that a key
// CAN be given to any of them (USER 2026-09-22: "add every other command,
// empty"). Ids frozen like the others.
export const COMMAND_UNWRAP = "unwrap-lines";
export const COMMAND_WRAP = "wrap-lines";
export const COMMAND_ADD_TO_DICTIONARY = "add-to-dictionary";
export const COMMAND_INSERT_DATE = "insert-date";
export const COMMAND_INSERT_DATE_TIME = "insert-date-time";
export const COMMAND_TOGGLE_WORD_WRAP = "toggle-word-wrap";
export const COMMAND_TOGGLE_INVISIBLES = "toggle-invisibles";
export const COMMAND_LINE_AUTO = "line-direction-auto";
export const COMMAND_LINE_LTR = "line-direction-ltr";
export const COMMAND_LINE_RTL = "line-direction-rtl";
export const COMMAND_SEARCH_WEB = "search-web";
export const COMMAND_KEYS_GUIDE = "keys-guide";

export interface CommandKey {
  /** The command id without the plugin prefix, as `addCommand` takes it. */
  readonly id: string;
  /** The catalogue key of the command's name. */
  readonly nameKey: string;
  /** The default chord in this plugin's text form, or null for a command that ships unbound. */
  readonly key: string | null;
  /** Registered on the desktop only (ADR-004): no row on a phone. */
  readonly desktopOnly?: boolean;
}

export const COMMAND_KEYS: readonly CommandKey[] = [
  { id: COMMAND_TOGGLE_MODE, nameKey: "command.toggleMode", key: "Ctrl+Alt+Shift+E" },
  { id: COMMAND_NEW_FILE, nameKey: "command.newFile", key: "Ctrl+Alt+Shift+N" },
  { id: COMMAND_FORMAT, nameKey: "command.format", key: "Ctrl+Alt+Shift+F" },
  { id: COMMAND_COMPRESS, nameKey: "command.compress", key: "Ctrl+Alt+Shift+C" },
  { id: COMMAND_CASE_UPPER, nameKey: "command.case.upper", key: "Ctrl+Alt+Shift+1" },
  { id: COMMAND_CASE_LOWER, nameKey: "command.case.lower", key: "Ctrl+Alt+Shift+2" },
  { id: COMMAND_CASE_TITLE, nameKey: "command.case.title", key: "Ctrl+Alt+Shift+3" },
  { id: COMMAND_CASE_SENTENCE, nameKey: "command.case.sentence", key: "Ctrl+Alt+Shift+4" },
  { id: COMMAND_CASE_INVERT, nameKey: "command.case.invert", key: "Ctrl+Alt+Shift+5" },
  { id: COMMAND_RUN_FILE, nameKey: "command.run", key: "Ctrl+Alt+Shift+R", desktopOnly: true },
  { id: COMMAND_STOP_RUN, nameKey: "command.stop", key: "Ctrl+Alt+Shift+Pause", desktopOnly: true },
  { id: COMMAND_UNWRAP, nameKey: "command.unwrap", key: null },
  { id: COMMAND_WRAP, nameKey: "command.wrap", key: null },
  { id: COMMAND_ADD_TO_DICTIONARY, nameKey: "command.addToDictionary", key: null },
  { id: COMMAND_INSERT_DATE, nameKey: "command.insertDate", key: null },
  { id: COMMAND_INSERT_DATE_TIME, nameKey: "command.insertDateTime", key: null },
  { id: COMMAND_TOGGLE_WORD_WRAP, nameKey: "command.toggleWordWrap", key: null },
  { id: COMMAND_TOGGLE_INVISIBLES, nameKey: "command.toggleInvisibles", key: null },
  { id: COMMAND_LINE_AUTO, nameKey: "command.lineAuto", key: null },
  { id: COMMAND_LINE_LTR, nameKey: "command.lineLtr", key: null },
  { id: COMMAND_LINE_RTL, nameKey: "command.lineRtl", key: null },
  { id: COMMAND_SEARCH_WEB, nameKey: "command.searchWeb", key: null },
  { id: COMMAND_KEYS_GUIDE, nameKey: "command.keysGuide", key: null },
  { id: COMMAND_RELOAD_PALETTES, nameKey: "command.reread", key: null },
  { id: COMMAND_WRITE_EXAMPLE_PALETTE, nameKey: "command.examplePalette", key: null },
];

/** Obsidian's hotkey shape, as `addCommand` and the hotkey manager take it. */
export type ObsidianModifier = "Mod" | "Ctrl" | "Meta" | "Shift" | "Alt";
export interface ObsidianHotkey {
  /** Mutable, because Obsidian's `Hotkey` type is: `addCommand` takes these as they are. */
  modifiers: ObsidianModifier[];
  key: string;
}

/** A chord as Obsidian stores it: `Mod` for the command key, the key as `KeyboardEvent.key`. */
export function toObsidianHotkey(chord: Chord): ObsidianHotkey {
  const modifiers: ObsidianModifier[] = [];
  if (chord.mod) modifiers.push("Mod");
  if (chord.alt) modifiers.push("Alt");
  if (chord.shift) modifiers.push("Shift");
  return { modifiers, key: chord.key === "Space" ? " " : chord.key };
}

/**
 * One of Obsidian's hotkeys as a chord, or null for a shape this plugin cannot
 * show (no key, an unknown modifier only Obsidian knows). `Ctrl` and `Meta`
 * are read as the command key too: this plugin's chords have one modifier
 * for both, and a binding made on Obsidian's page with a bare Ctrl on a Mac
 * is shown as Cmd here — the row says so through the keycap, not silently.
 */
export function fromObsidianHotkey(raw: unknown): Chord | null {
  if (raw === null || typeof raw !== "object") return null;
  const hotkey = raw as { modifiers?: unknown; key?: unknown; code?: unknown };
  const modifiers = Array.isArray(hotkey.modifiers) ? hotkey.modifiers.filter((m): m is string => typeof m === "string") : [];
  const key = typeof hotkey.key === "string" ? hotkey.key : typeof hotkey.code === "string" ? hotkey.code.replace(/^Key([A-Z])$/, "$1") : "";
  if (key.length === 0) return null;
  const parts: string[] = [];
  if (modifiers.some((m) => /^(Mod|Ctrl|Meta)$/.test(m))) parts.push("Ctrl");
  if (modifiers.includes("Shift")) parts.push("Shift");
  if (modifiers.includes("Alt")) parts.push("Alt");
  parts.push(key === " " ? "Space" : key);
  return parseChord(parts.join("+"));
}

/** The default chord of a command, parsed once; null for one that ships unbound. */
export function defaultCommandChord(command: CommandKey): Chord | null {
  if (command.key === null) return null;
  const chord = parseChord(command.key);
  if (!chord) throw new Error(`command ${command.id} has an unparsable default ${command.key}`);
  return chord;
}

/** The default hotkeys for `addCommand`: one or none. */
export function defaultObsidianHotkeys(command: CommandKey): ObsidianHotkey[] {
  const chord = defaultCommandChord(command);
  return chord ? [toObsidianHotkey(chord)] : [];
}

/** Whether two lists of chords are the same bindings in the same order. */
export function sameChords(a: readonly Chord[], b: readonly Chord[]): boolean {
  return a.length === b.length && a.every((chord, i) => chordText(chord) === chordText(b[i]!));
}

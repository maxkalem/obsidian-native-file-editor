/**
 * The plugin's own key bindings, by name, with the user's remapping: a
 * settings section, like Custom file types, lists every key the plugin takes
 * and lets each be changed; the guide then shows the keys as mapped. Pure:
 * parsing and matching only. Two consumers:
 *
 * - the view's Scope (`TextView.nfeKeyAction`), which matches by PHYSICAL key
 *   (`evt.code`) so a Ukrainian layout's Ctrl+F is Ctrl+F: `matchesEvent`;
 * - CodeMirror's keymap (`ui/columnMode.ts`), which wants its own key
 *   strings ("Mod-Alt-ArrowUp"): `toCodeMirrorKey`.
 *
 * A chord is stored as text, `Ctrl+Alt+ArrowUp`: modifiers in any order, then
 * one key. `Ctrl` here means the platform's command key (Cmd on macOS), as
 * Obsidian's `Mod`; `Meta` and `Cmd` are read as the same thing.
 *
 * Defaults differ by platform: `key` is Windows's and
 * Linux's, `mac` macOS's where the Mac does it differently (Cmd+Space is
 * Spotlight, Option+letter types a character, Cmd+G is "find next", search
 * and replace is Cmd+Alt+F as in Obsidian itself). The user's overrides are
 * kept per platform too, so a remap on the PC does not land on the Mac.
 */

export type HotkeyWhere = "scope" | "editor";

/** The three keyboards the defaults are written for; iOS counts as mac (Cmd), Android as linux (Ctrl). */
export type HotkeyPlatform = "win" | "mac" | "linux";
export const HOTKEY_PLATFORMS: readonly HotkeyPlatform[] = ["win", "mac", "linux"];

/** Which of the three this device is, from Obsidian's `Platform` flags. */
export function platformOf(p: { isMacOS?: boolean; isIosApp?: boolean; isWin?: boolean }): HotkeyPlatform {
  if (p.isMacOS || p.isIosApp) return "mac";
  if (p.isWin) return "win";
  return "linux";
}

/** The user's overrides, action id → chord text, one map per platform. */
export type HotkeyOverrides = Readonly<Record<HotkeyPlatform, Readonly<Record<string, string>>>>;
export const NO_OVERRIDES: HotkeyOverrides = { win: {}, mac: {}, linux: {} };

export interface HotkeyAction {
  readonly id: string;
  readonly name: string;
  /** The default chord on Windows and Linux, in the text form. */
  readonly key: string;
  /** The default on macOS when it differs; else `key` with Cmd for Ctrl. */
  readonly mac?: string;
  /**
   * `scope`: taken by the view's Scope ahead of Obsidian, by physical key.
   * `editor`: a CodeMirror keymap binding inside the text.
   */
  readonly where: HotkeyWhere;
  /** One sentence for the guide. */
  readonly meaning: string;
  /** The guide's group. */
  readonly group: "Search" | "Several cursors" | "Lines" | "Editing";
}

export const HOTKEY_ACTIONS: readonly HotkeyAction[] = [
  { id: "search", name: "Search", key: "Ctrl+F", where: "scope", group: "Search", meaning: "open the search panel (Escape closes it)" },
  { id: "replace", name: "Search and replace", key: "Ctrl+H", mac: "Cmd+Alt+F", where: "scope", group: "Search", meaning: "the same panel with the Replace row (editor only)" },
  { id: "find-next", name: "Next match", key: "F3", mac: "Cmd+G", where: "scope", group: "Search", meaning: "next match, panel open or not" },
  { id: "find-previous", name: "Previous match", key: "Shift+F3", mac: "Shift+Cmd+G", where: "scope", group: "Search", meaning: "previous match" },
  { id: "find-next-alt", name: "Next match (second key)", key: "Ctrl+G", mac: "F3", where: "scope", group: "Search", meaning: "next match; with Shift, previous" },
  { id: "select-all-matches", name: "Select all matches", key: "Alt+Enter", where: "scope", group: "Search", meaning: "every match becomes a selection and the text takes the focus: typing changes all of them (panel open)" },
  { id: "replace-all", name: "Replace all", key: "Ctrl+Alt+Enter", where: "scope", group: "Search", meaning: "replace every match (panel open; in the Replace field, Enter replaces one)" },
  { id: "rename", name: "Rename file", key: "F2", where: "scope", group: "Editing", meaning: "Obsidian's rename dialog for the file" },
  { id: "add-cursor-above", name: "Add cursor above", key: "Ctrl+Alt+ArrowUp", where: "editor", group: "Several cursors", meaning: "a cursor on the line above, in the same column (at the end of a shorter line)" },
  { id: "add-cursor-below", name: "Add cursor below", key: "Ctrl+Alt+ArrowDown", where: "editor", group: "Several cursors", meaning: "a cursor on the line below" },
  { id: "select-next-occurrence", name: "Add next occurrence", key: "Ctrl+D", where: "scope", group: "Several cursors", meaning: "the next occurrence of the selected text becomes another selection" },
  { id: "select-all-occurrences", name: "Select all occurrences", key: "Ctrl+Shift+L", where: "scope", group: "Several cursors", meaning: "every occurrence of the selected text (or of the word at the cursor), also after Add next occurrence" },
  { id: "move-line-up", name: "Move line up", key: "Alt+ArrowUp", where: "editor", group: "Lines", meaning: "move the line (or the selected lines) up" },
  { id: "move-line-down", name: "Move line down", key: "Alt+ArrowDown", where: "editor", group: "Lines", meaning: "move the line down" },
  { id: "copy-line-up", name: "Copy line up", key: "Shift+Alt+ArrowUp", where: "editor", group: "Lines", meaning: "copy the line up" },
  { id: "copy-line-down", name: "Copy line down", key: "Shift+Alt+ArrowDown", where: "editor", group: "Lines", meaning: "copy the line down" },
  { id: "select-line", name: "Select line", key: "Alt+L", where: "editor", group: "Lines", meaning: "select the line" },
  { id: "toggle-line-comment", name: "Toggle line comment", key: "Ctrl+/", where: "scope", group: "Editing", meaning: "the language's line comment on the selected lines" },
  { id: "toggle-block-comment", name: "Toggle block comment", key: "Alt+A", mac: "Cmd+Alt+/", where: "editor", group: "Editing", meaning: "the language's block comment around the selection" },
  { id: "completion", name: "Word completion", key: "Ctrl+Space", mac: "Alt+Space", where: "scope", group: "Editing", meaning: "the words of this file and what the language knows" },
];

export interface Chord {
  readonly mod: boolean;
  readonly shift: boolean;
  readonly alt: boolean;
  /** The key, in the canonical spelling: a capital letter, a digit, `ArrowUp`, `Enter`, `Space`, `F3`, or a punctuation character. */
  readonly key: string;
}

const KEY_ALIASES: Record<string, string> = {
  up: "ArrowUp",
  down: "ArrowDown",
  left: "ArrowLeft",
  right: "ArrowRight",
  arrowup: "ArrowUp",
  arrowdown: "ArrowDown",
  arrowleft: "ArrowLeft",
  arrowright: "ArrowRight",
  "↑": "ArrowUp",
  "↓": "ArrowDown",
  "←": "ArrowLeft",
  "→": "ArrowRight",
  enter: "Enter",
  return: "Enter",
  space: "Space",
  spacebar: "Space",
  tab: "Tab",
  escape: "Escape",
  esc: "Escape",
  backspace: "Backspace",
  delete: "Delete",
  del: "Delete",
  home: "Home",
  end: "End",
  pageup: "PageUp",
  pagedown: "PageDown",
  insert: "Insert",
};

/** `Ctrl+Alt+ArrowUp` → a chord, or null when the text is not one (no key, an unknown word). */
export function parseChord(text: string): Chord | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  // A literal "+" as the key ("Ctrl++", or "+" alone): the split would eat it.
  const plusKey = trimmed === "+" || trimmed.endsWith("++");
  const body = plusKey ? trimmed.slice(0, -1) : trimmed;
  const parts = body
    .split("+")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  let mod = false;
  let shift = false;
  let alt = false;
  let key: string | null = plusKey ? "+" : null;
  for (const part of parts) {
    const lower = part.toLowerCase();
    if (/^(ctrl|control|cmd|command|meta|mod)$/.test(lower)) mod = true;
    else if (/^(alt|option)$/.test(lower)) alt = true;
    else if (lower === "shift") shift = true;
    else if (key !== null) return null;
    else {
      key = canonicalKey(part);
      if (key === null) return null;
    }
  }
  if (key === null) return null;
  return { mod, shift, alt, key };
}

function canonicalKey(part: string): string | null {
  const alias = KEY_ALIASES[part.toLowerCase()];
  if (alias) return alias;
  if (/^[A-Za-z]$/.test(part)) return part.toUpperCase();
  if (/^[0-9]$/.test(part)) return part;
  if (/^F([1-9]|1[0-9]|2[0-4])$/i.test(part)) return `F${part.slice(1)}`;
  if (part.length === 1) return part;
  return null;
}

/** The chord as the settings show it: `Ctrl+Alt+↑` (Cmd on macOS). */
export function describeChord(chord: Chord, mac = false): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(mac ? "Cmd" : "Ctrl");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  const arrows: Record<string, string> = { ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→" };
  parts.push(arrows[chord.key] ?? chord.key);
  return parts.join("+");
}

/** The chord as stored: `Ctrl+Alt+ArrowUp`. */
export function chordText(chord: Chord): string {
  const parts: string[] = [];
  if (chord.mod) parts.push("Ctrl");
  if (chord.shift) parts.push("Shift");
  if (chord.alt) parts.push("Alt");
  parts.push(chord.key);
  return parts.join("+");
}

/** The physical key of a keyboard event in the chord's spelling, or null for a key the chords do not name (a bare modifier, a dead key). */
export function keyOfEvent(evt: { code: string; key: string }): string | null {
  const code = evt.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code;
  if (code === "NumpadEnter") return "Enter";
  if (/^(Arrow(Up|Down|Left|Right)|Enter|Space|Tab|Escape|Backspace|Delete|Home|End|PageUp|PageDown|Insert)$/.test(code)) return code;
  const punctuation: Record<string, string> = {
    Slash: "/",
    Backslash: "\\",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Minus: "-",
    Equal: "=",
    Backquote: "`",
    NumpadAdd: "+",
    NumpadSubtract: "-",
  };
  const p = punctuation[code];
  if (p) return p;
  // A layout without physical codes (some mobile keyboards): the key itself, when it is one printable character.
  if (code === "" && evt.key.length === 1) return /^[a-z]$/i.test(evt.key) ? evt.key.toUpperCase() : evt.key;
  return null;
}

/** A chord from a key event, for recording in the settings; null on a bare modifier. */
export function chordOfEvent(evt: { code: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, mac = false): Chord | null {
  const key = keyOfEvent(evt);
  if (key === null) return null;
  return { mod: mac ? evt.metaKey : evt.ctrlKey, shift: evt.shiftKey, alt: evt.altKey, key };
}

/** Whether a key event is this chord, by physical key and exact modifiers (Mod is Cmd on macOS, Ctrl elsewhere). */
export function matchesEvent(chord: Chord, evt: { code: string; key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }, mac = false): boolean {
  const mod = mac ? evt.metaKey : evt.ctrlKey;
  const other = mac ? evt.ctrlKey : evt.metaKey;
  if (other) return false;
  if (mod !== chord.mod || evt.shiftKey !== chord.shift || evt.altKey !== chord.alt) return false;
  return keyOfEvent(evt) === chord.key;
}

/** The chord as a CodeMirror keymap string: `Mod-Alt-ArrowUp`, `Shift-Alt-ArrowDown`, `Alt-l`. */
export function toCodeMirrorKey(chord: Chord): string {
  const parts: string[] = [];
  if (chord.shift) parts.push("Shift");
  if (chord.mod) parts.push("Mod");
  if (chord.alt) parts.push("Alt");
  parts.push(/^[A-Z]$/.test(chord.key) ? chord.key.toLowerCase() : chord.key === "Space" ? " " : chord.key);
  return parts.join("-");
}

/** An action's default chord on a platform. */
export function defaultChord(action: HotkeyAction, platform: HotkeyPlatform): Chord {
  const text = platform === "mac" && action.mac ? action.mac : action.key;
  const chord = parseChord(text);
  if (!chord) throw new Error(`hotkey ${action.id} has an unparsable default ${text}`);
  return chord;
}

/** The chord in force for an action on a platform: the user's when it parses, else the default. */
export function chordFor(id: string, overrides: Readonly<Record<string, string>>, platform: HotkeyPlatform): Chord {
  const action = HOTKEY_ACTIONS.find((a) => a.id === id);
  if (!action) throw new Error(`unknown hotkey action ${id}`);
  const own = overrides[id];
  return (own !== undefined ? parseChord(own) : null) ?? defaultChord(action, platform);
}

/**
 * One of Obsidian's active hotkeys as its hotkey manager bakes them
 * (`app.hotkeyManager.bakedHotkeys`, read in app.js 1.13.7, 2026-09-14):
 * the modifiers with Mod already resolved (Ctrl, or Meta on macOS), sorted
 * and joined by a comma (`Alt,Ctrl`), and the key as `KeyboardEvent.key` or
 * the letter of a `Key*` code. Not in the typings; the caller probes.
 */
export interface BakedHotkey {
  readonly modifiers: string;
  readonly key: string;
}

/** The chord's modifiers in the baked spelling. */
export function obsidianModifiers(chord: Chord, mac = false): string {
  const parts: string[] = [];
  if (chord.mod) parts.push(mac ? "Meta" : "Ctrl");
  if (chord.alt) parts.push("Alt");
  if (chord.shift) parts.push("Shift");
  return parts.sort().join(",");
}

/** Whether a baked Obsidian hotkey is this chord (the key compared as Obsidian's `isMatch` does, without case). */
export function bakedMatches(baked: BakedHotkey, chord: Chord, mac = false): boolean {
  if (typeof baked.modifiers !== "string" || typeof baked.key !== "string") return false;
  if (baked.modifiers !== obsidianModifiers(chord, mac)) return false;
  const key = chord.key === "Space" ? " " : chord.key;
  return baked.key.toLowerCase() === key.toLowerCase();
}

/** Actions that share one chord on a platform, as `[[id, id], …]`; the settings warn about them. */
export function chordConflicts(overrides: Readonly<Record<string, string>>, platform: HotkeyPlatform): string[][] {
  const byKey = new Map<string, string[]>();
  for (const a of HOTKEY_ACTIONS) {
    const k = chordText(chordFor(a.id, overrides, platform));
    byKey.set(k, [...(byKey.get(k) ?? []), a.id]);
  }
  return [...byKey.values()].filter((ids) => ids.length > 1);
}

/** One platform's overrides: only what differs from that platform's defaults and parses. */
function normalizePlatformHotkeys(raw: unknown, platform: HotkeyPlatform): Record<string, string> {
  const out: Record<string, string> = {};
  if (typeof raw !== "object" || raw === null) return out;
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const action = HOTKEY_ACTIONS.find((a) => a.id === id);
    if (!action || typeof value !== "string") continue;
    const chord = parseChord(value);
    if (!chord) continue;
    const text = chordText(chord);
    if (text !== chordText(defaultChord(action, platform))) out[id] = text;
  }
  return out;
}

/**
 * The overrides per platform, as `normalizeSettings` keeps them. A flat map
 * of action ids (the shape of 2026-09-09 afternoon, before defaults went per
 * platform) is read as Windows's, the one platform it was ever made on.
 */
export function normalizeHotkeys(raw: unknown): HotkeyOverrides {
  if (typeof raw !== "object" || raw === null) return NO_OVERRIDES;
  const obj = raw as Record<string, unknown>;
  const flat = Object.keys(obj).some((k) => HOTKEY_ACTIONS.some((a) => a.id === k));
  if (flat) return { win: normalizePlatformHotkeys(obj, "win"), mac: {}, linux: {} };
  return {
    win: normalizePlatformHotkeys(obj.win, "win"),
    mac: normalizePlatformHotkeys(obj.mac, "mac"),
    linux: normalizePlatformHotkeys(obj.linux, "linux"),
  };
}

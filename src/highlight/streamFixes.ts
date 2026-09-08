import type { StreamParser } from "@codemirror/language";
import type { KeywordLanguage } from "./keywordMode";

/**
 * Small corrections to legacy modes whose token vocabulary reads wrong on the
 * device (2026-09-07 pass). Each wrapper keeps the mode's state and everything
 * else and changes only what the token function returns; a mode that is right
 * is left alone. Token names here are the names the modes return (lezer tag
 * names or CodeMirror 5 names); obsidianFork.ts turns them into classes.
 */

type Rename = Readonly<Record<string, string>> | ((raw: string, text: string) => string);

/**
 * Rename whole token names, by map or by function of the name and the text.
 * The properties mode calls a key `def` (uncoloured in Obsidian), a value
 * `quote` (blockquote colour) and a section `header`; rpm and troff have the
 * same habit. A name the map does not mention stays.
 */
export function retag<S>(parser: StreamParser<S>, rename: Rename): StreamParser<S> {
  const one = typeof rename === "function" ? rename : (raw: string) => rename[raw] ?? raw;
  return {
    ...parser,
    token(stream, state) {
      const raw = parser.token(stream, state);
      if (!raw) return raw;
      const text = stream.current();
      return raw
        .split(" ")
        .filter(Boolean)
        .map((name) => one(name, text))
        .join(" ");
    },
  };
}

/**
 * A line comment the mode does not know: `marker` as the first thing on a
 * line (after indentation) comments the rest of it. The N-Triples mode reads
 * `#` only as a URI fragment.
 */
export function withLineComment<S>(parser: StreamParser<S>, marker: string): StreamParser<S> {
  return {
    ...parser,
    token(stream, state) {
      if (/^\s*$/.test(stream.string.slice(0, stream.pos)) && stream.match(new RegExp(`^\\s*${escapeRegExp(marker)}.*`))) return "comment";
      return parser.token(stream, state);
    },
  };
}

/**
 * A mode that matches a word by prefix (the mscgen family reads `Autosave`
 * as the constant `auto` followed by `save`) is made to take the whole word:
 * when the mode's token ends inside a word, the rest of the word is added and
 * the token becomes a plain variable name.
 */
export function wholeWords<S>(parser: StreamParser<S>): StreamParser<S> {
  return {
    ...parser,
    token(stream, state) {
      const raw = parser.token(stream, state);
      const consumed = stream.current();
      const next = stream.peek();
      if (/^[A-Za-z_]\w*$/.test(consumed) && next !== undefined && /\w/.test(next)) {
        stream.eatWhile(/\w/);
        return "variableName";
      }
      return raw;
    },
  };
}

/**
 * A word the mode leaves plain, that a Notepad++ table knows, gets the
 * table's role (Tcl: `dict`, `clock`, `chan`, ... 238 commands the legacy
 * mode does not list). Words the mode does colour keep the mode's choice; the
 * table only fills gaps. Roles map as in keywordMode's TAG_BY_ROLE.
 */
export function withFallbackKeywords<S>(parser: StreamParser<S>, table: KeywordLanguage): StreamParser<S> {
  const roles: Record<string, string> = { keyword: "keyword", builtin: "variableName.standard", type: "typeName", constant: "atom", property: "propertyName", meta: "meta", special: "variableName.special" };
  const words = new Map<string, string>();
  for (const [role, list] of table.sets) {
    for (const w of list.split(/\s+/)) {
      if (w.length === 0) continue;
      const key = table.caseInsensitive ? w.toLowerCase() : w;
      if (!words.has(key)) words.set(key, roles[role] ?? "keyword");
    }
  }
  return {
    ...parser,
    token(stream, state) {
      const raw = parser.token(stream, state);
      if (raw) return raw;
      const text = stream.current();
      if (!/^[A-Za-z_][\w:.-]*$/.test(text)) return raw;
      return words.get(table.caseInsensitive ? text.toLowerCase() : text) ?? raw;
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

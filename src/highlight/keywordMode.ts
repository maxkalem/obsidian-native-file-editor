import type { StreamParser } from "@codemirror/language";

/**
 * Tier 4: one generic stream mode driven by data. The data is a language's
 * comment syntax and its keyword sets, in the shape Notepad++'s
 * `langs.model.xml` has them (converted at build time into
 * `langs.generated.ts`) and the shape a JSON file in the vault's language
 * folder will have. Highlighting from it is comments, strings, numbers,
 * operators, brackets and words looked up in the sets: worse than a grammar,
 * far better than plain text, and it is what makes "every extension opens
 * coloured" true.
 */

/** What a keyword set colours as; the mode emits the matching lezer tag name. */
export type KeywordRole = "keyword" | "builtin" | "type" | "constant" | "property" | "meta" | "special";

export interface KeywordLanguage {
  /** Notepad++'s lexer name, or the file name of a vault definition. */
  readonly id: string;
  /** Shown in the head bar. */
  readonly name: string;
  /** Lower-case extensions without the dot. */
  readonly extensions: readonly string[];
  readonly caseInsensitive: boolean;
  readonly commentLine: string | null;
  readonly commentStart: string | null;
  readonly commentEnd: string | null;
  /** Each set: its role and its words, space-separated (one string is far smaller in the bundle than an array). */
  readonly sets: ReadonlyArray<readonly [role: KeywordRole, words: string]>;
  /** Further line-comment markers (Batch: `::` beside `REM`). Optional; absent in Notepad++'s table, added by the converter's supplement or a vault file. */
  readonly commentLines?: readonly string[];
  /**
   * Patterns the words cannot express, tried before words: a regular
   * expression source (matched at the current position, `^` implied) and the
   * lezer tag name it yields; `sol` limits it to the start of a line. Batch
   * uses them for `:label` and `%VAR%`.
   */
  readonly patterns?: ReadonlyArray<{ readonly regex: string; readonly token: string; readonly sol?: boolean }>;
}

const TAG_BY_ROLE: Readonly<Record<KeywordRole, string>> = {
  keyword: "keyword",
  builtin: "variableName.standard",
  type: "typeName",
  constant: "atom",
  property: "propertyName",
  meta: "meta",
  special: "variableName.special",
};

interface KeywordState {
  /** Inside a block comment. */
  inComment: boolean;
}

const NUMBER = /^(?:0[xX][0-9a-fA-F_]+|\d[\d_]*(?:\.\d*)?(?:[eE][+-]?\d+)?)/;
const WORD = /^[A-Za-z_$][\w$]*/;
const OPERATOR = /^(?:[+\-*/%=<>!&|^~?]+|::|->)/;
const BRACKET = /^[()[\]{}]/;
const PUNCTUATION = /^[;,.]/;

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * The stream parser for one language. Word lookup is one Map from word to
 * tag, built once per language; case-insensitive languages lower-case both
 * sides. The comment delimiters are matched literally.
 */
export function keywordMode(def: KeywordLanguage): StreamParser<KeywordState> {
  const words = new Map<string, string>();
  for (const [role, list] of def.sets) {
    const tag = TAG_BY_ROLE[role];
    for (const w of list.split(/\s+/)) {
      if (w.length === 0) continue;
      const key = def.caseInsensitive ? w.toLowerCase() : w;
      // The first set that names a word wins, as in Notepad++ (instre1 before type1).
      if (!words.has(key)) words.set(key, tag);
    }
  }
  // A line marker that is a word (`REM`) ends at a word boundary and follows
  // the language's case rule: `rem` in a batch file is a comment too
  // (2026-09-08). A marker of symbols (`#`, `::`) matches as it is.
  const lineMarkers = [def.commentLine, ...(def.commentLines ?? [])].filter((m): m is string => typeof m === "string" && m.length > 0);
  const lines = lineMarkers.map((m) => new RegExp(`^${escapeRegExp(m)}${/\w$/.test(m) ? "\\b" : ""}.*`, def.caseInsensitive ? "i" : ""));
  const patterns = (def.patterns ?? []).map((p) => ({ regex: new RegExp(`^(?:${p.regex})`), token: p.token, sol: p.sol === true }));
  const start = def.commentStart ? new RegExp(`^${escapeRegExp(def.commentStart)}`) : null;
  const end = def.commentEnd ? escapeRegExp(def.commentEnd) : null;
  const endRe = end ? new RegExp(`^[\\s\\S]*?${end}`) : null;

  return {
    name: def.id,
    startState: () => ({ inComment: false }),
    copyState: (s) => ({ inComment: s.inComment }),
    token(stream, state) {
      if (state.inComment) {
        if (endRe && stream.match(endRe)) state.inComment = false;
        else stream.skipToEnd();
        return "comment";
      }
      if (stream.eatSpace()) return null;
      for (const l of lines) if (stream.match(l)) return "comment";
      for (const p of patterns) {
        if (p.sol && !/^\s*$/.test(stream.string.slice(0, stream.pos))) continue;
        if (stream.match(p.regex)) return p.token;
      }
      if (start && endRe && stream.match(start)) {
        if (stream.match(endRe)) return "comment";
        state.inComment = true;
        stream.skipToEnd();
        return "comment";
      }
      if (stream.match(/^"(?:[^"\\]|\\.)*"?/) || stream.match(/^'(?:[^'\\]|\\.)*'?/)) return "string";
      if (stream.match(NUMBER)) return "number";
      if (stream.match(WORD)) {
        const w = stream.current();
        return words.get(def.caseInsensitive ? w.toLowerCase() : w) ?? null;
      }
      if (stream.match(OPERATOR)) return "operator";
      if (stream.match(BRACKET)) return "bracket";
      if (stream.match(PUNCTUATION)) return "punctuation";
      stream.next();
      return null;
    },
    languageData: {
      commentTokens: {
        ...(def.commentLine ? { line: def.commentLine } : {}),
        ...(def.commentStart && def.commentEnd ? { block: { open: def.commentStart, close: def.commentEnd } } : {}),
      },
    },
  };
}

const ROLES: ReadonlySet<string> = new Set(["keyword", "builtin", "type", "constant", "property", "meta", "special"]);

/**
 * A definition from JSON (the vault language folder, later): every field
 * checked, anything wrong named. The same shape the converter emits, so a
 * user can copy a generated entry as a starting point.
 */
export function parseKeywordLanguage(raw: unknown, fallbackId: string): { language: KeywordLanguage } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "not an object" };
  const r = raw as Record<string, unknown>;
  const name = typeof r.name === "string" && r.name.trim().length > 0 ? r.name.trim() : null;
  if (!name) return { error: "name is missing" };
  if (!Array.isArray(r.extensions) || r.extensions.length === 0 || !r.extensions.every((e) => typeof e === "string" && /^\.?[a-z0-9_+-]+$/i.test(e))) {
    return { error: "extensions must be a non-empty list of extensions without dots" };
  }
  const str = (k: string): string | null | undefined => (r[k] === undefined || r[k] === null ? null : typeof r[k] === "string" ? (r[k] as string) : undefined);
  const commentLine = str("commentLine");
  const commentStart = str("commentStart");
  const commentEnd = str("commentEnd");
  if (commentLine === undefined || commentStart === undefined || commentEnd === undefined) return { error: "comment fields must be strings" };
  if ((commentStart === null) !== (commentEnd === null)) return { error: "commentStart and commentEnd go together" };
  const sets: Array<readonly [KeywordRole, string]> = [];
  if (r.sets !== undefined) {
    if (!Array.isArray(r.sets)) return { error: "sets must be a list of [role, words] pairs" };
    for (const s of r.sets) {
      if (!Array.isArray(s) || s.length !== 2 || typeof s[0] !== "string" || !ROLES.has(s[0])) return { error: `a set's role must be one of ${[...ROLES].join(", ")}` };
      const words = Array.isArray(s[1]) ? (s[1] as unknown[]).filter((w): w is string => typeof w === "string").join(" ") : typeof s[1] === "string" ? s[1] : null;
      if (words === null) return { error: "a set's words must be a string or a list of strings" };
      sets.push([s[0] as KeywordRole, words]);
    }
  }
  const commentLines: string[] = [];
  if (r.commentLines !== undefined) {
    if (!Array.isArray(r.commentLines) || !r.commentLines.every((c) => typeof c === "string" && c.length > 0)) return { error: "commentLines must be a list of non-empty strings" };
    commentLines.push(...(r.commentLines as string[]));
  }
  const patterns: Array<{ regex: string; token: string; sol?: boolean }> = [];
  if (r.patterns !== undefined) {
    if (!Array.isArray(r.patterns)) return { error: "patterns must be a list of { regex, token, sol? }" };
    for (const p of r.patterns) {
      if (typeof p !== "object" || p === null) return { error: "patterns must be a list of { regex, token, sol? }" };
      const q = p as Record<string, unknown>;
      if (typeof q.regex !== "string" || typeof q.token !== "string" || (q.sol !== undefined && typeof q.sol !== "boolean")) return { error: "a pattern needs a regex string and a token name; sol is optional" };
      try {
        new RegExp(q.regex);
      } catch {
        return { error: `pattern is not a valid regular expression: ${q.regex}` };
      }
      patterns.push({ regex: q.regex, token: q.token, ...(q.sol === true ? { sol: true } : {}) });
    }
  }
  return {
    language: {
      id: typeof r.id === "string" && r.id.length > 0 ? r.id : fallbackId,
      name,
      extensions: (r.extensions as string[]).map((e) => e.toLowerCase().replace(/^\./, "")),
      caseInsensitive: r.caseInsensitive === true,
      commentLine: commentLine || null,
      commentStart: commentStart || null,
      commentEnd: commentEnd || null,
      sets,
      ...(commentLines.length > 0 ? { commentLines } : {}),
      ...(patterns.length > 0 ? { patterns } : {}),
    },
  };
}

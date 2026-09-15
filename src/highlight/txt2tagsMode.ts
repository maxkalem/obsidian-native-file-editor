import type { StreamParser, StringStream } from "@codemirror/language";

/**
 * A stream mode for txt2tags (`.t2t`), this plugin's own. Notepad++'s table
 * for it has no keywords (the lexer is hand-written), and the keyword mode
 * showed the odd operator. What the markup has: `%` comments, `= Heading =`
 * and `+ Numbered +` titles, `-`/`+` list items and `:` definitions,
 * `**bold**`, `//italic//`, `__underline__`, `--strike--`, ``monospace`` and
 * ''raw'', `[links]`, `|` table rows and long `-`/`=` separators. Token names
 * are lezer tag names.
 *
 * Hand-written since 2026-09-10: the first version was `simpleMode` from the
 * legacy modes, which coloured nothing in Obsidian (the sample file, every
 * line plain) while npm's CodeMirror coloured it
 * in the tests. `simpleMode` drives the stream through `stream.pos` and a
 * `pending` queue; the hand-written form below uses only `sol`, `match` and
 * `next`, the calls every other own mode makes and Obsidian's fork is known
 * to serve.
 */

interface Rule {
  readonly regex: RegExp;
  readonly token: string | null;
  /** Only at the start of a line. */
  readonly sol?: boolean;
}

const RULES: readonly Rule[] = [
  { regex: /^%.*/, token: "comment", sol: true },
  { regex: /^={1,5}[^=].*[^=]={1,5}\s*(?:\[[\w-]+\])?\s*$/, token: "heading", sol: true },
  { regex: /^\+{1,5}[^+].*[^+]\+{1,5}\s*(?:\[[\w-]+\])?\s*$/, token: "heading", sol: true },
  { regex: /^[-=_]{20,}\s*$/, token: "contentSeparator", sol: true },
  { regex: /^\s*[-+](?=\s)/, token: "keyword", sol: true },
  { regex: /^\s*:(?=\s)/, token: "keyword", sol: true },
  { regex: /^\|\|?/, token: "punctuation" },
  { regex: /^\*\*(?:[^*]|\*(?!\*))+\*\*/, token: "strong" },
  { regex: /^\/\/(?:[^/]|\/(?!\/))+\/\//, token: "emphasis" },
  { regex: /^__(?:[^_]|_(?!_))+__/, token: "link" },
  { regex: /^--(?:[^-]|-(?!-))+--/, token: "strikethrough" },
  { regex: /^``(?:[^`]|`(?!`))+``/, token: "monospace" },
  { regex: /^''(?:[^']|'(?!'))+''/, token: "string" },
  { regex: /^\[(?:[^\]]+)\]/, token: "link" },
  { regex: /^[^\s*/_\-`'[|]+/, token: null },
];

export const txt2tagsMode: StreamParser<unknown> = {
  name: "txt2tags",
  startState: () => ({}),
  token(stream: StringStream): string | null {
    for (const rule of RULES) {
      if (rule.sol && !stream.sol()) continue;
      if (stream.match(rule.regex)) return rule.token;
    }
    stream.next();
    return null;
  },
  languageData: { name: "txt2tags", commentTokens: { line: "%" } },
};

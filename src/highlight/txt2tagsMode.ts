import type { StreamParser } from "@codemirror/language";
import { simpleMode } from "@codemirror/legacy-modes/mode/simple-mode";

/**
 * A stream mode for txt2tags (`.t2t`), this plugin's own, from the rules of
 * `simple-mode`. Notepad++'s table for it has no keywords (the lexer is
 * hand-written), and the keyword mode showed the odd operator. What the
 * markup has: `%` comments, `= Heading =` and `+ Numbered +` titles, `-`/`+`
 * list items and `:` definitions, `**bold**`, `//italic//`, `__underline__`,
 * `--strike--`, ``monospace`` and ''raw'', `[links]`, `|` table rows and
 * long `-`/`=` separators. Token names are lezer tag names.
 */
export const txt2tagsMode: StreamParser<unknown> = simpleMode({
  start: [
    { regex: /%.*/, token: "comment", sol: true },
    { regex: /={1,5}[^=].*[^=]={1,5}\s*(?:\[[\w-]+\])?\s*$/, token: "heading", sol: true },
    { regex: /\+{1,5}[^+].*[^+]\+{1,5}\s*(?:\[[\w-]+\])?\s*$/, token: "heading", sol: true },
    { regex: /[-=_]{20,}\s*$/, token: "contentSeparator", sol: true },
    { regex: /\s*[-+](?=\s)/, token: "keyword", sol: true },
    { regex: /\s*:(?=\s)/, token: "keyword", sol: true },
    { regex: /\|\|?/, token: "punctuation" },
    { regex: /\*\*(?:[^*]|\*(?!\*))+\*\*/, token: "strong" },
    { regex: /\/\/(?:[^/]|\/(?!\/))+\/\//, token: "emphasis" },
    { regex: /__(?:[^_]|_(?!_))+__/, token: "link" },
    { regex: /--(?:[^-]|-(?!-))+--/, token: "strikethrough" },
    { regex: /``(?:[^`]|`(?!`))+``/, token: "monospace" },
    { regex: /''(?:[^']|'(?!'))+''/, token: "string" },
    { regex: /\[(?:[^\]]+)\]/, token: "link" },
    { regex: /[^\s*/_\-`'[|]+/, token: null },
    { regex: /./, token: null },
  ],
  languageData: { name: "txt2tags", commentTokens: { line: "%" } },
});

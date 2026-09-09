/**
 * Text transformations the editor's context menu offers: pure functions over
 * strings, so the menu is a list of names and the behaviour is tested here.
 */

export type CaseKind = "upper" | "lower" | "title" | "sentence" | "invert";

/** A word for case purposes, as Notepad++ cuts them: letters, marks, digits, `_` and apostrophes; anything else separates. */
const WORD = /[\p{L}\p{M}\p{N}_][\p{L}\p{M}\p{N}_'’]*/gu;

/** The first character of every word up, the rest down: "hello WORLD" → "Hello World", "2nd" stays "2nd". */
export function titleCase(text: string): string {
  return text.replace(WORD, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Everything down, then the first letter of the text and of every sentence up.
 * A sentence starts after `.`, `!`, `?` or `…` followed by whitespace, or after
 * a blank line. Quotation marks and brackets before the letter are kept.
 */
export function sentenceCase(text: string): string {
  const lower = text.toLowerCase();
  return lower.replace(/(^|[.!?…]\s+|\n\s*\n)([^\p{L}\n]*)(\p{L})/gu, (_m, before: string, punct: string, letter: string) => `${before}${punct}${letter.toUpperCase()}`);
}

/** Every letter the other case: "Hello" → "hELLO". */
export function invertCase(text: string): string {
  let out = "";
  for (const ch of text) {
    const up = ch.toUpperCase();
    out += ch === up ? ch.toLowerCase() : up;
  }
  return out;
}

export function changeCase(text: string, kind: CaseKind): string {
  switch (kind) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "title":
      return titleCase(text);
    case "sentence":
      return sentenceCase(text);
    case "invert":
      return invertCase(text);
  }
}

const two = (n: number): string => String(n).padStart(2, "0");

/** The local date, `2026-09-09`: the one order that sorts and nobody misreads. */
export function formatDate(d: Date): string {
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** The local date and time to the second, `2026-09-09 17:01:25`. */
export function formatDateTime(d: Date): string {
  return `${formatDate(d)} ${two(d.getHours())}:${two(d.getMinutes())}:${two(d.getSeconds())}`;
}

/** Where a web search for the selection goes. Only the browser is asked; the plugin sends nothing itself. */
export function webSearchUrl(text: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(text.trim())}`;
}

/** What the "Search the web" item quotes: the selection on one line, cut to fit a menu. */
export function menuExcerpt(text: string, max = 30): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

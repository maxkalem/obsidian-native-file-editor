/**
 * The word a position stands in, hyphens and all. "Add to dictionary…" starts
 * from it, and a hyphenated word is exactly what the dictionaries are about,
 * so `кое-что` comes back whole rather than as `что`. A pure function: one
 * line of text and a column, no editor.
 */

const WORD_CHAR = /[\p{L}\p{N}_]/u;
const INNER = /[-‐‑'’]/;

function isWordChar(s: string | undefined): boolean {
  return s !== undefined && WORD_CHAR.test(s);
}

/**
 * The word around `ch`, or the word that ends right before it when the
 * position is just past one. Empty when there is no word there. A hyphen or an
 * apostrophe inside the word is kept (`кое-что`, `don't`); one at either end
 * is not, because a dangling hyphen there is punctuation, not the word's.
 */
export function wordAtPosition(line: string, ch: number): string {
  const at = Math.max(0, Math.min(line.length, ch));
  let start = at;
  let end = at;
  if (!isWordChar(line[end])) {
    // Just past a word (the usual place of a cursor after a double click).
    if (!isWordChar(line[start - 1])) return "";
    start--;
    end = start;
  }
  while (start > 0) {
    const prev = line[start - 1];
    if (isWordChar(prev)) start--;
    else if (prev !== undefined && INNER.test(prev) && isWordChar(line[start - 2])) start -= 2;
    else break;
  }
  while (end < line.length) {
    const next = line[end];
    if (isWordChar(next)) end++;
    else if (next !== undefined && INNER.test(next) && isWordChar(line[end + 1])) end += 2;
    else break;
  }
  return line.slice(start, end);
}

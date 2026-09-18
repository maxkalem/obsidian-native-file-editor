import { plural, t } from "../core/i18n";
import { type UnwrapOptions, protectedLines } from "./unwrap";

/**
 * Wrap: the reverse of Unwrap. Every ordinary line longer than the width is
 * cut into lines of at most that many characters, at spaces; a line that
 * already fits, a blank line and every line Unwrap protects (headings, lists,
 * quotes, tables, fences, front matter) stay as they are. A line's leading
 * indent is repeated on the lines cut from it, so an indented paragraph stays
 * indented. A word longer than the room left is either cut into pieces of the
 * width or, by default, put on a line of its own, overlong.
 *
 * Characters are counted as code points, not UTF-16 units, so a line of
 * Cyrillic or a line with an emoji is measured the way a reader sees it.
 *
 * A pure module: strings in, strings out, no editor, no Obsidian.
 */

export interface WrapOptions {
  /** The longest a line may be, in characters. */
  readonly width: number;
  /** A word longer than the room left is cut at the width; off, it stands on a line of its own. */
  readonly breakWords: boolean;
  /** Treat Markdown structure as lines that are never wrapped. */
  readonly markdown: boolean;
  /** Whether the text starts at the top of its file, so a leading `---` block is front matter. */
  readonly atDocumentStart: boolean;
}

export interface WrapResult {
  readonly text: string;
  /** How many lines were longer than the width and got cut. */
  readonly wrapped: number;
  /** How many line breaks were added. */
  readonly added: number;
}

export const MIN_WRAP_LINE_WIDTH = 10;
export const MAX_WRAP_LINE_WIDTH = 1000;
export const DEFAULT_WRAP_OPTIONS: WrapOptions = { width: 80, breakWords: false, markdown: true, atDocumentStart: true };

const length = (s: string): number => Array.from(s).length;

/** Cut `word` into pieces of at most `size` code points. */
function pieces(word: string, size: number): string[] {
  const chars = Array.from(word);
  const out: string[] = [];
  for (let i = 0; i < chars.length; i += size) out.push(chars.slice(i, i + size).join(""));
  return out;
}

/** Wrap one line of prose at `width`, keeping its indent on every line it becomes. */
export function wrapLine(line: string, width: number, breakWords: boolean): string[] {
  const indent = /^\s*/.exec(line)?.[0] ?? "";
  const room = Math.max(1, width - length(indent));
  const words = line.slice(indent.length).trimEnd().split(/ +/);
  const out: string[] = [];
  let current = "";
  const flush = (): void => {
    if (current.length > 0) out.push(indent + current);
    current = "";
  };
  for (const word of words) {
    if (word === "") continue;
    const fits = current.length === 0 ? length(word) <= room : length(current) + 1 + length(word) <= room;
    if (fits) {
      current = current.length === 0 ? word : `${current} ${word}`;
      continue;
    }
    flush();
    if (length(word) <= room || !breakWords) {
      current = word;
      continue;
    }
    const parts = pieces(word, room);
    const last = parts.pop() ?? "";
    for (const part of parts) out.push(indent + part);
    current = last;
  }
  flush();
  return out.length === 0 ? [line] : out;
}

/**
 * Wrap the long lines of `text`. The result keeps the text's own line ending
 * and every line that fits or is protected.
 */
export function wrapLines(text: string, options: WrapOptions = DEFAULT_WRAP_OPTIONS): WrapResult {
  const width = Math.min(MAX_WRAP_LINE_WIDTH, Math.max(MIN_WRAP_LINE_WIDTH, Math.floor(options.width)));
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r\n|\n/);
  const unwrapOptions: UnwrapOptions = { markdown: options.markdown, joinHyphens: false, atDocumentStart: options.atDocumentStart };
  const protectedLine = protectedLines(lines, unwrapOptions);
  const out: string[] = [];
  let wrapped = 0;
  let added = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (protectedLine[i] || length(line.trimEnd()) <= width) {
      out.push(line);
      continue;
    }
    const cut = wrapLine(line, width, options.breakWords);
    if (cut.length === 1) {
      out.push(line);
      continue;
    }
    wrapped++;
    added += cut.length - 1;
    out.push(...cut);
  }
  return { text: out.join(eol), wrapped, added };
}

/** The notice after the command. */
export function describeWrap(result: WrapResult | null, width: number): string {
  if (result === null || result.wrapped === 0) return t("notice.wrap.none", { width });
  const lines = plural(result.wrapped, "count.line.one", "count.line.other");
  const breaks = plural(result.added, "count.lineBreak.one", "count.lineBreak.other");
  return t("notice.wrap.done", { lines, width, breaks });
}

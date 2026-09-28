import type { TextSegment } from "../highlight/highlighter";
import type { WhitespaceRule } from "./whitespace";

/**
 * Compress for every language the plugin colours: whitespace and comments
 * go, as far as the language allows, and nothing else changes.
 *
 * The input is the document cut into strings, comments and code by the
 * highlighter (`segmentsOf`), and the language's row from the whitespace
 * table says how far to go. A string is copied as it stands. A comment is
 * dropped, but it separates what stood on either side of it, and a line break
 * inside it counts as a line break — ECMAScript's semicolon insertion reads
 * one there too. The code between is whitespace runs and the pieces they
 * separate, and only the runs are touched.
 *
 * A run between two pieces becomes nothing, one space, or a line break:
 *
 * - A space where the two pieces would otherwise become one token — two word
 *   characters (`else if`), two operator characters (`a - -b`, `/ *`, `< <`),
 *   or a number before a dot (`1 .toString()`). A language that separates
 *   every token by whitespace (`runs: "single"`) gets a space always.
 * - A line break where the language's `lineBreaks` rule keeps one: every one
 *   for a line-oriented language, the ones a statement may end at for a
 *   language without separators (kept unless the line ends in `{`, `;`, `,`,
 *   `(` or `[`, or the next begins with a closer — where no terminator can
 *   go), the ones around a preprocessor directive for the C family.
 * - Nothing otherwise. Indentation is a run at the start of a line and goes
 *   with the rest.
 *
 * A `significant` language keeps its layout: only trailing whitespace, blank
 * lines beyond one and comments go, and a row may keep those too (Markdown
 * ends a line with two spaces on purpose).
 */

export interface CompressResult {
  readonly text: string;
  /** Comments removed. */
  readonly comments: number;
}

const WORD = /[\p{L}\p{N}_$]/u;
const OPERATOR = /[+\-*/<>=!&|%^~?:.@#\\]/;
const DIGIT = /[0-9]/;
const SIGN = /^[-+@]/;
const QUOTE = /['"`]/;
const JOIN_AFTER = /[{;,([]$/;
const JOIN_BEFORE = /^[})\]]/;

export function compress(text: string, segments: readonly TextSegment[], rule: WhitespaceRule): CompressResult {
  if (rule.whitespace === "significant") return compressSignificant(text, segments, rule);
  return compressFree(text, segments, rule);
}

/** A piece of code between whitespace runs, or a string; `line` says whether a line break stood before it. */
interface Piece {
  readonly text: string;
  readonly newlines: number;
  /** The whitespace run (comments included) between this piece and the one before, as it stood. */
  readonly gap: string;
}

function compressFree(text: string, segments: readonly TextSegment[], rule: WhitespaceRule): CompressResult {
  const pieces: Piece[] = [];
  let gap = "";
  let newlines = 0;
  let comments = 0;
  const piece = (t: string) => {
    pieces.push({ text: t, newlines, gap });
    gap = "";
    newlines = 0;
  };
  for (const seg of segments) {
    const slice = text.slice(seg.from, seg.to);
    if (seg.kind === "comment") {
      comments++;
      gap += " ";
      newlines += count(slice, "\n");
      continue;
    }
    if (seg.kind === "string") {
      piece(slice);
      continue;
    }
    const re = /\s+|\S+/gu;
    let m: RegExpExecArray | null;
    while ((m = re.exec(slice)) !== null) {
      const run = m[0];
      if (/^\s/.test(run)) {
        gap += run;
        newlines += count(run, "\n");
      } else piece(run);
    }
  }
  const endsWithNewline = /\n\s*$/.test(text);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const out: string[] = [];
  let lineStart = 0;
  for (let i = 0; i < pieces.length; i++) {
    const cur = pieces[i]!;
    if (i === 0) {
      out.push(cur.text);
      continue;
    }
    const prev = pieces[i - 1]!;
    // A preprocessor line: its breaks stay, and so does one space in every
    // run inside it — `#define LIMIT (5)` and `#define LIMIT(5)` are two
    // different macros.
    const onDirective = rule.lineBreaks === "directives" && pieces[lineStart]!.text.startsWith("#");
    const keepBreak = cur.newlines > 0 && breakStays(rule, prev.text, cur.text, onDirective || cur.text.startsWith("#"));
    if (keepBreak) {
      out.push(eol, cur.text);
      lineStart = i;
      continue;
    }
    out.push(separator(rule, prev.text, cur.text, cur.gap.length > 0, onDirective), cur.text);
  }
  return { text: out.join("") + (endsWithNewline && out.length > 0 ? eol : ""), comments };
}

function breakStays(rule: WhitespaceRule, before: string, after: string, directiveLine: boolean): boolean {
  switch (rule.lineBreaks ?? "drop") {
    case "keep":
      return true;
    case "statements":
      return !JOIN_AFTER.test(before) && !JOIN_BEFORE.test(after);
    case "directives":
      return directiveLine;
    default:
      return false;
  }
}

function separator(rule: WhitespaceRule, before: string, after: string, hadGap: boolean, single: boolean): string {
  if (!hadGap) return "";
  if (single || rule.runs === "single") return " ";
  const a = before[before.length - 1] ?? "";
  const b = after[0] ?? "";
  if (WORD.test(a) && WORD.test(b)) return " ";
  if (OPERATOR.test(a) && OPERATOR.test(b)) return " ";
  if (DIGIT.test(a) && b === ".") return " ";
  // `1px -1px` is two dimensions and `1px-1px` one; `puts -1` and `puts-1`
  // differ in more languages than Ruby. A sign after a word keeps its space.
  if (WORD.test(a) && SIGN.test(b)) return " ";
  // A word against a quote: `variable"name"` in HCL and `println"x"` in
  // Groovy are not promised to lex as two tokens; the space costs nothing.
  if ((WORD.test(a) && QUOTE.test(b)) || (QUOTE.test(a) && WORD.test(b))) return " ";
  return "";
}

function compressSignificant(text: string, segments: readonly TextSegment[], rule: WhitespaceRule): CompressResult {
  const keepComments = rule.keeps?.includes("comments") === true;
  const keepTrailing = rule.keeps?.includes("trailing") === true;
  let comments = 0;
  // Comments out first, each replaced by its own line breaks so the lines
  // still pair up with the original's: a line that held only a comment is
  // then empty where the original was not, and goes rather than staying as a
  // blank line.
  const kept: string[] = [];
  for (const seg of segments) {
    const slice = text.slice(seg.from, seg.to);
    if (seg.kind === "comment" && !keepComments) {
      comments++;
      kept.push("\n".repeat(count(slice, "\n")));
      continue;
    }
    kept.push(slice);
  }
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const original = text.split(/\r\n|\n/);
  const lines = kept.join("").split(/\r\n|\n/);
  const out: string[] = [];
  let blank = 0;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    const line = keepTrailing ? raw : raw.replace(/[ \t\f\v]+$/u, "");
    if (line.trim().length === 0) {
      if ((original[i] ?? "").trim().length > 0) continue;
      blank++;
      if (blank === 1 && out.length > 0) out.push("");
      continue;
    }
    blank = 0;
    out.push(line);
  }
  while (out.length > 0 && out[out.length - 1] === "") out.pop();
  const body = out.join(eol);
  return { text: body.length === 0 ? "" : body + (/\r?\n$/.test(text) ? eol : ""), comments };
}

function count(s: string, ch: string): number {
  let n = 0;
  for (let i = s.indexOf(ch); i !== -1; i = s.indexOf(ch, i + 1)) n++;
  return n;
}

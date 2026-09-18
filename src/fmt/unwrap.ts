/**
 * Unwrap: join the lines of hard-wrapped prose back into paragraphs. Text
 * copied out of a PDF, an e-book, a DOC conversion or a mail client arrives
 * with a line break every 60 to 100 characters, so every paragraph is a stack
 * of short lines. This module joins those lines and leaves alone what is a
 * line of its own: a page number, a title, a heading, a list item, a table
 * row, a fenced block, a poem.
 *
 * The rule is about line length against the wrap width, not about
 * punctuation, because a wrapped line ends wherever the width ran out. A line
 * is joined with the next when it is long enough to have been cut by the
 * wrapper; a short line is never joined. The wrap width is measured on the
 * text itself. Before anything is joined the text has to look like wrapped
 * prose at all: most lines near the width, and the next line starting
 * lowercase often enough. A changelog of one item per line, a poem or a song
 * fails that and is left alone.
 *
 * The shapes this was measured against (a vault of converted books and notes,
 * 2026-09-17): PDF text with no blank lines at all, where a paragraph ends only
 * in a short line; DOC conversions where EVERY line is followed by a blank line
 * ("spaced" wrapping, so a single blank line is not a paragraph break there);
 * justified text with doubled spaces inside the lines; lines ending in a
 * hyphen that is the word's own (кое-что, по-прежнему, когда-нибудь) about as
 * often as a word the printer split, so the hyphen decision looks at the parts.
 *
 * A pure module: strings in, strings out, no editor, no Obsidian.
 */

import { plural, t } from "../core/i18n";
import { type HyphenLexicon, activeLexicon } from "./dictionary";

export interface UnwrapOptions {
  /** Treat Markdown structure (headings, lists, quotes, tables, fences, indented code) as lines that never join. Off, only the rules every plain text shares apply. */
  readonly markdown: boolean;
  /**
   * A word the printer split with a hyphen at the line end (`непере-` /
   * `носимой`) is joined back WITHOUT the hyphen. A hyphen that is the word's
   * own stays (`кое-` / `что` → `кое-что`). Which of the two it is, is decided
   * by `hyphenAttachment`: the evidence of the text first, the dictionaries
   * second, a few language-independent rules last. Off, every hyphen stays and
   * the parts are joined without a space.
   */
  readonly joinHyphens: boolean;
  /** Whether the text starts at the top of its file, so a leading `---` block is front matter. */
  readonly atDocumentStart: boolean;
  /** The text is a selection the user made: a handful of lines is then taken as wrapped prose without the gate. */
  readonly selection?: boolean;
  /** The whole document, when `text` is only a selection of it: the hyphen evidence is read from the document, which has far more words to learn from. */
  readonly evidenceText?: string;
  /** The word lists to decide hyphens with. Left out, the dictionaries in force are used. */
  readonly lexicon?: HyphenLexicon;
}

export interface UnwrapResult {
  readonly text: string;
  /** How many line breaks were removed. */
  readonly joined: number;
  /** How many of those dropped a hyphen that split a word (only with `joinHyphens`). */
  readonly dehyphenated: number;
  /** The wrap width the text was measured at, or null when nothing looked hard-wrapped. */
  readonly width: number | null;
  /** Why nothing was joined although lines were there; null when something was, or when there was nothing to measure. */
  readonly refused: "not-prose" | null;
}

export const DEFAULT_UNWRAP_OPTIONS: UnwrapOptions = { markdown: true, joinHyphens: true, atDocumentStart: true };

/** Below this the text is not wrapped prose (a poem, a list, a table of short lines); above it the lines are already paragraphs. */
const MIN_WRAP_WIDTH = 40;
const MAX_WRAP_WIDTH = 160;
/** Only lines at least this long take part in measuring the width. */
const MIN_MEASURED_LENGTH = 40;
/** Lines longer than this multiple of the median were already half-joined by the source and are left out of the measurement. */
const OUTLIER_FACTOR = 1.5;
/** Which percentile of the measured lengths is the wrap width. */
const WIDTH_PERCENTILE = 0.8;
/** A line shorter than this share of the width was not cut by the wrapper: it ends where its author ended it. */
const JOIN_FACTOR = 0.6;
/** When the next line starts with a lowercase letter the continuation is plain; a somewhat shorter line still joins. */
const LOWERCASE_JOIN_FACTOR = 0.5;
/** A line this much longer than the width was not wrapped at its end: its end is a real break unless the next line says otherwise. */
const LONG_LINE_FACTOR = 1.25;
/** With fewer measured lines than this, a line that ends a sentence is taken at its word: the width is too uncertain to say the next word had no room. */
const CONFIDENT_SAMPLES = 3;
/** The prose gate: a selection of fewer candidate pairs than this is the user's own choice of lines and skips it; a whole document never does. */
const GATE_MIN_PAIRS = 5;
/** Wrapped prose has most of its ordinary lines near the width ... */
const MIN_FULL_SHARE = 0.45;
const FULL_LINE_FACTOR = 0.7;
/** ... and the next line starting lowercase often, because a wrapper cuts mid-sentence. */
const MIN_LOWERCASE_SHARE = 0.3;

const FENCE = /^\s{0,3}(```|~~~)/;
const MATH_FENCE = /^\s*\$\$/;
const HEADING = /^\s{0,3}#{1,6}(\s|$)/;
const SETEXT_OR_RULE = /^\s{0,3}(=+|-+)\s*$/;
const HORIZONTAL_RULE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const LIST_ITEM = /^\s*([-*+•]|\d{1,9}\\?[.)]|\p{L}{1,2}\\?[.)])\s+/u;
const BLOCKQUOTE = /^\s{0,3}>/;
const TABLE_ROW = /^\s*\||\|.*\|/;
const HTML_BLOCK = /^\s{0,3}<[a-zA-Z/!]/;
const IMAGE_LINE = /^\s*!\[/;
const REFERENCE_DEFINITION = /^\s{0,3}\[[^\]]+\]:/;
const COMMENT_BLOCK = /^\s*%%/;
const INDENTED = /^( {4}|\t)/;
/** A Markdown hard line break: two spaces or a backslash at the end. The author wanted this break. */
const HARD_BREAK = /( {2,}|\\)$/;
/** A line that starts with an indent, or with a dash as dialogue does, is the first line of a paragraph in most extracted text. */
const PARAGRAPH_START = /^( {2,}|\t|\s*[–—]\s)/;
/** The line ends a sentence: the wrapper may still have cut here, but only a nearly full line says so. */
const SENTENCE_END = /[.!?…:]["'»”’)\]]*\s*$/;
/** A hyphen glued to what precedes it (not a dash after a space). */
const HYPHEN_END = /(\S)([-\u2010\u2011\u00AD])\s*$/;
const HYPHEN_TAIL = /[-\u2010\u2011\u00AD]\s*$/;
const LETTERS_BEFORE_HYPHEN = /(\p{L}+)[-\u2010\u2011\u00AD]\s*$/u;
const LETTERS_AFTER = /^\s*(\p{L}+)/u;
const LOWERCASE_START = /^\s*\p{Ll}/u;
/** A word, with the hyphens that belong to it: what the evidence of the text is counted over. A hyphen at a line end is followed by a break, so it never joins a token. */
const WORD_TOKEN = /[\p{L}\p{N}]+(?:[-‐‑][\p{L}\p{N}]+)*/gu;
/** A part must be this common at the start or the end of the text's other hyphenated words before it decides a hyphen on its own. */
const EVIDENCE_PART_WORDS = 2;
/** Latin vowels, including the Nordic and German ones: a hyphen between two identical vowels is spelling, not a line break (linja-auto, re-elect). */
const LATIN_VOWEL = /^[aeiouyäöåüæøœ]$/;
const LATIN_LETTER = /^\p{Script=Latin}+$/u;
/** The vowels of the other scripts the bundled dictionaries name, used only where a dictionary asks for the same-vowel rule. */
const OTHER_VOWEL = /^[аеёиоуыэюяіїєґ]$/;
const INNER_SPACES = /(\S) {2,}(?=\S)/g;

function isStructural(line: string): boolean {
  if (HEADING.test(line) || SETEXT_OR_RULE.test(line) || HORIZONTAL_RULE.test(line)) return true;
  if (LIST_ITEM.test(line) || BLOCKQUOTE.test(line) || TABLE_ROW.test(line)) return true;
  if (HTML_BLOCK.test(line) || IMAGE_LINE.test(line) || REFERENCE_DEFINITION.test(line) || COMMENT_BLOCK.test(line)) return true;
  return false;
}

/**
 * Which lines take no part in joining: blank lines, Markdown structure, and
 * everything inside a fenced block or front matter. Fences and front matter
 * are tracked as state because their inner lines look like anything. An
 * indented line is code only where a code block would be: after a blank or
 * protected line, and followed by another indented line or a blank; a lone
 * indented line before flush text is a paragraph's first line.
 */
export function protectedLines(lines: readonly string[], options: UnwrapOptions): boolean[] {
  const out = new Array<boolean>(lines.length).fill(false);
  let fence: string | null = null;
  let math = false;
  let frontMatter = options.atDocumentStart && lines[0]?.trim() === "---";
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (frontMatter) {
      out[i] = true;
      if (i > 0 && (line.trim() === "---" || line.trim() === "...")) frontMatter = false;
      continue;
    }
    if (fence !== null) {
      out[i] = true;
      if (line.trimStart().startsWith(fence)) fence = null;
      continue;
    }
    if (math) {
      out[i] = true;
      if (MATH_FENCE.test(line)) math = false;
      continue;
    }
    const opening = FENCE.exec(line);
    if (opening?.[1] !== undefined) {
      out[i] = true;
      fence = opening[1];
      continue;
    }
    if (MATH_FENCE.test(line)) {
      out[i] = true;
      math = !/\$\$.*\$\$/.test(line);
      continue;
    }
    if (line.trim() === "" || isStructural(line)) {
      out[i] = true;
      continue;
    }
    if (options.markdown && INDENTED.test(line)) {
      const before = i === 0 || out[i - 1] === true;
      const next = lines[i + 1];
      const after = next === undefined || next.trim() === "" || INDENTED.test(next);
      out[i] = before && after;
    }
  }
  return out;
}

export interface WrapWidth {
  readonly width: number;
  /** How many lines the width was measured on; below `CONFIDENT_SAMPLES` the estimate is the longest line itself. */
  readonly samples: number;
}

/**
 * The wrap width: the 80th percentile (nearest rank) of the ordinary lines
 * long enough to have been wrapped, after dropping the lines the source had
 * already half-joined (longer than 1.5 × the median); or null.
 */
export function measureWrapWidth(lines: readonly string[], protectedLine: readonly boolean[]): WrapWidth | null {
  const lengths: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (protectedLine[i]) continue;
    const length = (lines[i] ?? "").trimEnd().length;
    if (length >= MIN_MEASURED_LENGTH) lengths.push(length);
  }
  if (lengths.length === 0) return null;
  lengths.sort((a, b) => a - b);
  const median = lengths[Math.floor(lengths.length / 2)] ?? 0;
  const kept = lengths.filter((n) => n <= median * OUTLIER_FACTOR);
  const rank = Math.max(1, Math.ceil(kept.length * WIDTH_PERCENTILE));
  const width = kept[rank - 1] ?? null;
  if (width === null || width < MIN_WRAP_WIDTH || width > MAX_WRAP_WIDTH) return null;
  return { width, samples: kept.length };
}

function firstWordLength(line: string): number {
  const m = /^\s*(\S+)/.exec(line);
  return m?.[1]?.length ?? 0;
}

/**
 * Whether the break between `line` and `next` was made by a wrapper. Both
 * lines are already known to be ordinary (not blank, not structure).
 */
function shouldJoin(line: string, next: string, measured: WrapWidth): boolean {
  if (HARD_BREAK.test(line) || PARAGRAPH_START.test(next)) return false;
  const { width } = measured;
  const length = line.trimEnd().length;
  if (LOWERCASE_START.test(next)) return length >= width * LOWERCASE_JOIN_FACTOR;
  if (length < width * JOIN_FACTOR || length > width * LONG_LINE_FACTOR) return false;
  // A sentence ends here and the next line starts a new one: only a line
  // that had no room for the next word was cut by the wrapper, and only a
  // width measured on several lines can tell.
  if (SENTENCE_END.test(line)) return measured.samples >= CONFIDENT_SAMPLES && length + 1 + firstWordLength(next) > width;
  return true;
}

/**
 * For every ordinary line, the index of the ordinary line a join would reach:
 * the next line, or the one after a single blank line when the text is
 * "spaced" (more ordinary lines separated by exactly one blank line than
 * adjacent ones, the shape a DOC conversion gives). -1 when there is none.
 */
function partners(lines: readonly string[], protectedLine: readonly boolean[]): { next: Int32Array; spaced: boolean } {
  const n = lines.length;
  const isBlank = (i: number): boolean => (lines[i] ?? "").trim() === "";
  let adjacent = 0;
  let spaced = 0;
  for (let i = 0; i + 1 < n; i++) {
    if (protectedLine[i]) continue;
    if (!protectedLine[i + 1]) adjacent++;
    else if (isBlank(i + 1) && i + 2 < n && !protectedLine[i + 2]) spaced++;
  }
  const isSpaced = spaced > adjacent;
  const next = new Int32Array(n).fill(-1);
  for (let i = 0; i + 1 < n; i++) {
    if (protectedLine[i]) continue;
    if (!protectedLine[i + 1]) next[i] = i + 1;
    else if (isSpaced && isBlank(i + 1) && i + 2 < n && !protectedLine[i + 2]) next[i] = i + 2;
  }
  return { next, spaced: isSpaced };
}

/**
 * Does the text look like wrapped prose? Most ordinary lines near the width,
 * and the next line starting lowercase often enough. Skipped for a handful of
 * pairs: a small selection was the user's own choice of lines.
 */
function looksLikeProse(lines: readonly string[], protectedLine: readonly boolean[], next: Int32Array, width: number, selection: boolean): boolean {
  let ordinary = 0;
  let full = 0;
  let pairs = 0;
  let lowercase = 0;
  for (let i = 0; i < lines.length; i++) {
    if (protectedLine[i]) continue;
    ordinary++;
    if ((lines[i] ?? "").trimEnd().length >= width * FULL_LINE_FACTOR) full++;
    const j = next[i] ?? -1;
    if (j < 0) continue;
    pairs++;
    if (LOWERCASE_START.test(lines[j] ?? "")) lowercase++;
  }
  if (pairs === 0) return true;
  if (selection && pairs < GATE_MIN_PAIRS) return true;
  return full / ordinary >= MIN_FULL_SHARE && lowercase / pairs >= MIN_LOWERCASE_SHARE;
}

/**
 * What the text itself knows about its hyphens: how often each hyphenated word
 * and each plain word occurs, and how many different hyphenated words a part
 * begins or ends. A document that writes `\u043A\u043E\u0435-\u0447\u0442\u043E` and `\u043A\u0442\u043E-\u0442\u043E` in full
 * elsewhere says what its `\u043A\u043E\u0435-` at a line end is; one that writes
 * `\u043D\u0435\u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u043C\u043E\u0439` in full says the same about `\u043D\u0435\u043F\u0435\u0440\u0435-`. This is the first and
 * the strongest source of the decision, because it is the text's own usage and
 * needs no language and no list.
 */
export interface TextEvidence {
  /** Hyphenated words, `\u043A\u043E\u0435-\u0447\u0442\u043E` -> how often. */
  readonly hyphenated: ReadonlyMap<string, number>;
  /** Words without a hyphen, `\u043D\u0435\u043F\u0435\u0440\u0435\u043D\u043E\u0441\u0438\u043C\u043E\u0439` -> how often. */
  readonly plain: ReadonlyMap<string, number>;
  /** A first part -> how many DIFFERENT hyphenated words begin with it. */
  readonly beginnings: ReadonlyMap<string, number>;
  /** A last part -> how many different hyphenated words end with it. */
  readonly endings: ReadonlyMap<string, number>;
}

const EMPTY_EVIDENCE: TextEvidence = { hyphenated: new Map(), plain: new Map(), beginnings: new Map(), endings: new Map() };

function countUp(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function addTo(map: Map<string, Set<string>>, key: string, word: string): void {
  const set = map.get(key);
  if (set === undefined) map.set(key, new Set([word]));
  else set.add(word);
}

/** Read the words of a text once. The caller does this per command, not per hyphen. */
export function buildTextEvidence(text: string): TextEvidence {
  const hyphenated = new Map<string, number>();
  const plain = new Map<string, number>();
  const beginnings = new Map<string, Set<string>>();
  const endings = new Map<string, Set<string>>();
  WORD_TOKEN.lastIndex = 0;
  for (let match = WORD_TOKEN.exec(text); match !== null; match = WORD_TOKEN.exec(text)) {
    const word = match[0].toLowerCase().replace(/[\u2010\u2011]/g, "-");
    if (!word.includes("-")) {
      countUp(plain, word);
      continue;
    }
    countUp(hyphenated, word);
    const parts = word.split("-");
    const first = parts[0] ?? "";
    const last = parts[parts.length - 1] ?? "";
    addTo(beginnings, first, word);
    addTo(endings, last, word);
  }
  const distinct = (source: Map<string, Set<string>>): Map<string, number> => new Map([...source].map(([key, words]) => [key, words.size]));
  return { hyphenated, plain, beginnings: distinct(beginnings), endings: distinct(endings) };
}

/** What the hyphen decision reads besides the two lines. */
export interface HyphenContext {
  readonly joinHyphens: boolean;
  readonly evidence: TextEvidence;
  readonly lexicon: HyphenLexicon | null;
}

/**
 * The last character of the part before the hyphen and the first of the part
 * after are the same vowel: spelling, not a line break (re-elect, linja-auto,
 * maa-alue). Only in the Latin script, where the doubled vowel is what the
 * hyphen is there for; a dictionary with `keepSameVowel` extends it to its own.
 */
function sameVowel(prefix: string, suffix: string, everywhere: boolean): boolean {
  const before = prefix.slice(-1);
  const after = suffix.slice(0, 1);
  if (before === "" || before !== after) return false;
  if (LATIN_LETTER.test(before)) return LATIN_VOWEL.test(before);
  return everywhere && OTHER_VOWEL.test(before);
}

/**
 * How a line that ends in a hyphen attaches to the next: with the hyphen
 * dropped (the printer split the word), with the hyphen kept and no space
 * (the word's own hyphen, or a digit before it), or with a space (a dash, or
 * the next line does not continue the word).
 *
 * The order is the whole design. The evidence of the text decides first,
 * because it is this document's own usage; the dictionaries decide what the
 * text does not show; and only then do the rules that hold in every language
 * apply \u2014 the parts repeat, one letter before the hyphen, an abbreviation, the
 * same vowel on both sides. Whatever none of them claims was the printer's
 * hyphen and goes.
 */
export function hyphenAttachment(line: string, next: string, context: HyphenContext): "space" | "hyphen" | "dehyphenate" {
  const end = HYPHEN_END.exec(line);
  if (!end || !LOWERCASE_START.test(next)) return "space";
  const before = end[1] ?? "";
  const hyphen = end[2] ?? "-";
  if (/\p{N}/u.test(before)) return "hyphen";
  if (!/\p{L}/u.test(before)) return "space";
  if (!context.joinHyphens) return "hyphen";
  if (hyphen === "\u00AD") return "dehyphenate";
  if (hyphen === "\u2011") return "hyphen";
  const prefix = LETTERS_BEFORE_HYPHEN.exec(line)?.[1] ?? "";
  const suffix = LETTERS_AFTER.exec(next)?.[1] ?? "";
  if (prefix === "" || suffix === "") return "hyphen";
  const a = prefix.toLowerCase();
  const b = suffix.toLowerCase();

  // 1. The evidence of the text.
  const intact = context.evidence.hyphenated.get(`${a}-${b}`) ?? 0;
  const joined = context.evidence.plain.get(`${a}${b}`) ?? 0;
  if (intact > 0 || joined > 0) return intact >= joined ? "hyphen" : "dehyphenate";
  if ((context.evidence.beginnings.get(a) ?? 0) >= EVIDENCE_PART_WORDS) return "hyphen";
  if ((context.evidence.endings.get(b) ?? 0) >= EVIDENCE_PART_WORDS) return "hyphen";

  // 2. The dictionaries.
  const lexicon = context.lexicon;
  if (lexicon !== null) {
    if (lexicon.hyphenated.has(`${a}-${b}`)) return "hyphen";
    if (lexicon.plain.has(`${a}${b}`)) return "dehyphenate";
    if (lexicon.prefixes.has(a)) return "hyphen";
    if (lexicon.suffixes.has(b)) return "hyphen";
  }

  // 3. What holds in every language.
  if (a === b) return "hyphen";
  if ([...prefix].length === 1) return "hyphen";
  if (prefix === prefix.toUpperCase() && prefix !== prefix.toLowerCase()) return "hyphen";
  if (sameVowel(a, b, lexicon?.sameVowelEverywhere === true)) return "hyphen";

  // 4. The printer's hyphen.
  return "dehyphenate";
}

/** The notice after the command: what was joined, or why nothing was. */
export function describeUnwrap(result: UnwrapResult | null): string {
  if (result === null || result.width === null) return t("notice.unwrap.none");
  if (result.refused === "not-prose") return t("notice.unwrap.notProse", { width: result.width });
  if (result.joined === 0) return t("notice.unwrap.nothing", { width: result.width });
  const breaks = plural(result.joined, "count.lineBreak.one", "count.lineBreak.other");
  const words = result.dehyphenated === 0 ? "" : plural(result.dehyphenated, "notice.unwrap.rejoined.one", "notice.unwrap.rejoined.other");
  return t("notice.unwrap.done", { breaks, width: result.width, words });
}

/** A line that takes part in a join: trailing space gone, doubled inner spaces (justified text) made single. */
function tidy(line: string): string {
  return line.trimEnd().replace(INNER_SPACES, "$1 ");
}

/** The line that comes in at a join: its leading space goes, its trailing space stays (a hard break's two spaces are kept where the break is kept). */
function incoming(line: string): string {
  return line.replace(INNER_SPACES, "$1 ").trimStart();
}

/**
 * Join the wrapped lines of `text`. The result keeps the text's own line
 * ending, every protected line, every short line, and every blank line except
 * the single blank lines a spaced text puts between wrapped lines.
 */
export function unwrapLines(text: string, options: UnwrapOptions = DEFAULT_UNWRAP_OPTIONS): UnwrapResult {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.split(/\r\n|\n/);
  const protectedLine = protectedLines(lines, options);
  const measured = measureWrapWidth(lines, protectedLine);
  if (measured === null) return { text, joined: 0, dehyphenated: 0, width: null, refused: null };
  const width = measured.width;
  const { next } = partners(lines, protectedLine);
  if (!looksLikeProse(lines, protectedLine, next, width, options.selection === true)) return { text, joined: 0, dehyphenated: 0, width, refused: "not-prose" };

  // The words of the document are read once, not once per hyphen, and from the
  // whole document even when only a selection is being joined.
  const hyphens: HyphenContext = {
    joinHyphens: options.joinHyphens,
    evidence: options.joinHyphens ? buildTextEvidence(options.evidenceText ?? text) : EMPTY_EVIDENCE,
    lexicon: options.joinHyphens ? (options.lexicon ?? activeLexicon()) : null,
  };

  const out: string[] = [];
  let joined = 0;
  let dehyphenated = 0;
  // The paragraph being built, and how the coming line attaches to it.
  // Decisions are taken on the original lines, never on the growing
  // paragraph, so a long joined line does not stop the next join.
  let current: string | null = null;
  let attach: "space" | "hyphen" | "dehyphenate" = "space";
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    let piece: string;
    if (current === null) piece = line;
    else if (attach === "dehyphenate") piece = tidy(current).replace(HYPHEN_TAIL, "") + incoming(line);
    else if (attach === "hyphen") piece = tidy(current) + incoming(line);
    else piece = tidy(current) + " " + incoming(line);
    const j = next[i] ?? -1;
    if (j >= 0 && shouldJoin(line, lines[j] ?? "", measured)) {
      attach = hyphenAttachment(line, lines[j] ?? "", hyphens);
      if (attach === "dehyphenate") dehyphenated++;
      joined++;
      // A paragraph whose first line was indented (extracted text often is)
      // would render as a code block once joined; in Markdown the indent goes.
      current = current === null ? (options.markdown && INDENTED.test(line) ? tidy(line).trimStart() : tidy(line)) : piece;
      i = j;
      continue;
    }
    out.push(current === null ? line : piece);
    current = null;
    i++;
  }
  return { text: out.join(eol), joined, dehyphenated, width, refused: null };
}

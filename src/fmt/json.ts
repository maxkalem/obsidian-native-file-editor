/**
 * The plugin's own JSON formatter and compressor — the reference the user
 * named for this feature (Notepad++'s JSONViewer), with one deliberate
 * difference: **comments are kept** (USER 2026-09-19). `tsconfig.json`, the
 * `.vscode` files and half the configuration files in a vault are JSONC, and
 * a formatter that silently drops a comment destroys content.
 *
 * It does not build a value tree. A tolerant scanner turns the text into
 * tokens and the printer walks them with a depth counter, so the output keeps
 * what a parse would have thrown away: the order of the keys, the spelling of
 * every number (`1.50`, `1e3`, `-0`), the exact escapes inside strings. It
 * also means a file with a small mistake in it still formats: the scanner
 * reports the first place it could not read and the caller decides.
 *
 * Pure: strings in, strings out.
 */

export interface JsonStyle {
  /** One level of indentation: the editor's own unit, or the one read from the file. */
  readonly indent: string;
  /** The line ending of the file being formatted. */
  readonly eol: string;
}

export const DEFAULT_JSON_STYLE: JsonStyle = { indent: "  ", eol: "\n" };

export type TokenKind = "open" | "close" | "colon" | "comma" | "string" | "number" | "literal" | "line-comment" | "block-comment";

export interface Token {
  readonly kind: TokenKind;
  readonly text: string;
  /** Whether a line ending stood between this token and the one before it, which is what keeps a trailing comment trailing. */
  readonly newlineBefore: boolean;
}

export interface ScanResult {
  readonly tokens: readonly Token[];
  /** The offset where the scanner gave up, or null when it read to the end. */
  readonly problem: { readonly at: number; readonly reason: string } | null;
}

const LITERAL = /^(?:true|false|null|undefined|NaN|Infinity|-Infinity)/;
const NUMBER = /^[-+]?(?:0[xXbBoO][0-9a-fA-F_]+|(?:\d[\d_]*)?\.?[\d_]+(?:[eE][-+]?\d+)?|\d[\d_]*\.?)/;

/** The text as tokens. Whitespace is dropped, but whether it held a line break is remembered. */
export function scanJson(text: string): ScanResult {
  const tokens: Token[] = [];
  let i = 0;
  let newline = false;
  const push = (kind: TokenKind, value: string): void => {
    tokens.push({ kind, text: value, newlineBefore: newline });
    newline = false;
    i += value.length;
  };
  while (i < text.length) {
    const ch = text[i] as string;
    if (ch === "\n") {
      newline = true;
      i++;
      continue;
    }
    if (ch === " " || ch === "\t" || ch === "\r") {
      i++;
      continue;
    }
    if (ch === "{" || ch === "[") {
      push("open", ch);
      continue;
    }
    if (ch === "}" || ch === "]") {
      push("close", ch);
      continue;
    }
    if (ch === ":") {
      push("colon", ch);
      continue;
    }
    if (ch === ",") {
      push("comma", ch);
      continue;
    }
    if (ch === '"' || ch === "'") {
      const end = endOfString(text, i, ch);
      if (end === null) return { tokens, problem: { at: i, reason: "unterminated string" } };
      push("string", text.slice(i, end));
      continue;
    }
    if (ch === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      push("line-comment", text.slice(i, nl < 0 ? text.length : nl));
      continue;
    }
    if (ch === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end < 0) return { tokens, problem: { at: i, reason: "unterminated comment" } };
      push("block-comment", text.slice(i, end + 2));
      continue;
    }
    const rest = text.slice(i);
    const literal = LITERAL.exec(rest);
    if (literal) {
      push("literal", literal[0]);
      continue;
    }
    const number = NUMBER.exec(rest);
    if (number && number[0].length > 0) {
      push("number", number[0]);
      continue;
    }
    // An unquoted key (`{ a: 1 }`) is common enough in hand-written JSON to be
    // read rather than refused; anything else is where the file stops making
    // sense, and the caller says so instead of writing a guess back.
    const word = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (word) {
      push("literal", word[0]);
      continue;
    }
    return { tokens, problem: { at: i, reason: `unexpected ${JSON.stringify(ch)}` } };
  }
  return { tokens, problem: null };
}

function endOfString(text: string, start: number, quote: string): number | null {
  for (let i = start + 1; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === quote) return i + 1;
    if (ch === "\n") return null;
  }
  return null;
}

export interface JsonResult {
  readonly text: string;
  /** Why the text was left alone; null when it was formatted. */
  readonly problem: string | null;
}

/**
 * One value per line, the braces where a reader expects them, and the
 * comments where their author put them: a comment that stood at the end of a
 * line stays at the end of that line, one that stood alone keeps its own line.
 * An empty object or array stays on one line, because `{}` on three lines is
 * noise.
 */
export function formatJson(text: string, style: JsonStyle = DEFAULT_JSON_STYLE): JsonResult {
  const { tokens, problem } = scanJson(text);
  if (problem) return { text, problem: `${problem.reason} at ${problem.at}` };
  if (tokens.length === 0) return { text, problem: null };
  const out: string[] = [];
  let depth = 0;
  let atLineStart = true;
  const write = (value: string): void => {
    out.push(value);
    atLineStart = false;
  };
  const newLine = (): void => {
    if (out.length > 0) out.push(style.eol);
    out.push(style.indent.repeat(depth));
    atLineStart = true;
  };
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i] as Token;
    const previous = i > 0 ? (tokens[i - 1] as Token) : null;
    const next = tokens[i + 1] ?? null;
    if (token.kind === "close") {
      depth = Math.max(0, depth - 1);
      // `{}` and `[]` keep their line; anything else closes on its own.
      if (previous && previous.kind !== "open") newLine();
      write(token.text);
      continue;
    }
    if (token.kind === "comma") {
      write(token.text);
      continue;
    }
    if (token.kind === "colon") {
      write(`${token.text} `);
      continue;
    }
    const trailing = (token.kind === "line-comment" || token.kind === "block-comment") && !token.newlineBefore && previous !== null;
    // A value follows its key on the same line; a comment that was trailing
    // stays trailing; everything else starts a line of its own, unless the
    // opening brace already began one.
    if (previous !== null && previous.kind === "colon") {
      // continue on this line
    } else if (trailing) write(" ");
    else if (previous !== null && !atLineStart) newLine();
    write(token.text);
    if (token.kind === "open") {
      depth++;
      if (next && next.kind === "close") continue;
      newLine();
    }
  }
  return { text: out.join(""), problem: null };
}

/**
 * Everything a machine does not need: no whitespace between tokens, no line
 * breaks. Comments stay, because the user's rule is that they are content —
 * but a `//` comment on one line would swallow everything after it, so it is
 * written as a block comment instead. A comment whose own text carries `*​/`
 * cannot be turned into one, and then the line break after it is kept.
 */
export function compressJson(text: string, style: JsonStyle = DEFAULT_JSON_STYLE): JsonResult {
  const { tokens, problem } = scanJson(text);
  if (problem) return { text, problem: `${problem.reason} at ${problem.at}` };
  const out: string[] = [];
  for (const token of tokens) {
    if (token.kind === "line-comment") {
      const body = token.text.slice(2).trim();
      if (body.includes("*/")) {
        out.push(token.text, style.eol);
        continue;
      }
      out.push(`/*${body.length > 0 ? ` ${body} ` : ""}*/`);
      continue;
    }
    out.push(token.text);
  }
  return { text: out.join(""), problem: null };
}

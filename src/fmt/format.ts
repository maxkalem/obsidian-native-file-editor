import { t } from "../core/i18n";
import type { Tree } from "@lezer/common";
import { DEFAULT_JSON_STYLE, type JsonStyle, compressJson, formatJson } from "./json";
import { compressCss, formatCss } from "./css";
import { type MarkupKind, compressMarkup, formatMarkup } from "./markup";
import { type WhitespaceRule, whitespaceRuleFor } from "./whitespace";

/**
 * What Format and Compress do for a file, and why they sometimes do nothing.
 *
 * The order is fixed (format spec §3): the plugin's own formatter for the
 * formats it knows properly, then a formatter the user installed, then a file
 * the repository ships that WOULD serve this language, then CodeMirror's
 * indentation for every language whose mode provides it, then nothing.
 *
 * "Nothing" is not an entry. A row that can only say no is noise, so a
 * language nothing can format has no Format row at all, and a language a file
 * would serve keeps its row and explains itself when it is pressed.
 *
 * Whether CodeMirror can indent a language is asked of the language itself at
 * the moment the menu opens (`getIndentation` answers null when no mode or
 * grammar provides one), not looked up in a table: a vault definition, a new
 * grammar or a future Obsidian all change that answer, and a generated list
 * would be stale the day it was written.
 */

export type FormatterKind =
  | "own"
  /** Compress only: the generic compressor over the highlighter's strings and comments, as far as the whitespace table allows. */
  | "tree"
  /** A formatter the user installed into the plugin's folder serves this file. */
  | "vault"
  /** CodeMirror's indentation, which is all the language's mode provides. */
  | "indent"
  /** Nothing is installed, but a file the repository ships would format this: the entry stays and explains how. */
  | "installable"
  /** Nothing can: the entry is not shown at all. */
  | "none";

export interface FormatPlan {
  readonly kind: FormatterKind;
}

/**
 * The formats the plugin formats itself, by the registry's language name.
 * JSON, XML and HTML come before a formatter the user installed (JSON keeps
 * its comments, markup keeps its text); CSS comes after one, because
 * prettier's CSS wraps and reorders nothing but does more with long values,
 * and the own one is the fallback for a sheet with nothing installed.
 */
const OWN_FIRST = new Set(["JSON", "JSON with comments", "JSON5", "JSON Lines", "XML", "HTML"]);
const OWN_AFTER_VAULT = new Set(["CSS"]);
const OWN_FORMAT = new Set([...OWN_FIRST, ...OWN_AFTER_VAULT]);

/** The own formatters that work on the editor's syntax tree rather than on the text alone. */
const MARKUP: ReadonlyMap<string, MarkupKind> = new Map([
  ["XML", "xml"],
  ["HTML", "html"],
]);

/** Whether the own formatter for this language needs the editor's syntax tree. */
export function ownFormatterNeedsTree(language: string | null): boolean {
  return language !== null && (MARKUP.has(language) || language === "CSS");
}

const NO_TREE = "the file could not be parsed in time";

/**
 * `vaultServes` is true when the user has installed the formatter files for
 * this file's extension (ADR-005). The plugin's own formatter still comes
 * first where it has one, because it keeps the comments and the spelling of
 * the numbers, which a reprinting formatter does not promise.
 */
export function planFormat(language: string | null, canIndent: boolean, vaultServes = false, installable = false): FormatPlan {
  if (language !== null && OWN_FIRST.has(language)) return { kind: "own" };
  if (vaultServes) return { kind: "vault" };
  if (language !== null && OWN_AFTER_VAULT.has(language)) return { kind: "own" };
  // A file the repository ships would format this language: worth an entry
  // that explains itself, rather than indentation that does half the job.
  if (installable) return { kind: "installable" };
  if (canIndent) return { kind: "indent" };
  return { kind: "none" };
}

/**
 * Compress: the plugin's own compressor for JSON (it keeps the comments,
 * which the generic one drops), otherwise the generic one over the token
 * stream for every language whose whitespace row allows anything — and no
 * row at all where the table says the layout is the content, or where the
 * text between tags is content the tokens do not mark (`markup`, waiting for
 * the tree-aware formatter).
 */
export function planCompress(language: string | null): CompressPlan {
  // The own formatters first: JSON keeps its comments, and XML and HTML are
  // read by their tree, where the generic one could not tell text from layout.
  if (language !== null && OWN_FORMAT.has(language)) return { kind: "own" };
  const rule = whitespaceRuleFor(language);
  if (rule.whitespace === "none" || rule.markup === true) return { kind: "none" };
  return { kind: "tree", rule };
}

export type CompressPlan = { readonly kind: "own" | "none" } | { readonly kind: "tree"; readonly rule: WhitespaceRule };

/**
 * Run the plugin's own formatter for a language it knows. Null when it has
 * none. The markup formatters read the tree the editor holds; `tree` is null
 * when the parse did not finish, and then the file is left alone.
 */
export function formatOwn(language: string | null, text: string, style: JsonStyle, tree: Tree | null = null): { text: string; problem: string | null } | null {
  if (language === null || !OWN_FORMAT.has(language)) return null;
  const kind = MARKUP.get(language);
  if (kind !== undefined) return tree ? formatMarkup(text, tree, kind, style) : { text, problem: NO_TREE };
  if (language === "CSS") return tree ? formatCss(text, tree, style) : { text, problem: NO_TREE };
  return formatJson(text, style);
}

export function compressOwn(language: string | null, text: string, style: JsonStyle, tree: Tree | null = null): { text: string; problem: string | null } | null {
  if (language === null || !OWN_FORMAT.has(language)) return null;
  const kind = MARKUP.get(language);
  if (kind !== undefined) return tree ? compressMarkup(text, tree, kind) : { text, problem: NO_TREE };
  if (language === "CSS") return tree ? compressCss(text, tree) : { text, problem: NO_TREE };
  return compressJson(text, style);
}

/**
 * The indent unit to format with: the file's own, and the editor's setting
 * only when the file cannot say (USER 2026-09-19). Visual Studio Code does
 * the same — `editor.detectIndentation` is on by default and overrides
 * `tabSize` and `insertSpaces` from the file's contents — while Notepad++
 * always applies its configured value, which rewrites every line of a file
 * written with another convention.
 */
export function detectIndentUnit(text: string, fallback: string): string {
  const lines = text.split(/\r\n|\n/);
  let tabs = 0;
  const widths: number[] = [];
  for (const line of lines) {
    if (/^\t+\S/.test(line)) {
      tabs++;
      continue;
    }
    const spaces = /^( +)\S/.exec(line)?.[1]?.length ?? 0;
    if (spaces > 0) widths.push(spaces);
  }
  if (tabs > widths.length && tabs > 0) return "\t";
  if (widths.length === 0) return fallback;
  // The step between levels, not the deepest line: the smallest indent is one
  // level in every convention that exists.
  const smallest = Math.min(...widths);
  return smallest >= 1 && smallest <= 8 ? " ".repeat(smallest) : fallback;
}

/**
 * How long a job has to take before its notice says how long it took. Under
 * this the number is noise — the user pressed a key and it was done — and over
 * it the number is the answer to the question the wait already asked. The one
 * path that reaches it in practice is a formatter read out of the vault, whose
 * first call of a session is disk work.
 */
export const SLOW_NOTICE_MS = 150;

/**
 * A notice with the time appended, but only when the work was slow enough for
 * the time to mean anything. Pure, so the threshold is tested without a clock.
 */
export function withDuration(message: string, ms: number): string {
  return ms >= SLOW_NOTICE_MS ? t("notice.took", { message, ms: String(Math.round(ms)) }) : message;
}

/** The style for the own formatters: the file's indent and its line ending. */
export function styleFor(text: string, fallbackIndent: string): JsonStyle {
  return { indent: detectIndentUnit(text, fallbackIndent), eol: text.includes("\r\n") ? "\r\n" : DEFAULT_JSON_STYLE.eol };
}

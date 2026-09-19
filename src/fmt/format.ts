import { DEFAULT_JSON_STYLE, type JsonStyle, compressJson, formatJson } from "./json";

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

/** The formats the plugin formats itself, by the registry's language name. */
const OWN_FORMAT = new Set(["JSON", "JSON with comments", "JSON5", "JSON Lines"]);

/**
 * `vaultServes` is true when the user has installed the formatter files for
 * this file's extension (ADR-005). The plugin's own formatter still comes
 * first where it has one, because it keeps the comments and the spelling of
 * the numbers, which a reprinting formatter does not promise.
 */
export function planFormat(language: string | null, canIndent: boolean, vaultServes = false, installable = false): FormatPlan {
  if (language !== null && OWN_FORMAT.has(language)) return { kind: "own" };
  if (vaultServes) return { kind: "vault" };
  // A file the repository ships would format this language: worth an entry
  // that explains itself, rather than indentation that does half the job.
  if (installable) return { kind: "installable" };
  if (canIndent) return { kind: "indent" };
  return { kind: "none" };
}

export function planCompress(language: string | null): FormatPlan {
  return { kind: language !== null && OWN_FORMAT.has(language) ? "own" : "none" };
}

/** Run the plugin's own formatter for a language it knows. Null when it has none. */
export function formatOwn(language: string | null, text: string, style: JsonStyle): { text: string; problem: string | null } | null {
  if (language === null || !OWN_FORMAT.has(language)) return null;
  return formatJson(text, style);
}

export function compressOwn(language: string | null, text: string, style: JsonStyle): { text: string; problem: string | null } | null {
  if (language === null || !OWN_FORMAT.has(language)) return null;
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

/** The style for the own formatters: the file's indent and its line ending. */
export function styleFor(text: string, fallbackIndent: string): JsonStyle {
  return { indent: detectIndentUnit(text, fallbackIndent), eol: text.includes("\r\n") ? "\r\n" : DEFAULT_JSON_STYLE.eol };
}

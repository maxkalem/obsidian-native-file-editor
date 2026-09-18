import type { Logger } from "./log";
import type { Transport } from "../platform/transport";
import { EN_CATALOGUE, type LoadedLocale, setLocale } from "./i18n";
import { isRightToLeft } from "../i18n/locales";

/**
 * One file, one language. `localization.json` in the plugin's own folder
 * replaces the plugin's English; there is no folder of languages, no list and
 * nothing to choose, because a person wants their own language, not a menu of
 * them. The file is absent for most people and then everything is English.
 *
 * What a file does not translate stays English, key by key, so a file can be
 * translated a line at a time and used from the first line. The repository
 * carries two examples to start from: `locales/english.json` (the whole
 * catalogue as it is) and `locales/uk.json`.
 */

/** The file name, fixed: the plugin never looks anywhere else. */
export const LOCALIZATION_FILE = "localization.json";

export interface Localization {
  /** What the file calls the language: its `name`, its `locale` code, or the file name. */
  readonly name: string;
  readonly rtl: boolean;
  readonly strings: Readonly<Record<string, string>>;
  /** How many of the plugin's strings it translates, for the settings row. */
  readonly translated: number;
}

export interface LocalizationReport {
  readonly path: string;
  /** The file in force, or null when there is none (or it was not valid). */
  readonly localization: Localization | null;
  /** Why the file was not used; null when there is no file at all, or it loaded. */
  readonly problem: string | null;
}

/** Read one localization file. Everything about the language comes from the file itself. */
export function parseLocalization(raw: unknown): { localization: Localization } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "not a JSON object" };
  const source = raw as Record<string, unknown>;

  const codeValue = source["locale"] ?? source["code"];
  if (codeValue !== undefined && typeof codeValue !== "string") return { error: `"locale" must be a string` };
  const code = ((codeValue as string | undefined) ?? "").trim();

  const nameValue = source["name"];
  if (nameValue !== undefined && typeof nameValue !== "string") return { error: `"name" must be a string` };
  const name = ((nameValue as string | undefined) ?? code ?? "").trim();

  const stringsValue = source["strings"];
  if (typeof stringsValue !== "object" || stringsValue === null || Array.isArray(stringsValue)) return { error: `"strings" must be an object of key -> text` };
  const strings: Record<string, string> = {};
  for (const [key, value] of Object.entries(stringsValue as Record<string, unknown>)) {
    if (typeof value !== "string") return { error: `"${key}" must be a string` };
    if (value.trim().length > 0) strings[key] = value;
  }
  if (Object.keys(strings).length === 0) return { error: "no strings" };

  const rtlValue = source["rtl"];
  if (rtlValue !== undefined && typeof rtlValue !== "boolean") return { error: `"rtl" must be true or false` };
  const rtl = typeof rtlValue === "boolean" ? rtlValue : isRightToLeft(code);

  return { localization: { name: name.length > 0 ? name : LOCALIZATION_FILE, rtl, strings, translated: Object.keys(strings).length } };
}

/**
 * Put the plugin's localization file in force, or English when there is none.
 * A file that is not valid is named in the log and in the report, and the
 * plugin carries on in English rather than refusing to start.
 */
export async function loadLocalization(transport: Transport, folder: string, log: Logger): Promise<LocalizationReport> {
  const path = `${folder}/${LOCALIZATION_FILE}`;
  let raw: unknown;
  try {
    const text = new TextDecoder("utf-8").decode(await transport.readBinary(path)).replace(/^﻿/, "");
    // An empty file is the same as no file: a sync tool or a half-finished
    // save can leave one behind, and that is not worth a message.
    if (text.trim().length === 0) {
      setLocale(null);
      return { path, localization: null, problem: null };
    }
    raw = JSON.parse(text);
  } catch (e) {
    // No file is the usual case and is not a problem; a file that cannot be
    // read or parsed is.
    const missing = (e as { code?: string }).code === "not-found";
    setLocale(null);
    const problem = missing ? null : e instanceof Error ? e.message : String(e);
    if (problem !== null) log.warn("locale", `${path}: ${problem}; the plugin stays in English`);
    return { path, localization: null, problem };
  }
  const parsed = parseLocalization(raw);
  if ("error" in parsed) {
    setLocale(null);
    log.warn("locale", `${path}: ${parsed.error}; the plugin stays in English`);
    return { path, localization: null, problem: parsed.error };
  }
  const { localization } = parsed;
  setLocale({ code: "custom", name: localization.name, strings: localization.strings } satisfies LoadedLocale);
  log.info("locale", `${path}: ${localization.name}, ${localization.translated} of ${Object.keys(EN_CATALOGUE).length} strings translated`);
  return { path, localization, problem: null };
}

/**
 * The whole catalogue as a localization file: the English example in the
 * repository is this, and a translator writes their language over it. Kept as
 * a function so a test can prove the committed example is still current.
 */
export function localizationExample(code: string, name: string): string {
  const body = {
    locale: code,
    name,
    rtl: isRightToLeft(code),
    strings: Object.fromEntries(Object.keys(EN_CATALOGUE).sort().map((key) => [key, EN_CATALOGUE[key] as string])),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}

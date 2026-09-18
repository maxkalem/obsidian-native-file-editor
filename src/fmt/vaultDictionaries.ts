import type { Logger } from "../core/log";
import type { Transport } from "../platform/transport";
import { type TextDictionary, bundledDictionary, dictionaryJson, parseDictionary, setVaultDictionaries } from "./dictionary";

/**
 * The vault's dictionaries folder: JSON word lists in the shape of
 * `textLanguages.ts`, read at load and on "Reread", exactly as the language
 * folder is. A file named after a bundled language EXTENDS it, or replaces it
 * with `"replace": true`; any other name adds a text language of its own. This
 * is how a missing particle arrives without a release: data, no code, no
 * download (ADR-001, and the no-network rule it rests on).
 *
 * A file that is not valid is named in the log and in the report, and the
 * others still load.
 */

export interface VaultDictionariesReport {
  readonly folder: string;
  /** `name (3 prefixes, 2 suffixes, 40 words)` per dictionary read, with what it did to a bundled one. */
  readonly loaded: string[];
  /** `file: reason` per file that did not load. */
  readonly problems: string[];
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return (slash === -1 ? path : path.slice(slash + 1)).replace(/\.json$/i, "");
}

function describe(dictionary: TextDictionary): string {
  const bundled = bundledDictionary(dictionary.name);
  const what = bundled === null ? "new" : dictionary.replace === true ? `replaces ${bundled.name}` : `extends ${bundled.name}`;
  return `${dictionary.name} (${what}; ${dictionary.prefixes.length} prefixes, ${dictionary.suffixes.length} suffixes, ${dictionary.words.length} words)`;
}

export interface VaultDictionariesInput {
  readonly transport: Transport;
  /** The folder, or null when custom dictionaries are off. */
  readonly folder: string | null;
  readonly log: Logger;
}

/** Read the folder and put what it holds in force; with no folder, the bundled dictionaries alone apply. */
export async function loadVaultDictionaries(input: VaultDictionariesInput): Promise<VaultDictionariesReport> {
  const { transport, folder, log } = input;
  const dictionaries: TextDictionary[] = [];
  const loaded: string[] = [];
  const problems: string[] = [];

  if (folder !== null) {
    let files: string[] = [];
    try {
      files = (await transport.listDir(folder)).files.filter((f) => /\.json$/i.test(f)).sort();
    } catch {
      // No folder: nothing to load, which is the usual case.
    }
    for (const path of files) {
      let raw: unknown;
      try {
        raw = JSON.parse(new TextDecoder("utf-8").decode(await transport.readBinary(path)).replace(/^﻿/, ""));
      } catch (e) {
        problems.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const parsed = parseDictionary(raw, baseName(path));
      if ("error" in parsed) {
        problems.push(`${path}: ${parsed.error}`);
        continue;
      }
      dictionaries.push(parsed.dictionary);
      loaded.push(describe(parsed.dictionary));
    }
  }

  setVaultDictionaries(dictionaries);
  const summary = `${folder ?? "(custom dictionaries off)"}: ${loaded.length} vault dictionar${loaded.length === 1 ? "y" : "ies"}${loaded.length > 0 ? ` (${loaded.join("; ")})` : ""}${problems.length > 0 ? `; problems: ${problems.join("; ")}` : ""}`;
  if (folder !== null || problems.length > 0) log.info("dictionaries", summary);
  return { folder: folder ?? "", loaded, problems };
}

/** Which list a typed word belongs in: `кое-` is a prefix, `-нибудь` a suffix, anything else a word. */
export function listForWord(word: string): { list: "prefixes" | "suffixes" | "words"; entry: string } {
  const trimmed = word.trim().replace(/[‐‑]/g, "-");
  if (/^-/.test(trimmed)) return { list: "suffixes", entry: trimmed.replace(/^-+/, "") };
  if (/-$/.test(trimmed)) return { list: "prefixes", entry: trimmed.replace(/-+$/, "") };
  return { list: "words", entry: trimmed };
}

export interface AddedWord {
  readonly path: string;
  readonly list: "prefixes" | "suffixes" | "words";
  readonly entry: string;
  /** False when the dictionary already held it: the file is left alone and the caller says so. */
  readonly added: boolean;
}

/**
 * Put one word into a text language's dictionary in the vault: the file of
 * that name if the folder has one, otherwise a new file started from the
 * bundled lists (so nothing the plugin knows is lost by editing). The caller
 * rereads afterwards.
 */
export async function addWordToDictionary(transport: Transport, folder: string, language: string, word: string): Promise<AddedWord | null> {
  const { list, entry } = listForWord(word);
  if (entry.length === 0) return null;
  const name = language.trim();
  if (name.length === 0) return null;

  let path: string | null = null;
  let current: TextDictionary | null = null;
  let files: string[] = [];
  try {
    files = (await transport.listDir(folder)).files.filter((f) => /\.json$/i.test(f)).sort();
  } catch {
    // No folder yet: the first word makes it.
  }
  for (const candidate of files) {
    let raw: unknown;
    try {
      raw = JSON.parse(new TextDecoder("utf-8").decode(await transport.readBinary(candidate)).replace(/^﻿/, ""));
    } catch {
      continue;
    }
    const parsed = parseDictionary(raw, baseName(candidate));
    if ("error" in parsed || parsed.dictionary.name.toLowerCase() !== name.toLowerCase()) continue;
    path = candidate;
    current = parsed.dictionary;
    break;
  }
  if (current === null) {
    const bundled = bundledDictionary(name);
    current = bundled ?? { name, prefixes: [], suffixes: [], words: [] };
    path = `${folder}/${current.name}.json`;
  }

  const existing = [...current[list]];
  if (existing.some((w) => w.toLowerCase() === entry.toLowerCase())) return { path: path as string, list, entry, added: false };
  const next: TextDictionary = { ...current, [list]: [...existing, entry] };
  await transport.mkdir(folder);
  await transport.writeBinaryAtomic(path as string, new TextEncoder().encode(dictionaryJson(next)));
  return { path: path as string, list, entry, added: true };
}

/** The bundled dictionary of a text language as a file in the folder, for the user to edit; null when no such language is bundled. */
export async function writeExampleDictionary(transport: Transport, folder: string, languageName: string): Promise<string | null> {
  const dictionary = bundledDictionary(languageName);
  if (dictionary === null) return null;
  await transport.mkdir(folder);
  const path = `${folder}/${dictionary.name}.json`;
  await transport.writeBinaryAtomic(path, new TextEncoder().encode(dictionaryJson(dictionary)));
  return path;
}

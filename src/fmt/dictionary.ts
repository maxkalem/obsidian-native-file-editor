/**
 * Text-language dictionaries: the word knowledge Unwrap uses to tell a word's
 * own hyphen (кое-что, self-evident, linja-auto) from the hyphen a printer put
 * at the end of a line. A dictionary is data, not code: the bundled ones are in
 * `textLanguages.ts`, and a JSON file of the same shape in the vault's
 * dictionaries folder extends a bundled language, replaces it, or adds a new
 * one — no release, no download (the same idea as the vault's language
 * definitions).
 *
 * All loaded dictionaries are merged into ONE lexicon and applied together,
 * whatever the language of the text, because a document carries no language
 * mark and quotes other languages anyway. That is why an entry must name a real
 * hyphenated form and not a syllable ordinary words begin or end with; the
 * reasoning is in `textLanguages.ts`.
 *
 * The lexicon is the SECOND source of the hyphen decision. The text's own
 * evidence comes first and the language-independent rules last: see
 * `hyphenAttachment` in `unwrap.ts`.
 *
 * A pure module: data in, data out, no editor, no Obsidian.
 */

import { TEXT_LANGUAGES } from "./textLanguages";

export interface TextDictionary {
  /** The language's name, as it is shown and as a vault file matches a bundled one. */
  readonly name: string;
  /** Word parts that take a hyphen after them, written without it (`будь`, `self`). */
  readonly prefixes: readonly string[];
  /** Particles that follow a hyphen, written without it (`небудь`, `based`). */
  readonly suffixes: readonly string[];
  /** Whole words: with a hyphen they are kept as they are, without one they say "this word exists", so a split at any point is joined back to it. */
  readonly words: readonly string[];
  /** Keep a hyphen between two identical vowels even outside the Latin script; the Latin-script case is a rule of its own and needs no flag. */
  readonly keepSameVowel?: boolean;
  /** A vault file with a bundled language's name replaces it instead of extending it. */
  readonly replace?: boolean;
  /** Why the lists are what they are. Carried through "Create example…" so the reasoning survives the copy. */
  readonly note?: string;
}

/** The merged word knowledge of every loaded dictionary, lower-cased and with every hyphen character normalised to `-`. */
export interface HyphenLexicon {
  readonly prefixes: ReadonlySet<string>;
  readonly suffixes: ReadonlySet<string>;
  /** Hyphenated words, `кое-что`. */
  readonly hyphenated: ReadonlySet<string>;
  /** Words without a hyphen: their existence says a split is to be joined. */
  readonly plain: ReadonlySet<string>;
  /** Some language wants the same-vowel rule in every script, not only in the Latin one. */
  readonly sameVowelEverywhere: boolean;
}

const HYPHENS = /[-‐‑­−]/g;

/** Lower case, trimmed, every hyphen character the same one. */
export function normalizeEntry(word: string): string {
  return word.trim().toLowerCase().replace(HYPHENS, "-");
}

/** A prefix or a suffix is stored bare, so `кое-` and `-нибудь` are accepted as typed. */
function bareParticle(word: string): string {
  return normalizeEntry(word).replace(/^-+/, "").replace(/-+$/, "");
}

function stringList(value: unknown, field: string): { list: string[] } | { error: string } {
  if (value === undefined || value === null) return { list: [] };
  if (!Array.isArray(value)) return { error: `"${field}" must be an array of strings` };
  const list: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return { error: `"${field}" must be an array of strings` };
    const trimmed = item.trim();
    if (trimmed.length > 0) list.push(trimmed);
  }
  return { list };
}

/**
 * Read one dictionary file. `fallbackName` is the file's base name, used when
 * the JSON carries no `name`, so that `French.json` needs nothing but its
 * lists. A dictionary with no entry at all is refused: an empty file is a
 * mistake, not a language.
 */
export function parseDictionary(raw: unknown, fallbackName: string): { dictionary: TextDictionary } | { error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { error: "not a JSON object" };
  const source = raw as Record<string, unknown>;

  const nameValue = source["name"];
  if (nameValue !== undefined && typeof nameValue !== "string") return { error: `"name" must be a string` };
  const name = ((nameValue as string | undefined) ?? fallbackName).trim();
  if (name.length === 0) return { error: "no name" };

  const prefixes = stringList(source["prefixes"], "prefixes");
  if ("error" in prefixes) return prefixes;
  const suffixes = stringList(source["suffixes"], "suffixes");
  if ("error" in suffixes) return suffixes;
  const words = stringList(source["words"], "words");
  if ("error" in words) return words;
  if (prefixes.list.length === 0 && suffixes.list.length === 0 && words.list.length === 0) return { error: "no prefixes, suffixes or words" };

  const keepSameVowel = source["keepSameVowel"];
  if (keepSameVowel !== undefined && typeof keepSameVowel !== "boolean") return { error: `"keepSameVowel" must be true or false` };
  const replace = source["replace"];
  if (replace !== undefined && typeof replace !== "boolean") return { error: `"replace" must be true or false` };
  const note = source["note"];
  if (note !== undefined && typeof note !== "string") return { error: `"note" must be a string` };

  const dictionary: TextDictionary = {
    name,
    prefixes: prefixes.list,
    suffixes: suffixes.list,
    words: words.list,
    ...(keepSameVowel === true ? { keepSameVowel: true } : {}),
    ...(replace === true ? { replace: true } : {}),
    ...(typeof note === "string" && note.trim().length > 0 ? { note: note.trim() } : {}),
  };
  return { dictionary };
}

/** The file text of a dictionary, in the shape `parseDictionary` reads. */
export function dictionaryJson(dictionary: TextDictionary): string {
  const body: Record<string, unknown> = { name: dictionary.name };
  if (dictionary.note !== undefined) body["note"] = dictionary.note;
  body["prefixes"] = [...dictionary.prefixes];
  body["suffixes"] = [...dictionary.suffixes];
  body["words"] = [...dictionary.words];
  if (dictionary.keepSameVowel === true) body["keepSameVowel"] = true;
  if (dictionary.replace === true) body["replace"] = true;
  return `${JSON.stringify(body, null, 2)}\n`;
}

/** Merge dictionaries into the one lexicon the hyphen decision reads. */
export function buildLexicon(dictionaries: readonly TextDictionary[]): HyphenLexicon {
  const prefixes = new Set<string>();
  const suffixes = new Set<string>();
  const hyphenated = new Set<string>();
  const plain = new Set<string>();
  let sameVowelEverywhere = false;
  for (const dictionary of dictionaries) {
    for (const entry of dictionary.prefixes) {
      const bare = bareParticle(entry);
      if (bare.length > 0) prefixes.add(bare);
    }
    for (const entry of dictionary.suffixes) {
      const bare = bareParticle(entry);
      if (bare.length > 0) suffixes.add(bare);
    }
    for (const entry of dictionary.words) {
      const word = normalizeEntry(entry);
      if (word.length === 0) continue;
      if (word.includes("-")) hyphenated.add(word);
      else plain.add(word);
    }
    if (dictionary.keepSameVowel === true) sameVowelEverywhere = true;
  }
  return { prefixes, suffixes, hyphenated, plain, sameVowelEverywhere };
}

/**
 * A vault dictionary whose name is a bundled language's EXTENDS it, or
 * replaces it with `"replace": true`; any other name is a language of its own.
 * Names are matched case-insensitively, so `ukrainian.json` finds Ukrainian.
 */
export function mergeDictionaries(bundled: readonly TextDictionary[], vault: readonly TextDictionary[]): TextDictionary[] {
  const order: string[] = [];
  const byKey = new Map<string, TextDictionary>();
  for (const dictionary of bundled) {
    const key = dictionary.name.toLowerCase();
    if (!byKey.has(key)) order.push(key);
    byKey.set(key, dictionary);
  }
  for (const dictionary of vault) {
    const key = dictionary.name.toLowerCase();
    const existing = byKey.get(key);
    if (existing === undefined || dictionary.replace === true) {
      if (existing === undefined) order.push(key);
      byKey.set(key, dictionary);
      continue;
    }
    byKey.set(key, {
      name: existing.name,
      prefixes: [...existing.prefixes, ...dictionary.prefixes],
      suffixes: [...existing.suffixes, ...dictionary.suffixes],
      words: [...existing.words, ...dictionary.words],
      ...(existing.keepSameVowel === true || dictionary.keepSameVowel === true ? { keepSameVowel: true } : {}),
      ...(dictionary.note !== undefined ? { note: dictionary.note } : existing.note !== undefined ? { note: existing.note } : {}),
    });
  }
  return order.map((key) => byKey.get(key)).filter((d): d is TextDictionary => d !== undefined);
}

/** The bundled dictionary of that language, or null. Case-insensitive, so a file name finds it. */
export function bundledDictionary(name: string): TextDictionary | null {
  const key = name.trim().toLowerCase();
  return TEXT_LANGUAGES.find((d) => d.name.toLowerCase() === key) ?? null;
}

// The dictionaries loaded from the vault, and the lexicon built from them and
// the bundled ones. Module state, like the language registry: the loader sets
// it once per load or Reread, and `unwrap.ts` reads it per hyphen.
let vaultDictionaries: readonly TextDictionary[] = [];
let lexicon: HyphenLexicon | null = null;

/** Replace the vault's dictionaries (the loader's result, or none) and forget the built lexicon. */
export function setVaultDictionaries(dictionaries: readonly TextDictionary[]): void {
  vaultDictionaries = dictionaries;
  lexicon = null;
}

/** Every dictionary in force: bundled, extended or replaced by the vault's, followed by the vault's own languages. */
export function allDictionaries(): TextDictionary[] {
  return mergeDictionaries(TEXT_LANGUAGES, vaultDictionaries);
}

/** The names to offer in the "Add to dictionary…" modal, in the order above. */
export function allTextLanguageNames(): string[] {
  return allDictionaries().map((d) => d.name);
}

/** The merged lexicon, built on first use after a load and kept until the next one. */
export function activeLexicon(): HyphenLexicon {
  if (lexicon === null) lexicon = buildLexicon(allDictionaries());
  return lexicon;
}

/** Tests and a fresh load start from the bundled set alone. */
export function __clearVaultDictionaries(): void {
  setVaultDictionaries([]);
}

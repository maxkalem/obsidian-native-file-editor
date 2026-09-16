import type { Logger } from "../core/log";
import type { Transport } from "../platform/transport";
import { type KeywordLanguage, parseKeywordLanguage } from "./keywordMode";
import { __clearVaultLanguages, keywordTableFor, registerCustomExtension, registerVaultLanguage } from "./registry";

/**
 * The vault's language folder: JSON definitions in the shape of
 * `langs.generated.ts`, read at load (and on "Reread") and registered before
 * the plugin claims its extensions with Obsidian. A file in the folder WINS
 * for its extensions while it is there (the user's rule: from the folder if
 * present, from the plugin otherwise), so a bundled table can be copied out
 * as an example, edited, and used in place of the original. This is how a
 * language arrives without a release: data, no code, no download (ADR-001).
 * A file that is not valid is named in the log and in the report and the
 * others still load.
 */

export interface VaultLanguagesReport {
  readonly folder: string;
  /** `name (.ext, .ext)` per registered definition, with what it displaced. */
  readonly registered: string[];
  /** `file: reason` per file that did not register. */
  readonly problems: string[];
  /** `.ext -> Language` per custom file type applied. */
  readonly customTypes: string[];
}

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return (slash === -1 ? path : path.slice(slash + 1)).replace(/\.json$/i, "");
}

export interface VaultLanguagesInput {
  readonly transport: Transport;
  /** The folder, or null when custom languages are off. */
  readonly folder: string | null;
  /** ext -> language name, the user's custom file types (applied whether or not the folder is on). */
  readonly customExtensions: Readonly<Record<string, string>>;
  readonly log: Logger;
}

/** Forget what a previous load registered, then read the folder and apply the custom types. */
export async function loadVaultLanguages(input: VaultLanguagesInput): Promise<VaultLanguagesReport> {
  __clearVaultLanguages();
  const { transport, folder, log } = input;
  const registered: string[] = [];
  const problems: string[] = [];
  const customTypes: string[] = [];

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
        raw = JSON.parse(new TextDecoder("utf-8").decode(await transport.readBinary(path)).replace(/^\uFEFF/, ""));
      } catch (e) {
        problems.push(`${path}: ${e instanceof Error ? e.message : String(e)}`);
        continue;
      }
      const parsed = parseKeywordLanguage(raw, baseName(path));
      if ("error" in parsed) {
        problems.push(`${path}: ${parsed.error}`);
        continue;
      }
      const result = registerVaultLanguage(parsed.language);
      if (result.entry.extensions.length === 0) {
        problems.push(`${path}: nothing taken: ${result.kept.join(", ")}`);
        continue;
      }
      registered.push(`${result.entry.name} (${result.entry.extensions.map((e) => `.${e}`).join(", ")})${result.displaced.length > 0 ? `; replaces ${result.displaced.join(", ")}` : ""}${result.kept.length > 0 ? `; kept ${result.kept.join(", ")}` : ""}`);
    }
  }

  for (const [ext, language] of Object.entries(input.customExtensions)) {
    const r = registerCustomExtension(ext, language);
    if (!r) problems.push(`custom type .${ext}: no language named "${language}"`);
    else customTypes.push(`.${ext} -> ${r.entry.name}${r.displaced ? ` (${r.displaced})` : ""}`);
  }

  const summary = `${folder ?? "(custom languages off)"}: ${registered.length} vault definition${registered.length === 1 ? "" : "s"}${registered.length > 0 ? ` (${registered.join("; ")})` : ""}${customTypes.length > 0 ? `; custom types ${customTypes.join(", ")}` : ""}${problems.length > 0 ? `; problems: ${problems.join("; ")}` : ""}`;
  if (folder !== null || customTypes.length > 0 || problems.length > 0) log.info("languages", summary);
  return { folder: folder ?? "", registered, problems, customTypes };
}

/** The JSON text of an example definition for a tier-4 language, one word per line, or null when the language is not table-driven. */
export function exampleLanguageJson(languageName: string): { fileName: string; json: string } | null {
  const table = keywordTableFor(languageName);
  if (!table) return null;
  const body: Omit<KeywordLanguage, "id" | "sets"> & { sets: Array<[string, string[]]> } = {
    name: table.name,
    extensions: table.extensions,
    caseInsensitive: table.caseInsensitive,
    commentLine: table.commentLine,
    commentStart: table.commentStart,
    commentEnd: table.commentEnd,
    sets: table.sets.map(([role, words]) => [role, words.split(" ")]),
  };
  return { fileName: `${table.id}.json`, json: `${JSON.stringify(body, null, 2)}\n` };
}

/** Write the example definition for a language into the folder (creating it), replacing an existing file. */
export async function writeExampleLanguage(transport: Transport, folder: string, languageName: string): Promise<string | null> {
  const example = exampleLanguageJson(languageName);
  if (!example) return null;
  await transport.mkdir(folder);
  const path = `${folder}/${example.fileName}`;
  await transport.writeBinaryAtomic(path, new TextEncoder().encode(example.json));
  return path;
}

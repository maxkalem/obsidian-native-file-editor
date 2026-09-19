import type { Logger } from "../core/log";
import type { Transport } from "../platform/transport";
import { EMPTY_AFFIX, HunspellScan, decoderLabel, parseAff } from "./hunspell";

/**
 * The Hunspell files a user put beside the plugin's own word lists, and the
 * one thing this plugin does with them: look a handful of words up.
 *
 * The files are installed by hand (the plugin bundles none and downloads
 * nothing) into the dictionary folder, `<plugin folder>/dictionaries/` by
 * default, where the plugin's own `.json` lists live; the JSON loader reads
 * only `*.json`, so a `.dic`/`.aff` pair sits there without disturbing it.
 *
 * Reading is chunked (`transport.readChunks`) and stops as soon as every word
 * is answered, so an 8.5 MB dictionary costs one pass at worst and nothing is
 * kept afterwards.
 */

/** A `.dic` and the `.aff` beside it, by their shared base name. */
export interface HunspellPair {
  /** The base name, which is what the user sees: `uk_UA`, `en_US`. */
  readonly name: string;
  readonly dic: string;
  /** The affix file; without it only literal entries can match, and the log says so. */
  readonly aff: string | null;
}

const CHUNK = 1 << 20;

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? path : path.slice(slash + 1);
}

/** The `.dic` files of the folder, each with the `.aff` of the same name; nothing there is not an error. */
export async function findHunspellDictionaries(transport: Transport, folder: string | null): Promise<HunspellPair[]> {
  if (folder === null) return [];
  let files: string[];
  try {
    files = (await transport.listDir(folder)).files;
  } catch {
    return [];
  }
  const affixes = new Map<string, string>();
  for (const path of files) {
    const name = baseName(path);
    if (name.toLowerCase().endsWith(".aff")) affixes.set(name.slice(0, -4).toLowerCase(), path);
  }
  const out: HunspellPair[] = [];
  for (const path of files) {
    const name = baseName(path);
    if (!name.toLowerCase().endsWith(".dic")) continue;
    const base = name.slice(0, -4);
    out.push({ name: base, dic: path, aff: affixes.get(base.toLowerCase()) ?? null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface HunspellCheck {
  /** The words the dictionary knows, of the ones asked about. */
  readonly known: ReadonlySet<string>;
  /** Entries read before the answer was complete; a measurement, and proof the file was a dictionary. */
  readonly entries: number;
  /** Whether the whole file had to be read, or the words were all answered earlier. */
  readonly wholeFile: boolean;
  /** Set when the check could not run; the caller shows it and changes nothing. */
  readonly problem: string | null;
}

/**
 * The affix file, decoded by its own `SET` line. The line is ASCII whatever the
 * file's encoding, so it is read from the first bytes before anything else is
 * decoded.
 */
export function readAffix(bytes: Uint8Array): { text: string; encoding: string } {
  const head = new TextDecoder("iso-8859-1").decode(bytes.subarray(0, Math.min(bytes.length, 512)));
  const set = /^SET\s+(\S+)/m.exec(head);
  const encoding = set?.[1] ?? "UTF-8";
  return { text: new TextDecoder(decoderLabel(encoding)).decode(bytes), encoding };
}

/**
 * Look the words up in one dictionary. Everything that can go wrong with a
 * file someone copied in by hand — missing, unreadable, an encoding no
 * decoder knows — comes back as `problem`, because a review step that cannot
 * run must say so rather than declare every word unknown.
 */
export async function checkWithHunspell(deps: {
  readonly transport: Transport;
  readonly pair: HunspellPair;
  readonly words: readonly string[];
  readonly log?: Logger;
}): Promise<HunspellCheck> {
  const { transport, pair, words, log } = deps;
  if (words.length === 0) return { known: new Set(), entries: 0, wholeFile: false, problem: null };
  let affix = EMPTY_AFFIX;
  if (pair.aff !== null) {
    try {
      affix = parseAff(readAffix(await transport.readBinary(pair.aff)).text);
    } catch (e) {
      return { known: new Set(), entries: 0, wholeFile: false, problem: message(e) };
    }
  }
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(decoderLabel(affix.encoding));
  } catch {
    return { known: new Set(), entries: 0, wholeFile: false, problem: `unknown encoding ${affix.encoding}` };
  }
  const scan = new HunspellScan(words, affix);
  const started = Date.now();
  let wholeFile = true;
  try {
    if (typeof transport.readChunks === "function") {
      await transport.readChunks(pair.dic, CHUNK, (bytes) => {
        scan.feed(decoder.decode(bytes, { stream: true }));
        if (!scan.complete) return true;
        wholeFile = false;
        return false;
      });
    } else {
      // A platform without file handles: read once, then let it go. The words
      // are still answered from a scan, not from a word list held in memory.
      const bytes = await transport.readBinary(pair.dic);
      for (let at = 0; at < bytes.length; at += CHUNK) {
        scan.feed(decoder.decode(bytes.subarray(at, Math.min(at + CHUNK, bytes.length)), { stream: true }));
        if (scan.complete) {
          wholeFile = false;
          break;
        }
      }
    }
    scan.end();
  } catch (e) {
    return { known: new Set(), entries: scan.lines, wholeFile: false, problem: message(e) };
  }
  const known = scan.known();
  log?.info(
    "hunspell",
    `${pair.dic}: ${words.length} word(s), ${scan.candidateCount} candidate stem(s), ${scan.lines} entries read${wholeFile ? "" : " (stopped early)"}, ${known.size} known, ${Date.now() - started} ms`
  );
  return { known, entries: scan.lines, wholeFile, problem: null };
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

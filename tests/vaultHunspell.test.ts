import { describe, expect, it } from "vitest";
import { Logger } from "../src/core/log";
import { checkWithHunspell, findHunspellDictionaries, readAffix } from "../src/fmt/vaultHunspell";
import { type Transport, TransportError } from "../src/platform/transport";

/**
 * The Hunspell files as they arrive: copied by hand into the dictionary
 * folder beside the plugin's own `.json` lists, in whatever encoding their
 * `.aff` declares, and read in pieces on a platform that can, in one piece on
 * one that cannot.
 */

const FOLDER = ".obsidian/plugins/native-file-editor/dictionaries";

class MemoryTransport implements Transport {
  readonly kind = "desktop" as const;
  files = new Map<string, Uint8Array>();
  /** What was asked for in pieces, and how many pieces were taken before the reader stopped. */
  chunked: string[] = [];
  chunks = 0;
  constructor(readonly streaming: boolean) {}
  async readBinary(p: string): Promise<Uint8Array> {
    const f = this.files.get(p);
    if (!f) throw new TransportError("not-found", p, p);
    return f;
  }
  async writeBinaryAtomic(p: string, bytes: Uint8Array): Promise<void> {
    this.files.set(p, bytes);
  }
  inflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  deflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  async listDir(folder: string): Promise<{ files: string[]; folders: string[] }> {
    return { files: [...this.files.keys()].filter((p) => p.startsWith(`${folder}/`)), folders: [] };
  }
  async mkdir(): Promise<void> {}
  readChunks = undefined as undefined | ((p: string, size: number, onChunk: (b: Uint8Array) => boolean | Promise<boolean>) => Promise<void>);
  put(path: string, text: string, encoding: "utf-8" | "latin-1" = "utf-8"): void {
    if (encoding === "utf-8") {
      this.files.set(path, new TextEncoder().encode(text));
      return;
    }
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i) & 0xff;
    this.files.set(path, bytes);
  }
}

function streaming(): MemoryTransport {
  const transport = new MemoryTransport(true);
  transport.readChunks = async (path, _size, onChunk) => {
    transport.chunked.push(path);
    const bytes = await transport.readBinary(path);
    // Deliberately small pieces, so a chunk cuts through lines and characters.
    for (let at = 0; at < bytes.length; at += 7) {
      transport.chunks++;
      if ((await onChunk(bytes.subarray(at, Math.min(at + 7, bytes.length)))) === false) return;
    }
  };
  return transport;
}

const UK_AFF = "SET UTF-8\nSFX j Y 1\nSFX j ий ого ий\n";
const UK_DIC = "3\nнью-йоркський/j\nпопередній/j\nвіч-на-віч\n";

describe("the Hunspell files in the vault", () => {
  it("pairs a .dic with the .aff of the same name, and reports one without its .aff", async () => {
    const transport = new MemoryTransport(false);
    transport.put(`${FOLDER}/uk_UA.dic`, UK_DIC);
    transport.put(`${FOLDER}/uk_UA.aff`, UK_AFF);
    transport.put(`${FOLDER}/plain.dic`, "1\nword\n");
    transport.put(`${FOLDER}/Ukrainian.json`, "{}");
    const found = await findHunspellDictionaries(transport, FOLDER);
    expect(found.map((p) => p.name)).toEqual(["plain", "uk_UA"]);
    expect(found[1]?.aff).toBe(`${FOLDER}/uk_UA.aff`);
    expect(found[0]?.aff).toBeNull();
    // No folder at all is not an error: most people have no Hunspell files.
    expect(await findHunspellDictionaries(transport, null)).toEqual([]);
  });

  it("answers the words through the affix rules, reading the file in pieces and stopping when they are all answered", async () => {
    const transport = streaming();
    transport.put(`${FOLDER}/uk_UA.dic`, UK_DIC);
    transport.put(`${FOLDER}/uk_UA.aff`, UK_AFF);
    const [pair] = await findHunspellDictionaries(transport, FOLDER);
    const result = await checkWithHunspell({ transport, pair: pair!, words: ["ньюйоркського", "нью-йоркського", "віч-на-віч"] });
    expect(result.problem).toBeNull();
    // The joined form is unknown, the hyphenated one is known: that is the
    // signal the review step shows, and the reason a hyphen goes back.
    expect([...result.known].sort()).toEqual(["віч-на-віч", "нью-йоркського"]);
    expect(transport.chunked).toEqual([`${FOLDER}/uk_UA.dic`]);
  });

  it("stops reading as soon as every word is answered", async () => {
    const transport = streaming();
    transport.put(`${FOLDER}/uk_UA.dic`, `${UK_DIC}${"зайве\n".repeat(500)}`);
    transport.put(`${FOLDER}/uk_UA.aff`, UK_AFF);
    const [pair] = await findHunspellDictionaries(transport, FOLDER);
    const result = await checkWithHunspell({ transport, pair: pair!, words: ["попередній"] });
    expect([...result.known]).toEqual(["попередній"]);
    expect(result.wholeFile).toBe(false);
    expect(transport.chunks).toBeLessThan(20);
  });

  it("reads a file in the encoding its .aff declares, and without readChunks reads it whole", async () => {
    const transport = new MemoryTransport(false);
    transport.put(`${FOLDER}/en_US.aff`, "SET ISO8859-1\nSFX D Y 1\nSFX D 0 ed [^ey]\n", "latin-1");
    transport.put(`${FOLDER}/en_US.dic`, "2\nrésumé/D\njoin/D\n", "latin-1");
    const [pair] = await findHunspellDictionaries(transport, FOLDER);
    const result = await checkWithHunspell({ transport, pair: pair!, words: ["résumé", "joined"] });
    expect([...result.known].sort()).toEqual(["joined", "résumé"]);
  });

  it("says what went wrong instead of calling every word unknown", async () => {
    const transport = new MemoryTransport(false);
    transport.put(`${FOLDER}/broken.aff`, "SET NO-SUCH-ENCODING\n");
    transport.put(`${FOLDER}/broken.dic`, "1\nword\n");
    const [pair] = await findHunspellDictionaries(transport, FOLDER);
    const result = await checkWithHunspell({ transport, pair: pair!, words: ["word"] });
    expect(result.problem).not.toBeNull();
    expect(result.known.size).toBe(0);
  });

  it("logs what it read, so a file that is not a dictionary shows up as a count", async () => {
    const transport = streaming();
    transport.put(`${FOLDER}/uk_UA.dic`, UK_DIC);
    transport.put(`${FOLDER}/uk_UA.aff`, UK_AFF);
    const log = new Logger({ sink: null, timers: { setTimeout: () => 0, clearTimeout: () => undefined }, now: () => 0 });
    const [pair] = await findHunspellDictionaries(transport, FOLDER);
    await checkWithHunspell({ transport, pair: pair!, words: ["невідоме"], log });
    const line = log.recent().find((entry) => entry.includes("[hunspell]"));
    expect(line).toContain("3 entries read");
  });

  it("reads the affix file by its own SET line, which is ASCII whatever the rest is", () => {
    const latin1 = new Uint8Array([...'SET ISO8859-1\nTRY résumé\n'].map((c) => c.charCodeAt(0) & 0xff));
    const read = readAffix(latin1);
    expect(read.encoding).toBe("ISO8859-1");
    expect(read.text).toContain("résumé");
  });
});

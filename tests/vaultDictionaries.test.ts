import { afterEach, describe, expect, it } from "vitest";
import { Logger } from "../src/core/log";
import { __clearVaultDictionaries, activeLexicon, allTextLanguageNames, parseDictionary } from "../src/fmt/dictionary";
import { addWordToDictionary, listForWord, loadVaultDictionaries, writeExampleDictionary } from "../src/fmt/vaultDictionaries";
import { type Transport, TransportError } from "../src/platform/transport";

/**
 * The vault's dictionaries folder: word lists that extend, replace or add a
 * text language, read at load and on Reread, with a bad file named and the
 * others still loaded.
 */

class MemoryTransport implements Transport {
  readonly kind = "desktop" as const;
  files = new Map<string, Uint8Array>();
  made: string[] = [];
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
  async listDir(p: string): Promise<{ files: string[]; folders: string[] }> {
    const files = [...this.files.keys()].filter((k) => k.startsWith(`${p}/`) && !k.slice(p.length + 1).includes("/"));
    if (files.length === 0) throw new TransportError("list-failed", p, p);
    return { files, folders: [] };
  }
  async mkdir(p: string): Promise<void> {
    this.made.push(p);
  }
  put(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }
  text(path: string): string {
    return new TextDecoder().decode(this.files.get(path) ?? new Uint8Array());
  }
}

const FOLDER = ".obsidian/plugins/native-file-editor/dictionaries";
const log = () => new Logger({ sink: null, timers: { setTimeout: () => 0, clearTimeout: () => undefined }, now: () => 0 });

afterEach(() => __clearVaultDictionaries());

describe("loadVaultDictionaries", () => {
  it("extends a bundled language, adds a new one, and says which is which", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/Ukrainian.json`, JSON.stringify({ prefixes: ["мега"], words: ["мега-байт"] }));
    transport.put(`${FOLDER}/Klingon.json`, JSON.stringify({ name: "Klingon", words: ["nuq-neH"] }));
    const report = await loadVaultDictionaries({ transport, folder: FOLDER, log: log() });
    expect(report.problems).toEqual([]);
    expect(report.loaded).toEqual(["Klingon (new; 0 prefixes, 0 suffixes, 1 words)", "Ukrainian (extends Ukrainian; 1 prefixes, 0 suffixes, 1 words)"]);
    const lexicon = activeLexicon();
    expect(lexicon.hyphenated.has("мега-байт")).toBe(true);
    expect(lexicon.hyphenated.has("nuq-neh")).toBe(true);
    // The bundled entries are still there, because the file extends them.
    expect(lexicon.hyphenated.has("будь-що")).toBe(true);
    expect(allTextLanguageNames()).toContain("Klingon");
  });

  it("replaces the bundled language when the file says so", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/Ukrainian.json`, JSON.stringify({ words: ["мега-байт"], replace: true }));
    const report = await loadVaultDictionaries({ transport, folder: FOLDER, log: log() });
    expect(report.loaded).toEqual(["Ukrainian (replaces Ukrainian; 0 prefixes, 0 suffixes, 1 words)"]);
    expect(activeLexicon().hyphenated.has("будь-що")).toBe(false);
    expect(activeLexicon().hyphenated.has("мега-байт")).toBe(true);
  });

  it("names the file that is not valid and loads the others", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/broken.json`, "{ not json");
    transport.put(`${FOLDER}/Empty.json`, "{}");
    transport.put(`${FOLDER}/Klingon.json`, JSON.stringify({ words: ["nuq-neH"] }));
    transport.put(`${FOLDER}/notes.txt`, "ignored");
    const report = await loadVaultDictionaries({ transport, folder: FOLDER, log: log() });
    expect(report.loaded).toEqual(["Klingon (new; 0 prefixes, 0 suffixes, 1 words)"]);
    expect(report.problems.length).toBe(2);
    expect(report.problems[1]).toBe(`${FOLDER}/broken.json: Expected property name or '}' in JSON at position 2 (line 1 column 3)`);
    expect(report.problems[0]?.startsWith(`${FOLDER}/Empty.json: no prefixes`)).toBe(true);
    expect(activeLexicon().hyphenated.has("nuq-neh")).toBe(true);
  });

  it("with the folder off puts the bundled dictionaries back, and a missing folder is not a problem", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/Ukrainian.json`, JSON.stringify({ words: ["мега-байт"], replace: true }));
    await loadVaultDictionaries({ transport, folder: FOLDER, log: log() });
    expect(activeLexicon().hyphenated.has("будь-що")).toBe(false);
    const off = await loadVaultDictionaries({ transport, folder: null, log: log() });
    expect(off).toEqual({ folder: "", loaded: [], problems: [] });
    expect(activeLexicon().hyphenated.has("будь-що")).toBe(true);
    const missing = await loadVaultDictionaries({ transport: new MemoryTransport(), folder: FOLDER, log: log() });
    expect(missing.problems).toEqual([]);
  });
});

describe("addWordToDictionary", () => {
  it("puts a word in the list its shape names, keeping what the bundled dictionary had", async () => {
    const transport = new MemoryTransport();
    expect(listForWord("кое-")).toEqual({ list: "prefixes", entry: "кое" });
    expect(listForWord("-нибудь")).toEqual({ list: "suffixes", entry: "нибудь" });
    expect(listForWord(" віч-на-віч ")).toEqual({ list: "words", entry: "віч-на-віч" });

    const added = await addWordToDictionary(transport, FOLDER, "Ukrainian", "мега-байт");
    expect(added).toMatchObject({ path: `${FOLDER}/Ukrainian.json`, list: "words", entry: "мега-байт", added: true });
    const parsed = parseDictionary(JSON.parse(transport.text(`${FOLDER}/Ukrainian.json`)), "file");
    if (!("dictionary" in parsed)) throw new Error(parsed.error);
    expect(parsed.dictionary.words).toContain("мега-байт");
    expect(parsed.dictionary.words).toContain("будь-що");
    // A second word goes into the same file, in the list its hyphen names.
    const prefix = await addWordToDictionary(transport, FOLDER, "ukrainian", "супер-");
    expect(prefix).toMatchObject({ list: "prefixes", entry: "супер", added: true });
    const again = parseDictionary(JSON.parse(transport.text(`${FOLDER}/Ukrainian.json`)), "file");
    expect("dictionary" in again && again.dictionary.prefixes).toContain("супер");
    expect("dictionary" in again && again.dictionary.words).toContain("мега-байт");
  });

  it("finds the file by the name inside it, not by its file name", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/mine.json`, JSON.stringify({ name: "Klingon", words: ["nuq-neH"] }));
    const added = await addWordToDictionary(transport, FOLDER, "klingon", "-vetlh");
    expect(added).toMatchObject({ path: `${FOLDER}/mine.json`, list: "suffixes", entry: "vetlh", added: true });
    const parsed = parseDictionary(JSON.parse(transport.text(`${FOLDER}/mine.json`)), "file");
    expect("dictionary" in parsed && parsed.dictionary.words).toEqual(["nuq-neH"]);
  });

  it("says so and writes nothing when the word is already there or is no word", async () => {
    const transport = new MemoryTransport();
    await addWordToDictionary(transport, FOLDER, "Klingon", "nuq-neH");
    const before = transport.text(`${FOLDER}/Klingon.json`);
    expect(await addWordToDictionary(transport, FOLDER, "Klingon", "NUQ-NEH")).toMatchObject({ added: false });
    expect(transport.text(`${FOLDER}/Klingon.json`)).toBe(before);
    expect(await addWordToDictionary(transport, FOLDER, "Klingon", "  -  ")).toBeNull();
    expect(await addWordToDictionary(transport, FOLDER, "  ", "word")).toBeNull();
  });
});

describe("writeExampleDictionary", () => {
  it("writes the bundled lists under the language's name, creating the folder, and the file reads back", async () => {
    const transport = new MemoryTransport();
    const path = await writeExampleDictionary(transport, FOLDER, "finnish");
    expect(path).toBe(`${FOLDER}/Finnish.json`);
    expect(transport.made).toEqual([FOLDER]);
    const parsed = parseDictionary(JSON.parse(transport.text(path!)), "file");
    expect("dictionary" in parsed && parsed.dictionary.name).toBe("Finnish");
    expect("dictionary" in parsed && parsed.dictionary.words).toContain("linja-auto");
    // The reasoning of the lists travels with the copy.
    expect("dictionary" in parsed && (parsed.dictionary.note ?? "")).toMatch(/vowel/);
  });

  it("says no for a language nothing bundles", async () => {
    const transport = new MemoryTransport();
    expect(await writeExampleDictionary(transport, FOLDER, "Klingon")).toBeNull();
    expect(transport.made).toEqual([]);
  });
});

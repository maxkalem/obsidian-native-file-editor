import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { Logger } from "../src/core/log";
import { __clearVaultLanguages, languageFor, languageNamed, registerCustomExtension, registerVaultLanguage, registeredExtensions, resolveLanguage } from "../src/highlight/registry";
import { exampleLanguageJson, loadVaultLanguages, writeExampleLanguage } from "../src/highlight/vaultLanguages";
import { type Transport, TransportError } from "../src/platform/transport";

/**
 * The vault's language folder: JSON definitions registered at load for the
 * extensions nothing bundled covers. docs/languages/hollywood.json is the
 * example the docs point at, so it has to load as it is.
 */

class MemoryTransport implements Transport {
  readonly kind = "desktop" as const;
  files = new Map<string, Uint8Array>();
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
  async mkdir(): Promise<void> {}
  put(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }
}

const FOLDER = ".obsidian/plugins/native-file-editor/languages";
const hollywood = readFileSync(fileURLToPath(new URL("../docs/languages/hollywood.json", import.meta.url)), "utf8");
const log = () => new Logger({ sink: null, timers: { setTimeout: () => 0, clearTimeout: () => undefined }, now: () => 0 });

afterEach(() => __clearVaultLanguages());

describe("registerVaultLanguage and registerCustomExtension", () => {
  it("a vault definition wins for its extensions while it is registered, keeps a grammar's extension unless it says replace, and the bundled claim comes back when it is cleared", () => {
    // Without `replace`, a grammar's extension (.py is lang-python) is kept; a tier-4 keyword table's (.bat is Batch) and an unclaimed one are taken.
    const shy = registerVaultLanguage({ id: "y", name: "Ylang", extensions: ["ylang", "py", "bat"], caseInsensitive: false, commentLine: "#", commentStart: null, commentEnd: null, sets: [["keyword", "let"]] });
    expect(shy.entry.extensions).toEqual(["ylang", "bat"]);
    expect(shy.kept).toEqual(['.py (Python is a grammar; add "replace": true to take it over)']);
    expect(shy.displaced).toEqual([".bat (was Batch)"]);
    expect(languageFor("py")?.name).toBe("Python");
    expect(languageFor("bat")?.name).toBe("Ylang");
    __clearVaultLanguages();
    const r = registerVaultLanguage({ id: "x", name: "Xlang", extensions: ["xlang", "py", "xl"], caseInsensitive: false, commentLine: "#", commentStart: null, commentEnd: null, sets: [["keyword", "let"]], replace: true });
    expect(r.entry.extensions).toEqual(["xlang", "py", "xl"]);
    expect(r.displaced).toEqual([".py (was Python)"]);
    expect(r.kept).toEqual([]);
    expect(languageFor("xlang")?.source).toBe("vault");
    expect(languageFor("py")?.name).toBe("Xlang");
    expect(languageNamed("xlang")?.name).toBe("Xlang");
    expect(registeredExtensions()).toContain("xlang");
    const resolved = resolveLanguage(languageFor("xlang") as never);
    expect(resolved?.language).toBeDefined();
    __clearVaultLanguages();
    expect(languageFor("xlang")).toBeNull();
    expect(languageFor("py")?.name).toBe("Python");
    expect(languageNamed("xlang")).toBeNull();
  });

  it("a custom file type maps an extension onto an existing language, bundled claim or not", () => {
    expect(registerCustomExtension("zz", "Nope")).toBeNull();
    expect(registerCustomExtension("z z", "Python")).toBeNull();
    const r = registerCustomExtension(".ZZ", "Python");
    expect(r?.entry.name).toBe("Python");
    expect(r?.displaced).toBeNull();
    expect(languageFor("zz")?.name).toBe("Python");
    const over = registerCustomExtension("rb", "Plain text");
    expect(over?.displaced).toBe(".rb (was Ruby)");
    expect(languageFor("rb")?.name).toBe("Plain text");
    __clearVaultLanguages();
    expect(languageFor("zz")).toBeNull();
    expect(languageFor("rb")?.name).toBe("Ruby");
  });
});

describe("loadVaultLanguages", () => {
  it("with the folder off and no custom types, nothing is read and nothing is logged", async () => {
    const l = log();
    const r = await loadVaultLanguages({ transport: new MemoryTransport(), folder: null, customExtensions: {}, log: l });
    expect(r).toEqual({ folder: "", registered: [], problems: [], customTypes: [] });
    expect(l.recent()).toEqual([]);
  });

  it("a missing folder is nothing, not an error", async () => {
    const r = await loadVaultLanguages({ transport: new MemoryTransport(), folder: FOLDER, customExtensions: {}, log: log() });
    expect(r).toEqual({ folder: FOLDER, registered: [], problems: [], customTypes: [] });
  });

  it("loads the shipped example as it is, names the bad files, applies custom types, and skips non-JSON", async () => {
    const t = new MemoryTransport();
    t.put(`${FOLDER}/hollywood.json`, hollywood);
    t.put(`${FOLDER}/broken.json`, "{ not json");
    t.put(`${FOLDER}/noname.json`, '{"extensions":["zz"]}');
    t.put(`${FOLDER}/mypy.json`, '{"name":"My Python","extensions":["py"],"sets":[["keyword","def"]],"replace":true}');
    // Without `replace`, a table aimed at a grammar's extension takes nothing and is a problem, not a silent downgrade (2026-09-17).
    t.put(`${FOLDER}/shy.json`, '{"name":"Shy","extensions":["ts"],"sets":[["keyword","let"]]}');
    t.put(`${FOLDER}/empty.json`, '{"name":"Empty","extensions":["emp"]}');
    t.put(`${FOLDER}/readme.md`, "# ignored");
    const l = log();
    const r = await loadVaultLanguages({ transport: t, folder: FOLDER, customExtensions: { xl: "Python", bad: "Nope" }, log: l });
    expect(r.registered).toEqual(["Hollywood (.hws)", "My Python (.py); replaces .py (was Python)"]);
    expect(r.problems).toEqual([
      expect.stringMatching(/^\.obsidian\/plugins\/native-file-editor\/languages\/broken\.json: /),
      `${FOLDER}/empty.json: no keyword sets and no patterns: files would show only comments; add sets`,
      `${FOLDER}/noname.json: name is missing`,
      `${FOLDER}/shy.json: nothing taken: .ts (TypeScript is a grammar; add "replace": true to take it over)`,
      'custom type .bad: no language named "Nope"',
    ]);
    expect(languageFor("ts")?.name).toBe("TypeScript");
    expect(r.customTypes).toEqual([".xl -> Python"]);
    expect(languageFor("hws")?.name).toBe("Hollywood");
    expect(languageFor("py")?.name).toBe("My Python");
    expect(languageFor("xl")?.name).toBe("Python");
    expect(l.recent().join("\n")).toContain("2 vault definitions");
    // A second load forgets the first: the folder now empty, Python is Python again.
    t.files.clear();
    await loadVaultLanguages({ transport: t, folder: FOLDER, customExtensions: {}, log: l });
    expect(languageFor("py")?.name).toBe("Python");
    expect(languageFor("hws")).toBeNull();
  });
});

describe("example definitions", () => {
  it("a keyword-table language has one, a grammar has none, and it loads back", async () => {
    expect(exampleLanguageJson("Python")).toBeNull();
    const ex = exampleLanguageJson("Batch");
    expect(ex?.fileName).toBe("batch.json");
    const parsed = JSON.parse(ex?.json ?? "") as { name: string; extensions: string[]; sets: Array<[string, string[]]> };
    expect(parsed.name).toBe("Batch");
    expect(parsed.extensions).toEqual(["bat", "cmd"]);
    expect(parsed.sets[0]?.[1]).toContain("echo");
    const t = new MemoryTransport();
    expect(await writeExampleLanguage(t, FOLDER, "Python")).toBeNull();
    expect(await writeExampleLanguage(t, FOLDER, "Batch")).toBe(`${FOLDER}/batch.json`);
    const r = await loadVaultLanguages({ transport: t, folder: FOLDER, customExtensions: {}, log: log() });
    expect(r.registered).toEqual(["Batch (.bat, .cmd); replaces .bat (was Batch), .cmd (was Batch)"]);
    expect(languageFor("bat")?.source).toBe("vault");
  });
});

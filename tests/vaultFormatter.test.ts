import { readFileSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { KNOWN_FILES, KNOWN_HASHES, filesForExtension } from "../src/fmt/prettierFiles";
import { extensionsServed, formatWithPrettier, formatterFolderPath, parserFor, readFormatterFolder, sha256Hex } from "../src/fmt/vaultFormatter";
import { type Transport, TransportError } from "../src/platform/transport";

/**
 * The formatter a user installs by hand (ADR-005). The tests run against the
 * real prettier files in `formatters/prettier/` when they are there —
 * the same files the repository ships, so what is measured here is what a
 * user will get — and against small fakes for everything about trust, which
 * must hold whatever the file is.
 */

const PLUGIN = ".obsidian/plugins/native-file-editor";
const FOLDER = formatterFolderPath(PLUGIN);
const SHIPPED = new URL("../formatters/prettier/", import.meta.url);
const EXTRA = new URL("../formatters/extra/", import.meta.url);

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
  async listDir(folder: string): Promise<{ files: string[]; folders: string[] }> {
    const files = [...this.files.keys()].filter((p) => p.startsWith(`${folder}/`));
    if (files.length === 0) throw new TransportError("not-found", folder, folder);
    return { files, folders: [] };
  }
  async mkdir(): Promise<void> {}
  put(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }
  /** Copy one of the files the repository ships into the fake plugin folder. */
  install(name: string, from: URL = SHIPPED): boolean {
    const url = new URL(name, from);
    if (!existsSync(url)) return false;
    this.files.set(`${FOLDER}/${name}`, new Uint8Array(readFileSync(url)));
    return true;
  }
}

const shipped = existsSync(new URL("standalone.js", SHIPPED));

describe("the formatters folder", () => {
  it("sees only the names this plugin knows, and names the rest without reading them", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/standalone.js`, "//");
    transport.put(`${FOLDER}/postcss.js`, "//");
    transport.put(`${FOLDER}/evil.js`, "throw new Error('never run')");
    const folder = await readFormatterFolder(transport, PLUGIN);
    expect([...folder.present].sort()).toEqual(["postcss.js", "standalone.js"]);
    expect(folder.strangers).toEqual(["evil.js"]);
    // CSS is served, JavaScript is not: babel and estree are not there.
    expect([...extensionsServed(folder.present)].sort()).toEqual(["css", "less", "scss"]);
  });

  it("is not an error when nobody installed anything", async () => {
    const folder = await readFormatterFolder(new MemoryTransport(), PLUGIN);
    expect(folder.present.size).toBe(0);
    expect(extensionsServed(folder.present).size).toBe(0);
  });

  it("knows which files an extension needs, and which of them are missing", () => {
    expect(filesForExtension("ts", new Set(["standalone.js"]))).toEqual({ files: ["standalone.js", "estree.js", "typescript.js"], missing: ["estree.js", "typescript.js"] });
    expect(filesForExtension("rs", new Set())).toBeNull();
  });
});

describe("what is executed", () => {
  it("refuses a file whose hash nobody approved, and runs nothing", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/standalone.js`, "globalThis.__nfe_ran = true;");
    transport.put(`${FOLDER}/postcss.js`, "//");
    const folder = await readFormatterFolder(transport, PLUGIN);
    const out = await formatWithPrettier({ transport, folder, trusted: [], extension: "css", text: "a{b:c}", indent: "  ", eol: "\n" });
    expect(out.kind).toBe("untrusted");
    expect((globalThis as { __nfe_ran?: boolean }).__nfe_ran).toBeUndefined();
  });

  it("runs a file the user confirmed once, by its hash", async () => {
    const transport = new MemoryTransport();
    const code = "module.exports = { version: '0.0.1', format: async (t) => `${t}!`, getSupportInfo: async () => ({ languages: [{ extensions: ['.css'], parsers: ['css'] }] }) };";
    transport.put(`${FOLDER}/standalone.js`, code);
    transport.put(`${FOLDER}/postcss.js`, "module.exports = { parsers: {} };");
    const folder = await readFormatterFolder(transport, PLUGIN);
    const hashes = [await sha256Hex(code), await sha256Hex("module.exports = { parsers: {} };")];
    const out = await formatWithPrettier({ transport, folder, trusted: hashes, extension: "css", text: "a{b:c}", indent: "  ", eol: "\n" });
    expect(out).toEqual({ kind: "formatted", text: "a{b:c}!", version: "0.0.1" });
  });

  it("refuses a file that changed after it was confirmed", async () => {
    const transport = new MemoryTransport();
    const code = "module.exports = { version: '0.0.1', format: async (t) => t, getSupportInfo: async () => ({ languages: [] }) };";
    transport.put(`${FOLDER}/standalone.js`, code);
    transport.put(`${FOLDER}/postcss.js`, "module.exports = {};");
    const trusted = [await sha256Hex(code), await sha256Hex("module.exports = {};")];
    // The same name, one character more: the hash is another one.
    transport.put(`${FOLDER}/postcss.js`, "module.exports = {}; ");
    const folder = await readFormatterFolder(transport, PLUGIN);
    const out = await formatWithPrettier({ transport, folder, trusted, extension: "css", text: "a{}", indent: "  ", eol: "\n" });
    expect(out.kind).toBe("untrusted");
    expect(out.kind === "untrusted" ? out.file : "").toBe("postcss.js");
  });

  it("says what is missing instead of loading half of it", async () => {
    const transport = new MemoryTransport();
    transport.put(`${FOLDER}/standalone.js`, "//");
    const folder = await readFormatterFolder(transport, PLUGIN);
    const out = await formatWithPrettier({ transport, folder, trusted: [], extension: "ts", text: "const a=1", indent: "  ", eol: "\n" });
    expect(out.kind).toBe("problem");
    expect(out.kind === "problem" ? out.problem : "").toContain("estree.js, typescript.js");
  });

  it("does not let a formatter reach for a module", async () => {
    const transport = new MemoryTransport();
    const code = "require('fs');";
    transport.put(`${FOLDER}/standalone.js`, code);
    transport.put(`${FOLDER}/postcss.js`, "//");
    const folder = await readFormatterFolder(transport, PLUGIN);
    const out = await formatWithPrettier({ transport, folder, trusted: [await sha256Hex(code), await sha256Hex("//")], extension: "css", text: "a{}", indent: "  ", eol: "\n" });
    expect(out.kind).toBe("problem");
    expect(out.kind === "problem" ? out.problem : "").toContain("may not require fs");
  });

  it("picks the parser from what the loaded files declare, not from a table", () => {
    const info = { languages: [{ extensions: [".css", ".pcss"], parsers: ["css"] }, { extensions: [".scss"], parsers: ["scss"] }] };
    expect(parserFor(info, "scss")).toBe("scss");
    expect(parserFor(info, "PCSS")).toBe("css");
    expect(parserFor(info, "rs")).toBeNull();
  });
});

describe.runIf(shipped)("the prettier build the repository ships", () => {
  it("is described by its own manifest, which is where the version lives", async () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", SHIPPED), "utf8")) as { version: string; files: Record<string, string> };
    // The folder has no version in its name on purpose, so nothing has to be
    // rewritten when prettier moves on; the version is here and in the hash list.
    expect(manifest.version).toMatch(/^\d+\.\d+\.\d+$/);
    for (const [name, hash] of Object.entries(manifest.files)) {
      expect(await sha256Hex(readFileSync(new URL(name, SHIPPED), "utf8")), `${name} does not match the manifest`).toBe(hash);
      expect(KNOWN_HASHES[hash], `${name} is shipped but the plugin would ask about it`).toContain(manifest.version);
    }
  });

  it("hashes to what the plugin's list says", async () => {
    for (const name of ["standalone.js", "postcss.js", "babel.js", "estree.js"]) {
      const text = readFileSync(new URL(name, SHIPPED), "utf8");
      expect(KNOWN_HASHES[await sha256Hex(text)], `${name} is not the build the manifest names`).toContain(name);
    }
  });

  it("formats CSS and JavaScript with the indent it is given", async () => {
    const transport = new MemoryTransport();
    for (const name of ["standalone.js", "postcss.js", "babel.js", "estree.js"]) expect(transport.install(name)).toBe(true);
    const folder = await readFormatterFolder(transport, PLUGIN);
    expect([...extensionsServed(folder.present)]).toContain("css");
    const css = await formatWithPrettier({ transport, folder, trusted: [], extension: "css", text: "a{color:red;background:blue}", indent: "  ", eol: "\n" });
    expect(css.kind === "formatted" ? css.text : css).toBe("a {\n  color: red;\n  background: blue;\n}\n");
    const js = await formatWithPrettier({ transport, folder, trusted: [], extension: "js", text: "const x={a:1};function f(){return x}", indent: "\t", eol: "\n" });
    expect(js.kind === "formatted" ? js.text : js).toBe("const x = { a: 1 };\nfunction f() {\n\treturn x;\n}\n");
    // And the version comes from the file itself, which is the other half of
    // knowing what was loaded.
    expect(js.kind === "formatted" ? js.version : "").toBe("3.9.8");
  });

  it("says so rather than throwing when the text is not that language", async () => {
    const transport = new MemoryTransport();
    for (const name of ["standalone.js", "postcss.js"]) transport.install(name);
    const folder = await readFormatterFolder(transport, PLUGIN);
    const out = await formatWithPrettier({ transport, folder, trusted: [], extension: "css", text: "{{{ not css", indent: "  ", eol: "\n" });
    expect(out.kind).toBe("problem");
  });
});

describe.runIf(shipped && existsSync(new URL("php.js", EXTRA)))("the community plugins the repository bundles itself", () => {
  /**
   * These are not prettier's own files: `scripts/build-formatter.mjs` bundles
   * each npm package into one self-contained file with esbuild. What they
   * prove here is the whole chain — the bundle loads through the same
   * `require`-less path, asks only for the engine, and formats its language.
   */
  const cases: Array<[string, string, string, string, string[]]> = [
    ["php.js", "php", "<?php function f($a){if($a){return 1;}}", "function f($a)", []],
    ["xml.js", "xml", "<a><b x='1'>t</b></a>", "<a>", []],
    ["nginx.js", "nginx", "server{listen 80;location / {proxy_pass http://x;}}", "server {", []],
    ["properties.js", "properties", "a=1\nb  =  2", "a = 1", []],
    ["ini.js", "ini", "[s]\na=1", "[s]", []],
    ["liquid.js", "liquid", "{% if a %}<p>{{ b }}</p>{% endif %}", "{% if a %}", []],
    ["gherkin.js", "feature", "Feature: a\nScenario: b\nGiven c", "Feature: a", []],
    // Svelte asks for prettier's own babel, estree and postcss by name, and
    // Jinja for its html plugin: the loader answers with the files loaded
    // beside them, and with nothing else.
    ["svelte.js", "svelte", "<script>let a=1</script>\n<p>{a}</p>", "let a = 1;", ["estree.js", "babel.js", "postcss.js"]],
    ["jinja.js", "jinja", "{% if a %}<p>{{ b }}</p>{% endif %}", "{{ b }}", ["html.js"]],
    ["sql.js", "sql", "select a,b from t where x=1", "select", []],
  ];
  it.each(cases)("%s formats its language", async (file, extension, sample, expected, alsoNeeds) => {
    const transport = new MemoryTransport();
    expect(transport.install("standalone.js")).toBe(true);
    for (const need of alsoNeeds) expect(transport.install(need)).toBe(true);
    expect(transport.install(file, EXTRA)).toBe(true);
    const folder = await readFormatterFolder(transport, PLUGIN);
    expect([...extensionsServed(folder.present)]).toContain(extension);
    const out = await formatWithPrettier({ transport, folder, trusted: [], extension, text: sample, indent: "  ", eol: "\n" });
    expect(out.kind === "formatted" ? out.text : JSON.stringify(out)).toContain(expected);
  });

  /**
   * The other half of `KNOWN_FILES`: every extension the menu offers has to
   * reach a parser in the files the table says to install. An extension that
   * does not is worse than a missing one — Format appears, runs, and fails on
   * a file the user was told it could format. Two were found this way
   * (`.jsonl`/`.ndjson` on babel, `.atom` on xml) and removed.
   *
   * This is the shipped files talking, not a list: `scripts/formatter-languages.mjs`
   * prints the same comparison with the extensions each file serves and the
   * plugin does not take.
   */
  it("offers no extension that the files it names cannot parse", async () => {
    for (const entry of KNOWN_FILES) {
      if (entry.extensions.length === 0) continue;
      const transport = new MemoryTransport();
      for (const name of [...entry.needs, entry.name]) {
        // A file only in extra/ installs from there; the loader does not care which folder it came from.
        if (!transport.install(name)) expect(transport.install(name, EXTRA), `${name} is in neither shipped folder`).toBe(true);
      }
      const folder = await readFormatterFolder(transport, PLUGIN);
      const served = extensionsServed(folder.present);
      for (const extension of entry.extensions) {
        expect(served, `${entry.name} claims .${extension} and the folder does not serve it`).toContain(extension);
        const out = await formatWithPrettier({ transport, folder, trusted: [], extension, text: "", indent: "  ", eol: "\n" });
        // An empty document is valid in every one of these languages, so the
        // only thing that can fail here is the parser lookup itself.
        expect(out.kind === "problem" ? `${entry.name} .${extension}: ${out.problem}` : out.kind, `${entry.name} .${extension}`).not.toContain("no parser");
      }
    }
  }, 60000);

  it("is listed in the folder's manifest with the package each one came from", () => {
    const manifest = JSON.parse(readFileSync(new URL("manifest.json", EXTRA), "utf8")) as { files: Record<string, { from: string; sha256: string }> };
    for (const [name, entry] of Object.entries(manifest.files)) {
      expect(entry.from, `${name} does not say which package it was built from`).toMatch(/\S+\s\d+\.\d+\.\d+/);
      expect(KNOWN_HASHES[entry.sha256], `${name} is bundled but the plugin would ask about it`).toBeTruthy();
    }
  });
});

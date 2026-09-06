import { beforeEach, describe, expect, it } from "vitest";
import { Logger } from "../src/core/log";
import { examplePaletteCss, examplePaletteFileName } from "../src/palette/example";
import { PaletteLoader, type StyleSink, scopeForFileName } from "../src/palette/loader";
import { HOST_SELECTOR, cssAttributeValue, hostSelectors, renderPalette, wrapCss } from "../src/palette/render";
import { type Transport, TransportError } from "../src/platform/transport";

/**
 * The loader against an in-memory transport: which files are read, how a
 * folder name scopes them, what reaches the <style>, and that the example is
 * written exactly once per vault. Nothing here touches the DOM.
 */

class MemoryTransport implements Transport {
  readonly kind = "desktop" as const;
  files = new Map<string, Uint8Array>();
  folders = new Set<string>();
  writes: string[] = [];
  async readBinary(p: string): Promise<Uint8Array> {
    const f = this.files.get(p);
    if (!f) throw new TransportError("not-found", `missing ${p}`, p);
    return f;
  }
  async writeBinaryAtomic(p: string, bytes: Uint8Array): Promise<void> {
    this.writes.push(p);
    this.files.set(p, bytes);
  }
  inflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  deflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  async listDir(p: string): Promise<{ files: string[]; folders: string[] }> {
    const prefix = `${p}/`;
    const known = [...this.files.keys()].some((k) => k.startsWith(prefix)) || [...this.folders].some((f) => f === p || f.startsWith(prefix));
    if (!known) throw new TransportError("list-failed", `Cannot list ${p}`, p);
    const files = new Set<string>();
    const folders = new Set<string>();
    for (const k of [...this.files.keys(), ...[...this.folders].map((f) => `${f}/`)]) {
      if (!k.startsWith(prefix)) continue;
      const rest = k.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash < 0) files.add(k);
      else if (slash > 0) folders.add(prefix + rest.slice(0, slash));
    }
    return { files: [...files].sort(), folders: [...folders].sort() };
  }
  async mkdir(p: string): Promise<void> {
    this.folders.add(p);
  }
  put(path: string, text: string): void {
    this.files.set(path, new TextEncoder().encode(text));
  }
}

class RecordingSink implements StyleSink {
  css: string | null = null;
  cleared = 0;
  set(css: string): void {
    this.css = css;
  }
  clear(): void {
    this.cleared++;
  }
}

const FOLDER = ".obsidian/plugins/native-file-editor/palettes";

let transport: MemoryTransport;
let sink: RecordingSink;
let enabled: boolean;
let log: Logger;
const logText = () => log.recent().join("\n");

function makeLoader(): PaletteLoader {
  return new PaletteLoader({
    transport,
    sink,
    log,
    folder: () => FOLDER,
    enabled: () => enabled,
  });
}

beforeEach(() => {
  transport = new MemoryTransport();
  sink = new RecordingSink();
  enabled = true;
  log = new Logger({ sink: null, timers: { setTimeout: () => 0, clearTimeout: () => undefined }, now: () => 0 });
});

describe("scopes and selectors", () => {
  it("a file name scopes by language, extension or file name, with an optional _light/_dark suffix; anything else is global", () => {
    expect(scopeForFileName("JavaScript_dark.css")).toEqual({ language: "JavaScript", variant: "dark" });
    expect(scopeForFileName("javascript_LIGHT.xml")).toEqual({ language: "JavaScript", variant: "light" });
    expect(scopeForFileName("C#.css")).toEqual({ language: "C#" });
    expect(scopeForFileName("py_dark.js")).toEqual({ extension: "py", variant: "dark" });
    expect(scopeForFileName("app.js_dark.css")).toEqual({ fileName: "app.js", variant: "dark" });
    expect(scopeForFileName("Makefile.css")).toEqual({ language: "Makefile" });
    expect(scopeForFileName("notes.txt.css")).toEqual({ fileName: "notes.txt" });
    expect(scopeForFileName("Obsidian.xml")).toEqual({});
    expect(scopeForFileName("one-dark.js")).toEqual({});
    expect(scopeForFileName("_dark.css")).toEqual({ variant: "dark" });
    // `r` is a language name (R) before it is an extension: the language wins.
    expect(scopeForFileName("r.css")).toEqual({ language: "R" });
  });

  it("host selectors carry one case-insensitive attribute per scope field, quoted safely", () => {
    expect(hostSelectors({})).toEqual([HOST_SELECTOR]);
    expect(hostSelectors({ extension: "js", language: "JavaScript" })).toEqual([
      `${HOST_SELECTOR}[data-nfe-ext="js" i]`,
      `${HOST_SELECTOR}[data-nfe-lang="JavaScript" i]`,
    ]);
    expect(hostSelectors({ language: "JavaScript", variant: "dark" })).toEqual([`.theme-dark ${HOST_SELECTOR}[data-nfe-lang="JavaScript" i]`]);
    expect(hostSelectors({ variant: "light" })).toEqual([`.theme-light ${HOST_SELECTOR}`]);
    expect(cssAttributeValue('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("renders every palette rule under every host of the scope", () => {
    const css = renderPalette({ rules: [{ selectors: [".cm-keyword", ".nfe-tok-keyword"], declarations: { color: "#f00" } }], notes: [] }, { extension: "js", fileName: "js" });
    expect(css).toBe(
      [
        `${HOST_SELECTOR}[data-nfe-ext="js" i] .cm-keyword,`,
        `${HOST_SELECTOR}[data-nfe-ext="js" i] .nfe-tok-keyword,`,
        `${HOST_SELECTOR}[data-nfe-name="js" i] .cm-keyword,`,
        `${HOST_SELECTOR}[data-nfe-name="js" i] .nfe-tok-keyword {`,
        "  color: #f00;",
        "}",
      ].join("\n")
    );
  });

  it("wraps a CSS file as the body of a nested rule on the host, under the variant's body class when the name has one", () => {
    expect(wrapCss("--code-keyword: red;\n.cm-comment { color: grey }\n", {})).toBe(`${HOST_SELECTOR} {\n--code-keyword: red;\n.cm-comment { color: grey }\n}`);
    expect(wrapCss("x", { variant: "dark" })).toBe(`.theme-dark ${HOST_SELECTOR} {\nx\n}`);
  });

  it("a scope with a variant drops a theme module's rules of the other variant", () => {
    const palette = {
      rules: [
        { selectors: [".cm-keyword"], declarations: { color: "#111" }, variant: "light" as const },
        { selectors: [".cm-keyword"], declarations: { color: "#222" }, variant: "dark" as const },
        { selectors: [".cm-comment"], declarations: { color: "#333" } },
      ],
      notes: [],
    };
    const css = renderPalette(palette, { variant: "dark" });
    expect(css).not.toContain("#111");
    expect(css).toContain(`.theme-dark ${HOST_SELECTOR} .cm-keyword {\n  color: #222;`);
    expect(css).toContain(`.theme-dark ${HOST_SELECTOR} .cm-comment`);
  });
});

describe("PaletteLoader.load", () => {
  it("a missing folder is no palettes and an empty stylesheet, not an error", async () => {
    const report = await makeLoader().load();
    expect(report.palettes).toEqual([]);
    expect(sink.css).toBe("");
    expect(logText()).toContain("0 palettes");
  });

  it("with custom palettes off, nothing is read and the sink is emptied", async () => {
    enabled = false;
    transport.put(`${FOLDER}/a.css`, ".cm-keyword { color: red }");
    const report = await makeLoader().load();
    expect(report.palettes).toEqual([]);
    expect(sink.css).toBe("");
    expect(logText()).toContain("custom palettes are off");
  });

  it("reads css, xml and js files, scoped by their names, in name order, and skips the rest", async () => {
    transport.put(`${FOLDER}/a.css`, ".cm-keyword { color: red }");
    transport.put(`${FOLDER}/theme.xml`, '<NotepadPlus><LexerStyles><LexerType name="cpp"><WordsStyle name="INSTRUCTION WORD" fgColor="93C763" fontStyle="1"/></LexerType></LexerStyles></NotepadPlus>');
    transport.put(`${FOLDER}/js_dark.js`, 'HighlightStyle.define([{ tag: t.comment, color: "#888" }])');
    transport.put(`${FOLDER}/JavaScript_light.css`, "--code-keyword: blue;");
    transport.put(`${FOLDER}/notes.md`, "# not a palette");
    transport.put(`${FOLDER}/x.txt`, "ignored quietly");
    transport.put(`${FOLDER}/types.d.ts`, "export declare const x: number;");
    transport.put(`${FOLDER}/sub/deep.css`, ".cm-keyword { color: blue }");
    transport.put(`${FOLDER}/other.xml`, "<root/>");
    transport.put(`${FOLDER}/broken.js`, "let x = 1;");
    const report = await makeLoader().load();
    expect(report.palettes.map((p) => [p.path, p.kind, p.scope])).toEqual([
      [`${FOLDER}/JavaScript_light.css`, "css", { language: "JavaScript", variant: "light" }],
      [`${FOLDER}/a.css`, "css", {}],
      [`${FOLDER}/js_dark.js`, "codemirror", { extension: "js", variant: "dark" }],
      [`${FOLDER}/theme.xml`, "notepad", {}],
    ]);
    expect(report.skipped).toEqual([
      `${FOLDER}/broken.js: not understood`,
      `${FOLDER}/other.xml: not understood`,
      `${FOLDER}/sub: folders are not read; name a file <Language>_<light|dark>.css instead`,
    ]);
    const css = sink.css ?? "";
    expect(css).toContain(`/* ${FOLDER}/a.css */\n${HOST_SELECTOR} {\n.cm-keyword { color: red }\n}`);
    expect(css).toContain(`.theme-light ${HOST_SELECTOR}[data-nfe-lang="JavaScript" i] {\n--code-keyword: blue;\n}`);
    expect(css).toContain(`${HOST_SELECTOR} .cm-keyword,\n${HOST_SELECTOR} .nfe-tok-keyword {\n  color: #93c763;\n  font-weight: bold;\n}`);
    expect(css).toContain(`.theme-dark ${HOST_SELECTOR}[data-nfe-ext="js" i] .cm-comment`);
    expect(logText()).toContain("4 palettes");
  });

  it("a file that cannot be read is logged and skipped; the others still load", async () => {
    transport.put(`${FOLDER}/ok.css`, ".cm-keyword { color: red }");
    transport.put(`${FOLDER}/bad.css`, "x");
    transport.readBinary = async (p: string) => {
      if (p.endsWith("bad.css")) throw new TransportError("read-failed", "boom", p);
      return new TextEncoder().encode(".cm-keyword { color: red }");
    };
    const report = await makeLoader().load();
    expect(report.palettes.map((p) => p.path)).toEqual([`${FOLDER}/ok.css`]);
    expect(report.skipped).toEqual([`${FOLDER}/bad.css: read failed`]);
    expect(logText()).toContain("bad.css could not be read");
  });

  it("strips a UTF-8 BOM", async () => {
    transport.files.set(`${FOLDER}/bom.css`, new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode(".cm-keyword { color: red }")]));
    await makeLoader().load();
    expect(sink.css).toContain(`${HOST_SELECTOR} {\n.cm-keyword { color: red }\n}`);
  });

  it("reloads only for a save inside the folder", async () => {
    const loader = makeLoader();
    expect(await loader.reloadIfInside("notes/a.css")).toBe(false);
    expect(sink.css).toBeNull();
    transport.put(`${FOLDER}/a.css`, ".cm-keyword { color: red }");
    expect(await loader.reloadIfInside(`${FOLDER}/a.css`)).toBe(true);
    expect(sink.css).toContain("color: red");
  });
});

describe("PaletteLoader.writeExample", () => {
  const colours = {
    light: { "--code-keyword": "#d73a49", "--code-string": "#032f62", "--background-primary": "#ffffff", "--text-normal": "#222222", "--text-faint": "#999999", "--background-modifier-hover": "#eeeeee", "--text-selection": "#bbdfff" },
    dark: { "--code-keyword": "#ff7b72", "--code-background": "#0d1117", "--code-normal": "#c9d1d9" },
  };

  it("writes <Language>_light.css and <Language>_dark.css from the theme's colours, creating the folder", async () => {
    const loader = makeLoader();
    const written = await loader.writeExample("JavaScript", colours);
    expect(written).toEqual([`${FOLDER}/JavaScript_light.css`, `${FOLDER}/JavaScript_dark.css`]);
    expect(transport.folders.has(FOLDER)).toBe(true);
    const light = new TextDecoder().decode(transport.files.get(written[0] ?? ""));
    expect(light).toContain("--code-keyword: #d73a49;");
    expect(light).toContain("--code-string: #032f62;");
    expect(light).toContain("/* --code-comment: (the theme sets none) */");
    expect(light).toContain(".cm-editor {\n  background-color: #ffffff;\n  color: #222222;\n}");
    expect(light).toContain(".cm-activeLine, .cm-activeLineGutter { background-color: #eeeeee; }");
    const dark = new TextDecoder().decode(transport.files.get(written[1] ?? ""));
    expect(dark).toContain("--code-keyword: #ff7b72;");
    expect(dark).toContain("background-color: #0d1117;");
    expect(dark).toContain("color: #c9d1d9;");
    // The files load back scoped to the language and its variant.
    await loader.load();
    expect(sink.css).toContain(`.theme-light ${HOST_SELECTOR}[data-nfe-lang="JavaScript" i] {`);
    expect(sink.css).toContain(`.theme-dark ${HOST_SELECTOR}[data-nfe-lang="JavaScript" i] {`);
    expect(logText()).toContain("wrote example palettes for JavaScript: JavaScript_light.css, JavaScript_dark.css");
  });

  it("the file name is safe for a language like C/C++", () => {
    expect(examplePaletteFileName("C/C++", "dark")).toBe("C-C++_dark.css");
    expect(examplePaletteCss("X", "light", {})).toContain("(the theme sets none)");
  });

  it("writing again replaces the files", async () => {
    const loader = makeLoader();
    await loader.writeExample("Python", colours);
    await loader.writeExample("Python", { light: { "--code-keyword": "#000001" }, dark: {} });
    expect(transport.writes.filter((w) => w.endsWith("Python_light.css"))).toHaveLength(2);
    expect(new TextDecoder().decode(transport.files.get(`${FOLDER}/Python_light.css`))).toContain("--code-keyword: #000001;");
  });
});

import type { Logger } from "../core/log";
import { languageFor, languageNamed } from "../highlight/registry";
import type { Transport } from "../platform/transport";
import { parseCodeMirrorTheme } from "./codemirrorTheme";
import { examplePaletteCss, examplePaletteFileName } from "./example";
import type { ThemeVariant } from "./model";
import { isNotepadTheme, parseNotepadTheme } from "./notepadTheme";
import { type PaletteScope, renderPalette, wrapCss } from "./render";

/**
 * Where the generated CSS goes. The DOM implementation (ui/styleSink.ts) is a
 * `<style>` element in the document head; a test hands in a recorder.
 */
export interface StyleSink {
  set(css: string): void;
  clear(): void;
}

export interface PaletteLoaderDeps {
  readonly transport: Transport;
  readonly sink: StyleSink;
  readonly log: Logger;
  /** The palette folder, vault-relative, no trailing slash. */
  readonly folder: () => string;
  /** Whether custom palettes are turned on; off means the sink is cleared and nothing is read. */
  readonly enabled: () => boolean;
}

export interface LoadedPalette {
  readonly path: string;
  readonly kind: "css" | "notepad" | "codemirror";
  readonly scope: PaletteScope;
  readonly rules: number;
  readonly notes: readonly string[];
}

export interface LoadReport {
  readonly folder: string;
  readonly palettes: readonly LoadedPalette[];
  readonly skipped: readonly string[];
  readonly css: string;
}

const CSS_EXT = /\.css$/i;
const XML_EXT = /\.xml$/i;
const SCRIPT_EXT = /\.(m?js|cjs|m?ts|cts|jsx|tsx)$/i;
const DECLARATION_EXT = /\.d\.[mc]?ts$/i;

function baseName(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? path : path.slice(slash + 1);
}

/**
 * What a palette file's NAME scopes it to. `<Scope>_<light|dark>.<ext>` or
 * `<Scope>.<ext>`: the scope is a language name as shown in the head bar
 * (`JavaScript_dark.css`), a registered extension (`py_light.xml`) or a file
 * name with its own extension (`app.js_dark.css`, `Makefile.css`); the variant
 * suffix limits the file to Obsidian's light or dark theme. A name that is
 * none of these (`Obsidian.xml`, `one-dark.js`) applies to every file.
 */
export function scopeForFileName(fileName: string): PaletteScope {
  const stem = fileName.replace(/\.[^.]+$/, "");
  const m = stem.match(/^(.*)_(light|dark)$/i);
  const base = m ? (m[1] ?? "") : stem;
  const variant = m ? ((m[2] ?? "").toLowerCase() as ThemeVariant) : undefined;
  const scope: { language?: string; extension?: string; fileName?: string; variant?: ThemeVariant } = {};
  if (variant) scope.variant = variant;
  if (base.length === 0) return scope;
  const lang = languageNamed(base);
  if (lang !== null) scope.language = lang.name;
  else if (languageFor(base) !== null) scope.extension = base.toLowerCase();
  else if (base.includes(".")) scope.fileName = base;
  return scope;
}

/** UTF-8 with an optional BOM; a palette file in any other encoding is the user's to convert. */
function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^\uFEFF/, "");
}

export class PaletteLoader {
  private readonly deps: PaletteLoaderDeps;
  private lastReport: LoadReport | null = null;

  constructor(deps: PaletteLoaderDeps) {
    this.deps = deps;
  }

  get report(): LoadReport | null {
    return this.lastReport;
  }

  /**
   * Read the folder, convert every file it understands, and hand the result to
   * the sink as one stylesheet. Nothing here throws: a missing folder is an
   * empty palette set, and a file that cannot be read or understood is logged
   * and skipped. With custom palettes off, the sink is cleared instead.
   */
  async load(): Promise<LoadReport> {
    const folder = this.deps.folder();
    const log = this.deps.log;
    const palettes: LoadedPalette[] = [];
    const skipped: string[] = [];
    const chunks: string[] = [];

    if (!this.deps.enabled()) {
      this.deps.sink.set("");
      const report: LoadReport = { folder, palettes, skipped, css: "" };
      this.lastReport = report;
      log.info("palette", "custom palettes are off; none applied");
      return report;
    }

    const entries = await this.listOrEmpty(folder);
    for (const path of entries.files) {
      const name = baseName(path);
      const kind = this.kindOf(name);
      if (kind === null) {
        // Files that belong next to a theme (its readme, licence, typings) are passed over quietly.
        if (!/^\./.test(name) && !/\.(md|txt|json|license)$/i.test(name) && !DECLARATION_EXT.test(name) && name.toUpperCase() !== "LICENSE") skipped.push(`${path}: not a palette file`);
        continue;
      }
      const scope = scopeForFileName(name);
      let text: string;
      try {
        text = decode(await this.deps.transport.readBinary(path));
      } catch (e) {
        log.error("palette", `${path} could not be read`, e);
        skipped.push(`${path}: read failed`);
        continue;
      }
      try {
        const result = this.convert(kind, text, scope);
        if (result === null) {
          skipped.push(`${path}: not understood`);
          continue;
        }
        chunks.push(`/* ${path} */\n${result.css}`);
        palettes.push({ path, kind, scope, rules: result.rules, notes: result.notes });
        if (result.notes.length > 0) log.debug("palette", `${path}: ${result.notes.join("; ")}`);
      } catch (e) {
        log.error("palette", `${path} could not be converted`, e);
        skipped.push(`${path}: conversion failed`);
      }
    }
    for (const sub of entries.folders) skipped.push(`${sub}: folders are not read; name a file <Language>_<light|dark>.css instead`);

    const css = chunks.join("\n\n");
    this.deps.sink.set(css);
    const report: LoadReport = { folder, palettes, skipped, css };
    this.lastReport = report;
    log.info(
      "palette",
      `${folder}: ${palettes.length} palette${palettes.length === 1 ? "" : "s"}${palettes.length > 0 ? ` (${palettes.map((p) => `${p.path.slice(folder.length + 1)} ${p.kind} ${p.rules}${describeScope(p.scope)}`).join(", ")})` : ""}${skipped.length > 0 ? `; skipped ${skipped.join(", ")}` : ""}`
    );
    return report;
  }

  /** A save inside the palette folder reloads it; anything else is ignored. */
  async reloadIfInside(path: string): Promise<boolean> {
    const folder = this.deps.folder();
    if (!path.startsWith(`${folder}/`)) return false;
    await this.load();
    return true;
  }

  /**
   * Write the example palettes for one language: `<Language>_light.css` and
   * `<Language>_dark.css`, each made of the colours the theme uses for that
   * variant (the caller reads them from the document). Existing files of those
   * names are replaced; the folder is created. Returns the vault paths written.
   */
  async writeExample(language: string, colours: Readonly<Record<ThemeVariant, Readonly<Record<string, string>>>>): Promise<string[]> {
    const folder = this.deps.folder();
    await this.deps.transport.mkdir(folder);
    const written: string[] = [];
    for (const variant of ["light", "dark"] as const) {
      const path = `${folder}/${examplePaletteFileName(language, variant)}`;
      await this.deps.transport.writeBinaryAtomic(path, new TextEncoder().encode(examplePaletteCss(language, variant, colours[variant])));
      written.push(path);
    }
    this.deps.log.info("palette", `wrote example palettes for ${language}: ${written.map((p) => p.slice(folder.length + 1)).join(", ")}`);
    return written;
  }

  private kindOf(name: string): LoadedPalette["kind"] | null {
    if (CSS_EXT.test(name)) return "css";
    if (XML_EXT.test(name)) return "notepad";
    if (SCRIPT_EXT.test(name) && !DECLARATION_EXT.test(name)) return "codemirror";
    return null;
  }

  private convert(kind: LoadedPalette["kind"], text: string, scope: PaletteScope): { css: string; rules: number; notes: string[] } | null {
    if (kind === "css") return { css: wrapCss(text, scope), rules: 1, notes: [] };
    if (kind === "notepad") {
      if (!isNotepadTheme(text)) return null;
      const palette = parseNotepadTheme(text);
      return { css: renderPalette(palette, scope), rules: palette.rules.length, notes: [...palette.notes] };
    }
    const palette = parseCodeMirrorTheme(text);
    if (palette.rules.length === 0) return null;
    return { css: renderPalette(palette, scope), rules: palette.rules.length, notes: [...palette.notes] };
  }

  private async listOrEmpty(folder: string): Promise<{ files: string[]; folders: string[] }> {
    try {
      return await this.deps.transport.listDir(folder);
    } catch {
      return { files: [], folders: [] };
    }
  }
}

function describeScope(scope: PaletteScope): string {
  const parts: string[] = [];
  if (scope.extension) parts.push(`.${scope.extension}`);
  if (scope.language) parts.push(scope.language);
  if (scope.fileName) parts.push(scope.fileName);
  if (scope.variant) parts.push(scope.variant);
  return parts.length > 0 ? ` for ${parts.join("/")}` : "";
}

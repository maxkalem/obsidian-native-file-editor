import type { Logger } from "../core/log";
import type { Transport } from "../platform/transport";
import { FORMATTER_FOLDER, KNOWN_FILES, KNOWN_HASHES, filesForExtension, knownFile } from "./prettierFiles";

/**
 * The formatter the user installed: prettier's own files, copied by hand into
 * `<plugin folder>/formatters/`, read and evaluated when Format is pressed
 * and dropped again afterwards (ADR-005).
 *
 * The rules that make this safe enough are all here and nowhere else:
 *
 * - only the file names this plugin knows, only in that one folder, whose
 *   path no setting can move;
 * - the file is read into a string, THAT string is hashed, the hash is
 *   compared, and the SAME string is evaluated — so nothing can change
 *   between the check and the use;
 * - a hash in neither the shipped manifest nor the user's confirmed list is
 *   not executed at all; the caller asks the user, and a confirmation is a
 *   hash, so a later silent change is refused again;
 * - nothing is downloaded, ever (Obsidian's developer policies forbid a
 *   plugin to install or update its dependencies).
 *
 * The evaluation is the shape Obsidian itself uses for every plugin's
 * `main.js`, which is how this works on the phone as well as on the desktop.
 */

export const PRETTIER_ENGINE = "standalone.js";

/** What a prettier build exposes; checked at run time, because a file is not trusted for its name. */
interface PrettierApi {
  readonly version?: unknown;
  format?: (source: string, options: Record<string, unknown>) => Promise<string>;
  getSupportInfo?: (options: Record<string, unknown>) => Promise<{ languages?: Array<{ name?: string; extensions?: string[]; parsers?: string[] }> }>;
}

export interface FormatterFolder {
  readonly path: string;
  /** The known files that are there, by name. */
  readonly present: ReadonlySet<string>;
  /** Files in the folder this plugin does not know; named in the log, never loaded. */
  readonly strangers: readonly string[];
}

export function formatterFolderPath(pluginFolder: string): string {
  return `${pluginFolder}/${FORMATTER_FOLDER}`;
}

/** What is in the folder, by name only: the menu needs this, and it reads no code. */
export async function readFormatterFolder(transport: Transport, pluginFolder: string): Promise<FormatterFolder> {
  const path = formatterFolderPath(pluginFolder);
  const present = new Set<string>();
  const strangers: string[] = [];
  try {
    const { files } = await transport.listDir(path);
    for (const file of files) {
      const name = file.slice(file.lastIndexOf("/") + 1);
      if (knownFile(name)) present.add(name);
      else strangers.push(name);
    }
  } catch {
    // No folder is the normal case: nobody has to install anything.
  }
  return { path, present, strangers };
}

/** Which extensions this folder can format right now, for the menu's greyed reason. */
export function extensionsServed(present: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  if (!present.has(PRETTIER_ENGINE)) return out;
  for (const file of KNOWN_FILES) {
    if (!present.has(file.name)) continue;
    if (file.needs.some((need) => !present.has(need))) continue;
    for (const extension of file.extensions) out.add(extension);
  }
  return out;
}

/**
 * Where a failure came from, because the two want opposite answers. `install`
 * is about the FOLDER — a file that is not there, will not read, is not a
 * prettier build, asks for a module, or serves another language than its name
 * promises; the user is shown which file to copy and where. `text` is about
 * the FILE IN THE EDITOR — prettier parsed it and refused; that is the user's
 * own syntax error and belongs in a notice, not in a dialog about installing.
 */
export type ProblemStage = "install" | "text";

export type PrettierOutcome =
  | { readonly kind: "formatted"; readonly text: string; readonly version: string }
  | { readonly kind: "unchanged"; readonly version: string }
  /** A file whose hash nobody has approved: nothing was executed, and the caller asks. */
  | { readonly kind: "untrusted"; readonly file: string; readonly hash: string }
  | { readonly kind: "problem"; readonly problem: string; readonly stage: ProblemStage };

export interface PrettierRequest {
  readonly transport: Transport;
  readonly folder: FormatterFolder;
  /** The hashes the user has confirmed before (from data.json). */
  readonly trusted: readonly string[];
  readonly extension: string;
  readonly text: string;
  /** The indent Format decided on: the file's own, or the editor's setting. */
  readonly indent: string;
  readonly eol: "\n" | "\r\n";
  readonly log?: Logger;
}

export async function formatWithPrettier(request: PrettierRequest): Promise<PrettierOutcome> {
  const { transport, folder, trusted, extension, text, indent, eol, log } = request;
  const plan = filesForExtension(extension, folder.present);
  if (plan === null) return { kind: "problem", problem: `no prettier plugin serves .${extension}`, stage: "install" };
  if (plan.missing.length > 0) return { kind: "problem", problem: `missing in ${folder.path}: ${plan.missing.join(", ")}`, stage: "install" };

  const started = Date.now();
  const modules = new Map<string, unknown>();
  const hashes = new Map<string, string>();
  for (const name of plan.files) {
    // A plugin file may ask for the engine that is already loaded, and for
    // nothing else: prettier's plugins import `prettier/doc` for its printer
    // primitives, and `@prettier/plugin-xml` and the INI plugin do not work
    // without it (measured 2026-09-19). Everything else throws.
    const engine = modules.get(PRETTIER_ENGINE) as { doc?: unknown } | undefined;
    const allowed = new Map<string, unknown>();
    if (engine) {
      allowed.set("prettier", engine);
      allowed.set("prettier/standalone", engine);
      if (engine.doc !== undefined) allowed.set("prettier/doc", engine.doc);
    }
    // A plugin may also lean on another plugin FILE that is already loaded —
    // Svelte wants babel, estree and postcss, Jinja wants html — and asks for
    // it as `prettier/plugins/<name>`. Only files loaded for this very call
    // answer; the rest still throws.
    for (const [loadedName, loaded] of modules) {
      if (loadedName === PRETTIER_ENGINE) continue;
      allowed.set(`prettier/plugins/${loadedName.replace(/\.js$/, "")}`, loaded);
    }
    const loaded = await loadModule(transport, `${folder.path}/${name}`, trusted, name, allowed);
    if ("untrusted" in loaded) return { kind: "untrusted", file: name, hash: loaded.untrusted };
    if ("problem" in loaded) return { kind: "problem", problem: `${name}: ${loaded.problem}`, stage: "install" };
    modules.set(name, loaded.exports);
    hashes.set(name, loaded.hash);
  }
  const prettier = modules.get(PRETTIER_ENGINE) as PrettierApi | undefined;
  if (!prettier || typeof prettier.format !== "function" || typeof prettier.getSupportInfo !== "function") {
    return { kind: "problem", problem: `${PRETTIER_ENGINE} is not a prettier build (no format())`, stage: "install" };
  }
  const version = typeof prettier.version === "string" ? prettier.version : "unknown version";
  const plugins = plan.files.filter((name) => name !== PRETTIER_ENGINE).map((name) => modules.get(name));
  // Asking the loaded files what they serve is still about the FOLDER: a file
  // that throws here, or that turns out to serve another language than its
  // name promised, is an installation to fix, not a text to correct.
  let parser: string | null;
  try {
    parser = parserFor(await prettier.getSupportInfo({ plugins }), extension);
  } catch (e) {
    return { kind: "problem", problem: `getSupportInfo() failed: ${e instanceof Error ? e.message : String(e)}`, stage: "install" };
  }
  if (parser === null) return { kind: "problem", problem: `prettier ${version} has no parser for .${extension}`, stage: "install" };
  try {
    const out = await prettier.format(text, {
      parser,
      plugins,
      tabWidth: indent === "\t" ? 4 : indent.length,
      useTabs: indent === "\t",
      endOfLine: eol === "\r\n" ? "crlf" : "lf",
    });
    const known = plan.files.every((name) => KNOWN_HASHES[hashes.get(name) ?? ""] !== undefined);
    log?.info(
      "formatter",
      `prettier ${version}${known ? "" : " (a build you confirmed, not one this plugin ships)"}: .${extension} through ${parser}, ${plan.files.length} file(s), ${Date.now() - started} ms`
    );
    return out === text ? { kind: "unchanged", version } : { kind: "formatted", text: out, version };
  } catch (e) {
    // prettier read the text and refused it: the file in the editor is what is
    // wrong, so this is a notice with the line in it, not a dialog about files.
    return { kind: "problem", problem: e instanceof Error ? e.message : String(e), stage: "text" };
  }
  // Nothing is kept: `modules` and everything in it go out of scope here, and
  // the next Format reads the files again. That is the user's rule.
}

/**
 * The parser for this extension, asked of the loaded files rather than of a
 * table: every prettier plugin declares the languages and extensions it
 * serves, exactly as this plugin's own language definitions do.
 */
export function parserFor(info: { languages?: Array<{ extensions?: string[]; parsers?: string[] }> }, extension: string): string | null {
  const wanted = `.${extension.toLowerCase()}`;
  for (const language of info.languages ?? []) {
    if (!(language.extensions ?? []).some((e) => e.toLowerCase() === wanted)) continue;
    const parser = (language.parsers ?? [])[0];
    if (typeof parser === "string" && parser.length > 0) return parser;
  }
  return null;
}

type LoadOutcome = { exports: unknown; hash: string } | { untrusted: string } | { problem: string };

async function loadModule(transport: Transport, path: string, trusted: readonly string[], name: string, allowed: ReadonlyMap<string, unknown> = new Map()): Promise<LoadOutcome> {
  let code: string;
  try {
    code = new TextDecoder("utf-8").decode(await transport.readBinary(path));
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
  const hash = await sha256Hex(code);
  if (KNOWN_HASHES[hash] === undefined && !trusted.includes(hash)) return { untrusted: hash };
  try {
    const module: { exports: unknown } = { exports: {} };
    // The same shape Obsidian uses to load a plugin's own main.js. A
    // formatter needs no modules of its own; asking for one is an error
    // rather than a door into Node.
    const run = new Function("require", "module", "exports", `${code}\n//# sourceURL=nfe-formatter:${name}\n`) as (
      require: (id: string) => never,
      module: { exports: unknown },
      exports: unknown
    ) => void;
    run(
      (id: string) => {
        const given = allowed.get(id);
        if (given !== undefined) return given as never;
        throw new Error(`a formatter may not require ${id}`);
      },
      module,
      module.exports
    );
    return { exports: interop(module.exports), hash };
  } catch (e) {
    return { problem: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * What a bundled plugin really exports. A file built from an ES module comes
 * out as `{ __esModule: true, default: <the plugin>, …named }`, and prettier
 * wants the plugin itself: `@prettier/plugin-xml` and the INI plugin declare
 * their languages only on the default export, so without this they format
 * nothing (measured 2026-09-19). Prettier's own UMD files are untouched.
 */
function interop(exports: unknown): unknown {
  if (typeof exports !== "object" || exports === null) return exports;
  const record = exports as { __esModule?: unknown; default?: unknown; languages?: unknown; parsers?: unknown; printers?: unknown };
  if (record.__esModule !== true || record.default === undefined) return exports;
  const inner = record.default as { languages?: unknown; parsers?: unknown; printers?: unknown } | null;
  if (typeof inner !== "object" || inner === null) return exports;
  // Only when the default really is the plugin: it declares one of the three
  // things prettier asks a plugin for.
  return inner.languages !== undefined || inner.parsers !== undefined || inner.printers !== undefined ? inner : exports;
}

/** SHA-256 of the very text that will be evaluated, in hexadecimal. */
export async function sha256Hex(text: string): Promise<string> {
  const subtle = (globalThis as { crypto?: { subtle?: SubtleCrypto } }).crypto?.subtle;
  if (!subtle) throw new Error("this platform has no SubtleCrypto, so a formatter cannot be checked");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

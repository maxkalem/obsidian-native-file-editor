import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { go } from "@codemirror/lang-go";
import { html } from "@codemirror/lang-html";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { php } from "@codemirror/lang-php";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { MSSQL, MySQL, PLSQL, PostgreSQL, SQLite, sql } from "@codemirror/lang-sql";
import { xml } from "@codemirror/lang-xml";
import { yaml } from "@codemirror/lang-yaml";
import { astro } from "@fazelstudio/codemirror-lang-astro";
import { prisma } from "@fazelstudio/codemirror-lang-prisma";
import { nix } from "@replit/codemirror-lang-nix";
import { parser as solidityParser } from "@replit/codemirror-lang-solidity";
import { svelte } from "@replit/codemirror-lang-svelte";
import { elixir } from "codemirror-lang-elixir";
import { hcl } from "codemirror-lang-hcl";
import { graphqlMode } from "./graphqlMode";
import { type KeywordLanguage, keywordMode } from "./keywordMode";
import { NPP_LANGUAGES } from "./langs.generated";
import { type Language, LanguageSupport, StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { apl } from "@codemirror/legacy-modes/mode/apl";
import { asn1 } from "@codemirror/legacy-modes/mode/asn1";
import { asciiArmor } from "@codemirror/legacy-modes/mode/asciiarmor";
import { brainfuck } from "@codemirror/legacy-modes/mode/brainfuck";
import { ceylon, csharp, dart, kotlin, nesC, objectiveC, objectiveCpp, scala, shader, squirrel } from "@codemirror/legacy-modes/mode/clike";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { cmake } from "@codemirror/legacy-modes/mode/cmake";
import { cobol } from "@codemirror/legacy-modes/mode/cobol";
import { coffeeScript } from "@codemirror/legacy-modes/mode/coffeescript";
import { commonLisp } from "@codemirror/legacy-modes/mode/commonlisp";
import { crystal } from "@codemirror/legacy-modes/mode/crystal";
import { gss, less, sCSS } from "@codemirror/legacy-modes/mode/css";
import { cypher } from "@codemirror/legacy-modes/mode/cypher";
import { d } from "@codemirror/legacy-modes/mode/d";
import { diff } from "@codemirror/legacy-modes/mode/diff";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
import { dtd } from "@codemirror/legacy-modes/mode/dtd";
import { dylan } from "@codemirror/legacy-modes/mode/dylan";
import { ebnf } from "@codemirror/legacy-modes/mode/ebnf";
import { ecl } from "@codemirror/legacy-modes/mode/ecl";
import { eiffel } from "@codemirror/legacy-modes/mode/eiffel";
import { elm } from "@codemirror/legacy-modes/mode/elm";
import { erlang } from "@codemirror/legacy-modes/mode/erlang";
import { factor } from "@codemirror/legacy-modes/mode/factor";
import { fcl } from "@codemirror/legacy-modes/mode/fcl";
import { forth } from "@codemirror/legacy-modes/mode/forth";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { gas } from "@codemirror/legacy-modes/mode/gas";
import { gherkin } from "@codemirror/legacy-modes/mode/gherkin";
import { groovy } from "@codemirror/legacy-modes/mode/groovy";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { haxe, hxml } from "@codemirror/legacy-modes/mode/haxe";
import { http } from "@codemirror/legacy-modes/mode/http";
import { jinja2 } from "@codemirror/legacy-modes/mode/jinja2";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { liveScript } from "@codemirror/legacy-modes/mode/livescript";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { mathematica } from "@codemirror/legacy-modes/mode/mathematica";
import { mbox } from "@codemirror/legacy-modes/mode/mbox";
import { mirc } from "@codemirror/legacy-modes/mode/mirc";
import { fSharp, oCaml, sml } from "@codemirror/legacy-modes/mode/mllike";
import { modelica } from "@codemirror/legacy-modes/mode/modelica";
import { mscgen, msgenny, xu } from "@codemirror/legacy-modes/mode/mscgen";
import { nginx } from "@codemirror/legacy-modes/mode/nginx";
import { nsis } from "@codemirror/legacy-modes/mode/nsis";
import { ntriples } from "@codemirror/legacy-modes/mode/ntriples";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { oz } from "@codemirror/legacy-modes/mode/oz";
import { pascal } from "@codemirror/legacy-modes/mode/pascal";
import { pegjs } from "@codemirror/legacy-modes/mode/pegjs";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { pig } from "@codemirror/legacy-modes/mode/pig";
import { powerShell } from "@codemirror/legacy-modes/mode/powershell";
import { properties } from "@codemirror/legacy-modes/mode/properties";
import { protobuf } from "@codemirror/legacy-modes/mode/protobuf";
import { pug } from "@codemirror/legacy-modes/mode/pug";
import { puppet } from "@codemirror/legacy-modes/mode/puppet";
import { cython } from "@codemirror/legacy-modes/mode/python";
import { q } from "@codemirror/legacy-modes/mode/q";
import { r } from "@codemirror/legacy-modes/mode/r";
import { rpmSpec } from "@codemirror/legacy-modes/mode/rpm";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { sas } from "@codemirror/legacy-modes/mode/sas";
import { sass } from "@codemirror/legacy-modes/mode/sass";
import { scheme } from "@codemirror/legacy-modes/mode/scheme";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { sieve } from "@codemirror/legacy-modes/mode/sieve";
import { smalltalk } from "@codemirror/legacy-modes/mode/smalltalk";
import { sparql } from "@codemirror/legacy-modes/mode/sparql";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { stylus } from "@codemirror/legacy-modes/mode/stylus";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { tcl } from "@codemirror/legacy-modes/mode/tcl";
import { textile } from "@codemirror/legacy-modes/mode/textile";
import { tiddlyWiki } from "@codemirror/legacy-modes/mode/tiddlywiki";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { troff } from "@codemirror/legacy-modes/mode/troff";
import { ttcn } from "@codemirror/legacy-modes/mode/ttcn";
import { turtle } from "@codemirror/legacy-modes/mode/turtle";
import { vb } from "@codemirror/legacy-modes/mode/vb";
import { vbScript, vbScriptASP } from "@codemirror/legacy-modes/mode/vbscript";
import { velocity } from "@codemirror/legacy-modes/mode/velocity";
import { tlv, verilog } from "@codemirror/legacy-modes/mode/verilog";
import { vhdl } from "@codemirror/legacy-modes/mode/vhdl";
import { wast } from "@codemirror/legacy-modes/mode/wast";
import { webIDL } from "@codemirror/legacy-modes/mode/webidl";
import { xQuery } from "@codemirror/legacy-modes/mode/xquery";
import { yacas } from "@codemirror/legacy-modes/mode/yacas";
import { z80 } from "@codemirror/legacy-modes/mode/z80";
import { logMode } from "./logMode";
import { adaptStreamParser } from "./obsidianFork";

/**
 * The language registry: extension -> language entry. This module is the only
 * place any extension or language name appears; everything else asks it.
 *
 * Tiers, from the handoff's inventory: tier 1 is the official lezer packages
 * (the fourteen the user confirmed), tier 2 is `@codemirror/legacy-modes`
 * where tier 1 has nothing. Where both offer a language, tier 1 is listed and
 * the legacy mode is not. Tier 3 is the confirmed set of community packages,
 * each bundled after its licence and size were checked (THIRD_PARTY_NOTICES).
 * Tier 4 (the keyword tables and the vault definitions folder) is still to
 * come; until then an extension outside this list is not registered at all.
 *
 * Every grammar module here is evaluated when Obsidian loads main.js, whatever
 * `load` does (ADR-001): the function exists so the Language object, which is
 * the part that holds parse state, is built and cached only when a file of
 * that type is actually opened.
 */

/**
 * `builtin` is a stream mode of this plugin's own (including the Notepad++
 * tables); `legacy` comes from `@codemirror/legacy-modes`; `vault` is a JSON
 * definition from the vault's language folder, registered at load.
 */
export type LanguageSource = "lezer" | "legacy" | "builtin" | "vault" | null;

export interface LanguageEntry {
  /** Human-readable name shown in the head bar. */
  readonly name: string;
  /** Lower-case extensions without the dot, in registration order. */
  readonly extensions: readonly string[];
  readonly source: LanguageSource;
  /** Null for plain text; otherwise builds the language on first use. */
  readonly load: (() => LanguageSupport | Language) | null;
}

export interface ResolvedLanguage {
  readonly entry: LanguageEntry;
  readonly language: Language;
  /** What the editor attaches: the language plus its support extensions. */
  readonly support: Extension;
}

function lezer(name: string, extensions: string[], load: () => LanguageSupport): LanguageEntry {
  return { name, extensions, source: "lezer", load };
}

// Stream parsers go through `adaptStreamParser`: on Obsidian's fork of
// @codemirror/language the mode's token strings become the CM5 class names its
// decorator and stylesheet know; elsewhere the parser is returned unchanged.
function legacy(name: string, extensions: string[], parser: StreamParser<unknown>): LanguageEntry {
  return { name, extensions, source: "legacy", load: () => StreamLanguage.define(adaptStreamParser(parser)) };
}

function builtin(name: string, extensions: string[], parser: StreamParser<unknown>): LanguageEntry {
  return { name, extensions, source: "builtin", load: () => StreamLanguage.define(adaptStreamParser(parser)) };
}

function plain(name: string, extensions: string[]): LanguageEntry {
  return { name, extensions, source: null, load: null };
}

const ENTRIES: readonly LanguageEntry[] = [
  // Plain text.
  plain("Plain text", ["txt", "text"]),
  builtin("Log", ["log", "out", "err"], logMode as StreamParser<unknown>),

  // Tier 1: official lezer packages.
  lezer("JavaScript", ["js", "mjs", "cjs", "jsx", "es6", "jsm"], () => javascript({ jsx: true })),
  lezer("TypeScript", ["ts", "mts", "cts"], () => javascript({ typescript: true })),
  lezer("TSX", ["tsx"], () => javascript({ typescript: true, jsx: true })),
  lezer("Python", ["py", "pyw", "pyi"], () => python()),
  lezer("HTML", ["html", "htm", "xhtml", "shtml", "shtm", "xht", "hta", "jsp"], () => html()),
  lezer("CSS", ["css"], () => css()),
  lezer("JSON", ["json", "jsonc", "json5", "jsonld", "geojson", "webmanifest", "har"], () => json()),
  lezer("XML", ["xml", "xsl", "xslt", "xsd", "plist", "csproj", "vbproj", "fsproj", "props", "targets", "xaml", "rss", "atom", "wsdl", "xliff", "xlf", "resx", "nuspec", "opml", "xul", "kml", "mxml", "xsml", "xbl", "sxbl", "sitemap", "gml", "gpx", "vcproj", "vcxproj", "csxproj", "dbproj"], () => xml()),
  lezer("YAML", ["yaml", "yml"], () => yaml()),
  lezer("SQL", ["sql", "ddl", "dml"], () => sql()),
  lezer("PostgreSQL", ["pgsql", "psql"], () => sql({ dialect: PostgreSQL })),
  lezer("MySQL", ["mysql"], () => sql({ dialect: MySQL })),
  lezer("SQLite", ["sqlite"], () => sql({ dialect: SQLite })),
  lezer("T-SQL", ["tsql"], () => sql({ dialect: MSSQL })),
  lezer("PL/SQL", ["plsql", "pks", "pkb"], () => sql({ dialect: PLSQL })),
  lezer("Markdown", ["mdx", "mkd", "markdown", "mdown"], () => markdown()),
  lezer("Rust", ["rs"], () => rust()),
  lezer("Go", ["go"], () => go()),
  lezer("Java", ["java"], () => java()),
  lezer("PHP", ["php", "phtml", "php3", "php4", "php5", "phps", "phpt"], () => php()),
  lezer("C/C++", ["c", "h", "cpp", "cc", "cxx", "c++", "hpp", "hh", "hxx", "h++", "ino", "cu", "cuh", "lex"], () => cpp()),

  // Tier 3: community lezer packages, one decision each (handoff §17; sizes
  // and licences in THIRD_PARTY_NOTICES.md). Only what tiers 1 and 2 lack.
  lezer("Svelte", ["svelte"], () => svelte()),
  lezer("Astro", ["astro"], () => astro()),
  lezer("Elixir", ["ex", "exs"], () => elixir()),
  lezer("HCL", ["hcl", "tf", "tfvars", "nomad"], () => hcl()),
  lezer("Nix", ["nix"], () => nix()),
  lezer("Prisma", ["prisma"], () => prisma()),
  // Solidity's package is a stream parser; it goes through the same fork adapter as tier 2.
  legacy("Solidity", ["sol"], solidityParser as StreamParser<unknown>),
  // GraphQL: this plugin's own keyword mode (cm6-graphql would bring the graphql package).
  builtin("GraphQL", ["graphql", "gql", "graphqls"], graphqlMode as StreamParser<unknown>),

  // Tier 2: legacy stream modes where tier 1 has nothing.
  legacy("C#", ["cs", "csx"], csharp),
  legacy("Scala", ["scala", "sc", "sbt"], scala),
  legacy("Kotlin", ["kt", "kts"], kotlin),
  legacy("Objective-C", ["m"], objectiveC),
  legacy("Objective-C++", ["mm"], objectiveCpp),
  legacy("Dart", ["dart"], dart),
  legacy("Squirrel", ["nut"], squirrel),
  legacy("Ceylon", ["ceylon"], ceylon),
  legacy("nesC", ["nc"], nesC),
  legacy("Shader", ["glsl", "vert", "frag", "geom", "comp", "tesc", "tese", "hlsl", "fx", "shader", "cginc"], shader),
  legacy("Clojure", ["clj", "cljs", "cljc", "edn"], clojure),
  legacy("CMake", ["cmake"], cmake),
  legacy("COBOL", ["cob", "cbl", "cpy", "cbd", "cdb", "cdc", "copy", "lst"], cobol),
  legacy("CoffeeScript", ["coffee", "litcoffee"], coffeeScript),
  legacy("Common Lisp", ["lisp", "lsp", "cl", "asd", "el"], commonLisp),
  legacy("Crystal", ["cr"], crystal),
  legacy("SCSS", ["scss"], sCSS),
  legacy("Less", ["less"], less),
  legacy("Sass", ["sass"], sass),
  legacy("GSS", ["gss"], gss),
  legacy("Stylus", ["styl"], stylus),
  legacy("Cypher", ["cypher", "cyp"], cypher),
  legacy("D", ["d", "di"], d),
  legacy("Diff", ["diff", "patch", "rej"], diff),
  legacy("Dockerfile", ["dockerfile", "containerfile"], dockerFile),
  legacy("DTD", ["dtd"], dtd),
  legacy("Dylan", ["dylan"], dylan),
  legacy("EBNF", ["ebnf"], ebnf),
  legacy("ECL", ["ecl"], ecl),
  legacy("Eiffel", ["e"], eiffel),
  legacy("Elm", ["elm"], elm),
  legacy("Erlang", ["erl", "hrl", "escript"], erlang),
  legacy("Factor", ["factor"], factor),
  legacy("FCL", ["fcl"], fcl),
  legacy("Forth", ["fth", "4th", "forth"], forth),
  legacy("Fortran", ["f", "for", "f77", "f90", "f95", "f03", "f08", "f2k", "f23"], fortran),
  legacy("Assembly (GAS)", ["s", "asm"], gas),
  legacy("Gherkin", ["feature"], gherkin),
  legacy("Groovy", ["groovy", "gvy", "gradle"], groovy),
  legacy("Haskell", ["hs", "lhs", "las"], haskell),
  legacy("Haxe", ["hx"], haxe),
  legacy("HXML", ["hxml"], hxml),
  legacy("HTTP", ["http"], http),
  legacy("Jinja2", ["jinja", "jinja2", "j2"], jinja2),
  legacy("Julia", ["jl"], julia),
  legacy("LiveScript", ["ls"], liveScript),
  legacy("Lua", ["lua"], lua),
  legacy("Mathematica", ["wl", "wls", "nb"], mathematica),
  legacy("mbox", ["mbox", "eml"], mbox),
  legacy("mIRC", ["mrc"], mirc),
  legacy("OCaml", ["ml", "mli", "thy"], oCaml),
  legacy("F#", ["fs", "fsx", "fsi"], fSharp),
  legacy("Standard ML", ["sml", "sig", "fun"], sml),
  legacy("Modelica", ["mo"], modelica),
  legacy("MscGen", ["msc", "mscgen"], mscgen),
  legacy("MsGenny", ["msgenny"], msgenny),
  legacy("Xù", ["xu"], xu),
  legacy("nginx", ["nginx"], nginx),
  legacy("NSIS", ["nsi", "nsh"], nsis),
  legacy("N-Triples", ["nt", "nq"], ntriples),
  legacy("Octave", ["octave"], octave),
  legacy("Oz", ["oz"], oz),
  legacy("Pascal", ["pas", "pp", "p", "dpr", "lpr", "dpk"], pascal),
  legacy("PEG.js", ["pegjs", "peggy"], pegjs),
  legacy("Perl", ["pl", "pm", "pod", "cgi", "plx", "t"], perl),
  legacy("Pig", ["pig"], pig),
  legacy("PowerShell", ["ps1", "psm1", "psd1"], powerShell),
  legacy("Properties", ["properties", "ini", "cfg", "conf", "env", "editorconfig", "gitignore", "gitattributes", "gitmodules", "gitconfig", "npmrc", "prefs", "reg", "inf", "url", "wer", "desktop", "service"], properties),
  legacy("Protocol Buffers", ["proto"], protobuf),
  legacy("Pug", ["pug", "jade"], pug),
  legacy("Puppet", ["puppet"], puppet),
  legacy("Cython", ["pyx", "pxd", "pxi"], cython),
  legacy("Q", ["q"], q),
  legacy("R", ["r", "rprofile", "splus"], r),
  legacy("RPM spec", ["spec"], rpmSpec),
  legacy("Ruby", ["rb", "rake", "gemspec", "podspec", "ru", "rbw"], ruby),
  legacy("SAS", ["sas"], sas),
  legacy("Scheme", ["scm", "ss", "smd", "rkt", "sld"], scheme),
  legacy("Shell", ["sh", "bash", "zsh", "fish", "ksh", "csh", "tcsh", "bsh", "bashrc", "zshrc", "profile", "bash_profile", "bash_aliases"], shell),
  legacy("Sieve", ["sieve"], sieve),
  legacy("Smalltalk", ["st"], smalltalk),
  legacy("SPARQL", ["rq", "sparql"], sparql),
  legacy("LaTeX", ["tex", "sty", "ltx", "dtx", "latex"], stex),
  legacy("Swift", ["swift"], swift),
  legacy("Tcl", ["tcl", "tk", "exp"], tcl),
  legacy("Textile", ["textile"], textile),
  legacy("TiddlyWiki", ["tid"], tiddlyWiki),
  legacy("TOML", ["toml"], toml),
  legacy("troff", ["troff", "roff", "man", "nroff"], troff),
  legacy("TTCN-3", ["ttcn", "ttcn3"], ttcn),
  legacy("Turtle", ["ttl"], turtle),
  legacy("Visual Basic", ["vb", "vba", "bas", "frm"], vb),
  legacy("VBScript", ["vbs", "wsf"], vbScript),
  legacy("ASP", ["asp", "aspx"], vbScriptASP),
  legacy("ASN.1", ["asn1", "asn", "mib"], asn1({})),
  legacy("Velocity", ["vm", "vtl"], velocity),
  legacy("Verilog", ["v", "sv", "svh", "vh"], verilog),
  legacy("TL-Verilog", ["tlv"], tlv),
  legacy("VHDL", ["vhd", "vhdl"], vhdl),
  legacy("WebAssembly text", ["wat", "wast"], wast),
  legacy("WebIDL", ["webidl", "widl"], webIDL),
  legacy("XQuery", ["xq", "xquery", "xqy", "xqm", "xql"], xQuery),
  legacy("Yacas", ["ys"], yacas),
  legacy("Z80 assembly", ["z80"], z80),
  legacy("APL", ["apl"], apl),
  legacy("ASCII armor", ["asc", "pgp"], asciiArmor),
  legacy("Brainfuck", ["bf", "b"], brainfuck),
  // Tier 4: Notepad++ keyword tables through the generic keyword mode
  // (langs.generated.ts, scripts/convert-langs-model.mjs), for the languages
  // no tier above covers. Plain files Notepad++ names without keywords.
  ...NPP_LANGUAGES.map(
    (def): LanguageEntry => ({
      name: def.name,
      extensions: def.extensions,
      source: "builtin",
      // The keyword map is built on first open, not at load: 27 of them would be paid at every start otherwise.
      load: () => StreamLanguage.define(adaptStreamParser(keywordMode(def) as StreamParser<unknown>)),
    })
  ),
  plain("NFO", ["nfo"]),
  plain("Intel HEX", ["hex"]),
  plain("Motorola S-record", ["mot", "srec"]),
  plain("Tektronix hex", ["tek"]),
  plain("MHTML", ["mht", "mhtml"]),
];

const BY_EXTENSION: Map<string, LanguageEntry> = (() => {
  const m = new Map<string, LanguageEntry>();
  for (const e of ENTRIES) {
    for (const ext of e.extensions) {
      // First registration wins; a duplicate is a registry bug, and the
      // registry test fails on it rather than letting one entry shadow another.
      if (!m.has(ext)) m.set(ext, e);
    }
  }
  return m;
})();

/** Definitions from the vault's language folder and the user's custom file types, added at load. */
const VAULT_ENTRIES: LanguageEntry[] = [];
/** ext -> the bundled entry a vault definition or custom type displaced, so it can be put back. */
const DISPLACED: Map<string, LanguageEntry | undefined> = new Map();

/**
 * Registers one JSON definition from the vault (tier 4, the data path that
 * needs no release). The vault file WINS for its extensions: while the file is
 * in the folder its definition is used, bundled or not (the user's rule); what
 * it displaced is reported so the log can say so. Must run before the plugin
 * registers its extensions with Obsidian, or be followed by a registration of
 * the new extensions.
 */
export function registerVaultLanguage(def: KeywordLanguage): { entry: LanguageEntry; displaced: string[] } {
  const extensions = [...new Set(def.extensions.map((e) => e.toLowerCase()))];
  const entry: LanguageEntry = {
    name: def.name,
    extensions,
    source: "vault",
    load: () => StreamLanguage.define(adaptStreamParser(keywordMode(def) as StreamParser<unknown>)),
  };
  const displaced: string[] = [];
  for (const ext of extensions) {
    const previous = BY_EXTENSION.get(ext);
    if (previous && previous !== entry) displaced.push(`.${ext} (was ${previous.name})`);
    if (!DISPLACED.has(ext)) DISPLACED.set(ext, previous);
    BY_EXTENSION.set(ext, entry);
  }
  VAULT_ENTRIES.push(entry);
  if (!BY_NAME.has(entry.name.toLowerCase())) BY_NAME.set(entry.name.toLowerCase(), entry);
  return { entry, displaced };
}

/**
 * A custom file type: one extension mapped onto a language the registry
 * already has (`Plain text` included), for files the user wants opened that no
 * table names. The mapping wins over a bundled claim for that extension.
 */
export function registerCustomExtension(ext: string, languageName: string): { entry: LanguageEntry; displaced: string | null } | null {
  const target = languageNamed(languageName);
  const lower = ext.toLowerCase().replace(/^\./, "");
  if (!target || !/^[a-z0-9_+-]+$/.test(lower)) return null;
  const previous = BY_EXTENSION.get(lower);
  if (previous === target) return { entry: target, displaced: null };
  if (!DISPLACED.has(lower)) DISPLACED.set(lower, previous);
  const entry: LanguageEntry = { name: target.name, extensions: [lower], source: target.source, load: target.load };
  // Same language, one more extension: share the resolved Language through the target.
  VAULT_ENTRIES.push(entry);
  BY_EXTENSION.set(lower, target);
  return { entry: target, displaced: previous ? `.${lower} (was ${previous.name})` : null };
}

/** Forget every vault definition and custom type; the bundled claims they displaced come back. */
export function __clearVaultLanguages(): void {
  for (const [ext, previous] of DISPLACED) {
    if (previous) BY_EXTENSION.set(ext, previous);
    else BY_EXTENSION.delete(ext);
  }
  DISPLACED.clear();
  for (const e of VAULT_ENTRIES) if (BY_NAME.get(e.name.toLowerCase()) === e) BY_NAME.delete(e.name.toLowerCase());
  VAULT_ENTRIES.length = 0;
}

/** Every extension the registry knows, lower-case, without the dot. */
export function registeredExtensions(): string[] {
  return [...BY_EXTENSION.keys()];
}

export function languageFor(extension: string): LanguageEntry | null {
  return BY_EXTENSION.get(extension.toLowerCase()) ?? null;
}

const BY_NAME: Map<string, LanguageEntry> = new Map(ENTRIES.map((e) => [e.name.toLowerCase(), e]));

/** The entry whose display name this is, case-insensitively (`c#`, `JavaScript`), or null. */
export function languageNamed(name: string): LanguageEntry | null {
  return BY_NAME.get(name.trim().toLowerCase()) ?? null;
}

const RESOLVED = new WeakMap<LanguageEntry, ResolvedLanguage>();

/**
 * The Language and the editor extension for an entry, built on first use and
 * cached: a StreamLanguage.define per open would give every pane its own
 * parser tables for nothing.
 */
export function resolveLanguage(entry: LanguageEntry): ResolvedLanguage | null {
  if (!entry.load) return null;
  const cached = RESOLVED.get(entry);
  if (cached) return cached;
  const loaded = entry.load();
  const resolved: ResolvedLanguage =
    loaded instanceof LanguageSupport
      ? { entry, language: loaded.language, support: loaded }
      : { entry, language: loaded, support: loaded };
  RESOLVED.set(entry, resolved);
  return resolved;
}

/** Every language name the registry knows, bundled and vault, in registry order, for pickers. */
export function allLanguageNames(): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const e of [...ENTRIES, ...VAULT_ENTRIES]) {
    if (seen.has(e.name)) continue;
    seen.add(e.name);
    out.push(e.name);
  }
  return out;
}

/** The keyword table behind a tier-4 language, for "create an example definition"; null for grammars and legacy modes. */
export function keywordTableFor(languageName: string): KeywordLanguage | null {
  const lower = languageName.trim().toLowerCase();
  return NPP_LANGUAGES.find((l) => l.name.toLowerCase() === lower) ?? null;
}

/** Exposed for the registry test only: duplicates, sources, and Obsidian-owned entries. Bundled entries only. */
export function __allEntries(): readonly LanguageEntry[] {
  return ENTRIES;
}

#!/usr/bin/env node
/**
 * Converts Notepad++'s `langs.model.xml` into `src/highlight/langs.generated.ts`:
 * the keyword tables behind tier 4 of the registry (handoff §17). Run when the
 * table changes, commit the output; the build does not need the XML.
 *
 *   node scripts/convert-langs-model.mjs "C:\Program Files\Notepad++\langs.model.xml"
 *
 * Only the languages in TIER4 below are emitted: the ones whose file types no
 * bundled grammar or legacy mode covers. Languages Notepad++ knows that tiers
 * 1 to 3 already cover (C, Python, HTML, ...) are not converted; their extra
 * extensions are added to the existing registry entries by hand instead, so
 * they get the better highlighter. Hollywood (`.hws`, 33 KB of keywords for a
 * niche commercial BASIC) is left out on the size rule and is the worked
 * example for the vault language folder instead. Notepad++ is GPL-3.0; so is this plugin;
 * the tables live under src/highlight and never under src/format or src/model
 * (ADR-002).
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "src", "highlight", "langs.generated.ts");

/**
 * lexer name -> display name, extensions to register (Notepad++'s list, minus
 * what other tiers already own and minus `inc`, which the registry leaves
 * unregistered as ambiguous), and whether keywords are case-insensitive.
 */
const TIER4 = {
  actionscript: { name: "ActionScript", ext: ["as", "mx"] },
  ada: { name: "Ada", ext: ["ada", "ads", "adb"], ci: true },
  autoit: { name: "AutoIt", ext: ["au3"], ci: true },
  avs: { name: "AviSynth", ext: ["avs", "avsi"], ci: true },
  baanc: { name: "BaanC", ext: ["bc", "cln"] },
  // `nt` is N-Triples in tier 2 (first registration wins); Notepad++ also lists it for batch.
  batch: { name: "Batch", ext: ["bat", "cmd"], ci: true },
  blitzbasic: { name: "BlitzBasic", ext: ["bb"], ci: true },
  csound: { name: "Csound", ext: ["orc", "sco", "csd"] },
  escript: { name: "EScript", ext: ["src", "em"] },
  freebasic: { name: "FreeBASIC", ext: ["bi"], ci: true },
  gdscript: { name: "GDScript", ext: ["gd"] },
  gui4cli: { name: "Gui4Cli", ext: ["gui"], ci: true },
  inno: { name: "Inno Setup", ext: ["iss"], ci: true },
  kix: { name: "KiXtart", ext: ["kix"], ci: true },
  mmixal: { name: "MMIXAL", ext: ["mms"] },
  nim: { name: "Nim", ext: ["nim"] },
  nncrontab: { name: "nnCron", ext: ["tab", "spf"], ci: true },
  oscript: { name: "OScript", ext: ["osx"], ci: true },
  postscript: { name: "PostScript", ext: ["ps"] },
  purebasic: { name: "PureBasic", ext: ["pb"], ci: true },
  raku: { name: "Raku", ext: ["raku", "rakumod", "rakudoc", "rakutest", "p6", "pm6", "pod6", "t6"] },
  rc: { name: "Resource script", ext: ["rc"] },
  rebol: { name: "REBOL", ext: ["r2", "r3", "reb"], ci: true },
  spice: { name: "SPICE", ext: ["scp"], ci: true },
  visualprolog: { name: "Visual Prolog", ext: ["pro", "i", "pack", "ph"] },
};

/**
 * Languages a CodeMirror legacy mode already covers, whose Notepad++ word list
 * knows commands the mode leaves plain (measured 2026-09-08 by running every
 * Notepad++ word through the mode: Tcl 238 of 330 plain; Shell, Lua, Perl,
 * PowerShell, Fortran, Verilog and the rest had none or only external
 * commands). Emitted as NPP_FALLBACKS and applied by `withFallbackKeywords`:
 * a word the mode does not colour and the table knows gets the table's role.
 */
const FALLBACK = {
  tcl: { name: "Tcl", ext: ["tcl"] },
};

/**
 * Languages converted to JSON under docs/languages/ instead of into the
 * bundle: the worked examples for the vault's language folder. Same shape.
 */
const EXAMPLES = {
  hollywood: { name: "Hollywood", ext: ["hws"], ci: true },
};

/**
 * What Notepad++'s table leaves out because its lexer knows it: the comment
 * marker and the keywords its list predates. Applied after the table is read;
 * the words are this plugin's, not Notepad++'s.
 */
const SUPPLEMENT = {
  // Notepad++ names REM; `::` is the other line comment, `:label` and `%VAR%` the two things words cannot say.
  batch: {
    commentLines: ["::"],
    patterns: [
      { regex: ":[A-Za-z_][\\w.-]*", token: "labelName", sol: true },
      { regex: "%~?[A-Za-z0-9_*]+%?|![A-Za-z_][\\w]*!", token: "variableName.special" },
    ],
  },
  purebasic: {
    commentLine: ";",
    keyword:
      "define debug debuglevel disableasm disabledebugger disableexplicit enableasm enabledebugger enableexplicit import endimport importc module endmodule declaremodule enddeclaremodule usemodule unusemodule runtime macro endmacro with endwith prototype prototypec threaded map array list swap not xor compilererror compilerwarning undefinemacro macroexpandedcount",
  },
};

/** Notepad++ keyword set -> the role the generic mode colours it as. */
const ROLE = { instre1: "keyword", instre2: "builtin", type1: "type", type2: "constant", type3: "property", type4: "meta", type5: "special", type6: "special", type7: "special" };

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/convert-langs-model.mjs <path to langs.model.xml>");
  process.exit(2);
}
const xml = fs.readFileSync(source, "utf8");
const stat = fs.statSync(source);

const attrs = (s) => Object.fromEntries([...s.matchAll(/([A-Za-z_]+)\s*=\s*"([^"]*)"/g)].map((m) => [m[1], m[2]]));
const decode = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const out = [];
const fallbacks = [];
const examples = [];
const seen = new Set();
for (const m of xml.matchAll(/<Language\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/Language>)/g)) {
  const a = attrs(m[1]);
  const spec = TIER4[a.name] ?? EXAMPLES[a.name] ?? FALLBACK[a.name];
  if (!spec) continue;
  seen.add(a.name);
  const sets = [];
  for (const k of (m[2] ?? "").matchAll(/<Keywords\s+name="([^"]*)">([^<]*)<\/Keywords>/g)) {
    const role = ROLE[k[1]];
    const words = decode(k[2]).trim().split(/\s+/).filter(Boolean);
    if (!role || words.length === 0) continue;
    sets.push([role, [...new Set(words)].join(" ")]);
  }
  const extra = SUPPLEMENT[a.name];
  if (extra?.keyword) {
    const row = sets.find(([role]) => role === "keyword");
    if (row) row[1] = [...new Set(`${row[1]} ${extra.keyword}`.split(" "))].join(" ");
    else sets.unshift(["keyword", extra.keyword]);
  }
  (TIER4[a.name] ? out : FALLBACK[a.name] ? fallbacks : examples).push({
    id: a.name,
    name: spec.name,
    extensions: spec.ext,
    caseInsensitive: spec.ci === true,
    commentLine: a.commentLine ? decode(a.commentLine) : (extra?.commentLine ?? null),
    commentStart: a.commentStart ? decode(a.commentStart) : null,
    commentEnd: a.commentEnd ? decode(a.commentEnd) : null,
    sets,
    ...(extra?.commentLines ? { commentLines: extra.commentLines } : {}),
    ...(extra?.patterns ? { patterns: extra.patterns } : {}),
  });
}
const missing = [...Object.keys(TIER4), ...Object.keys(EXAMPLES), ...Object.keys(FALLBACK)].filter((k) => !seen.has(k));
if (missing.length > 0) {
  console.error(`not found in ${source}: ${missing.join(", ")}`);
  process.exit(1);
}
out.sort((x, y) => x.id.localeCompare(y.id));

const header = `// GENERATED by scripts/convert-langs-model.mjs from Notepad++ langs.model.xml
// (file dated ${stat.mtime.toISOString().slice(0, 10)}, ${out.length} languages). Do not edit; rerun the script.
// Notepad++ is GPL-3.0; these tables make the combined work GPL (ADR-002).
import type { KeywordLanguage } from "./keywordMode";

export const NPP_LANGUAGES: readonly KeywordLanguage[] = ${JSON.stringify(out, null, 2)};

/** Word lists for languages a legacy mode owns, applied as a fallback (streamFixes.withFallbackKeywords). */
export const NPP_FALLBACKS: Readonly<Record<string, KeywordLanguage>> = ${JSON.stringify(Object.fromEntries(fallbacks.map((f) => [f.id, f])), null, 2)};
`;
fs.writeFileSync(OUT, header, "utf8");
const EXAMPLE_DIR = path.join(ROOT, "docs", "languages");
fs.mkdirSync(EXAMPLE_DIR, { recursive: true });
for (const ex of examples) {
  // The vault file needs no id (the file name is the id) and reads better with one word per line.
  const { id: _id, ...rest } = ex;
  const json = JSON.stringify({ ...rest, sets: rest.sets.map(([role, words]) => [role, words.split(" ")]) }, null, 2);
  fs.writeFileSync(path.join(EXAMPLE_DIR, `${ex.id}.json`), `${json}\n`, "utf8");
}
const bytes = Buffer.byteLength(header, "utf8");
console.log(`${OUT}: ${out.length} languages, ${bytes} bytes; per language: ${out.map((l) => `${l.id} ${l.sets.reduce((n, s) => n + s[1].length, 0)}`).join(", ")}`);

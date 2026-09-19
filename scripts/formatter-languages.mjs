#!/usr/bin/env node
/**
 * What the files in `formatters/` actually format, asked of the files
 * themselves, and whether the plugin's own table agrees with them.
 *
 *   node scripts/formatter-languages.mjs            # the table and the report
 *   node scripts/formatter-languages.mjs --markdown # only the table, to paste
 *
 * Every prettier plugin declares the languages and extensions it serves, and
 * `getSupportInfo()` reports them. This script loads each file exactly as the
 * plugin does — one `new Function(require, module, exports)` and a `require`
 * that answers only the engine and the files already loaded beside it — with
 * the same companion files `KNOWN_FILES` says it needs, because prettier's own
 * split puts the LANGUAGES in `estree.js` and the PARSERS in `babel.js` and
 * `typescript.js`: asked alone, those two answer nothing.
 *
 * Then the two halves are compared:
 *
 * - an extension the table claims that resolves to no parser is a **fault**:
 *   Format offers itself for that file and then fails;
 * - an extension a file serves that the table does not claim is a **choice**:
 *   most of prettier's lists reach far past the language (`@prettier/plugin-xml`
 *   claims `.rs`, the SQL plugin claims `.q`), and taking those would steal
 *   files from the languages they belong to. They are printed so the choice
 *   stays deliberate.
 *
 * The release checklist runs this whenever a shipped file changes.
 */

import { createHash } from "node:crypto";
import { readFileSync, existsSync, readdirSync } from "node:fs";

const repo = new URL("../", import.meta.url);
const PRETTIER = new URL("formatters/prettier/", repo);
const EXTRA = new URL("formatters/extra/", repo);
const markdownOnly = process.argv.includes("--markdown");

/** Load one file the way the plugin does: no filesystem, no modules but the ones handed in. */
function load(url, allowed) {
  const code = readFileSync(url, "utf8");
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => {
      if (allowed.has(id)) return allowed.get(id);
      throw new Error(`a formatter may not require ${id}`);
    },
    module,
    module.exports
  );
  return { exports: interop(module.exports), sha256: createHash("sha256").update(code).digest("hex"), bytes: Buffer.byteLength(code) };
}

/** A bundle built from an ES module hides the plugin under `default` (see vaultFormatter.ts). */
function interop(exports) {
  if (typeof exports !== "object" || exports === null || exports.__esModule !== true || exports.default === undefined) return exports;
  const inner = exports.default;
  if (typeof inner !== "object" || inner === null) return exports;
  return inner.languages !== undefined || inner.parsers !== undefined || inner.printers !== undefined ? inner : exports;
}

/** Where a file lives: prettier's own folder first, then the bundled community ones. */
function fileUrl(name) {
  const own = new URL(name, PRETTIER);
  return existsSync(own) ? own : new URL(name, EXTRA);
}

const engineUrl = new URL("standalone.js", PRETTIER);
if (!existsSync(engineUrl)) {
  console.error("formatters/prettier/standalone.js is not here; nothing can be asked");
  process.exit(2);
}
const engine = load(engineUrl, new Map());
const prettier = engine.exports;

/** `KNOWN_FILES` as the plugin has it: the name, what it needs, what it claims. */
const source = readFileSync(new URL("src/fmt/prettierFiles.ts", repo), "utf8");
const known = [];
for (const m of source.matchAll(/\{ name: "([^"]+)", what: "([^"]*)", extensions: \[([^\]]*)\], needs: \[([^\]]*)\] \}/g)) {
  known.push({
    name: m[1],
    what: m[2],
    extensions: [...m[3].matchAll(/"([^"]+)"/g)].map((e) => e[1]),
    needs: [...m[4].matchAll(/"([^"]+)"/g)].map((e) => e[1]),
  });
}
if (known.length === 0) {
  console.error("KNOWN_FILES could not be read from src/fmt/prettierFiles.ts");
  process.exit(2);
}

/** The engine's own languages, so what a plugin ADDS can be told from what it repeats. */
const baseline = new Set(((await prettier.getSupportInfo({ plugins: [] })).languages ?? []).flatMap((l) => l.parsers ?? []));

const report = [];
for (const entry of known) {
  if (entry.extensions.length === 0) continue; // the engine and the bare printer serve no language of their own
  const allowed = new Map([
    ["prettier", prettier],
    ["prettier/standalone", prettier],
    ["prettier/doc", prettier.doc],
  ]);
  const plugins = [];
  let failed = null;
  // The needs first, in order, then the file itself — the plugin's own sequence.
  for (const name of [...entry.needs, entry.name].filter((n) => n !== "standalone.js")) {
    const url = fileUrl(name);
    if (!existsSync(url)) {
      failed = `${name} is not in formatters/`;
      break;
    }
    let file;
    try {
      file = load(url, allowed);
    } catch (e) {
      failed = `${name}: ${e instanceof Error ? e.message : String(e)}`;
      break;
    }
    plugins.push(file.exports);
    allowed.set(`prettier/plugins/${name.replace(/\.js$/, "")}`, file.exports);
  }
  if (failed !== null) {
    report.push({ ...entry, failed });
    continue;
  }
  const info = await prettier.getSupportInfo({ plugins });
  // Extension -> the parser prettier would pick, exactly as parserFor() does.
  const served = new Map();
  const names = new Set();
  for (const language of info.languages ?? []) {
    const parser = (language.parsers ?? [])[0];
    if (typeof parser !== "string" || parser.length === 0) continue;
    for (const extension of language.extensions ?? []) {
      const bare = extension.replace(/^\./, "").toLowerCase();
      if (!served.has(bare)) served.set(bare, parser);
    }
    if (!baseline.has(parser)) names.add(language.name);
  }
  const claimedNames = new Set();
  for (const extension of entry.extensions) {
    const parser = served.get(extension.toLowerCase());
    if (parser === undefined) continue;
    for (const language of info.languages ?? []) {
      if ((language.parsers ?? [])[0] === parser) claimedNames.add(language.name);
    }
  }
  report.push({
    ...entry,
    failed: null,
    languages: [...(claimedNames.size > 0 ? claimedNames : names)],
    faults: entry.extensions.filter((e) => !served.has(e.toLowerCase())),
    notTaken: [...served.keys()].filter((e) => !entry.extensions.includes(e)).sort(),
  });
}

if (!markdownOnly) console.log(`prettier ${prettier.version}, ${report.length} language file(s) in formatters/\n`);

console.log("| File | Formats | Extensions |");
console.log("| --- | --- | --- |");
for (const entry of report) {
  if (entry.failed !== null) continue;
  console.log(`| \`${entry.name}\` | ${entry.languages.sort().join(", ")} | ${entry.extensions.map((e) => `\`.${e}\``).join(" ")} |`);
}

if (markdownOnly) process.exit(0);

console.log("\nAgainst KNOWN_FILES in src/fmt/prettierFiles.ts:");
let faults = 0;
for (const entry of report) {
  if (entry.failed !== null) {
    console.log(`  FAULT ${entry.name}: ${entry.failed}`);
    faults++;
    continue;
  }
  if (entry.faults.length === 0) continue;
  faults++;
  console.log(`  FAULT ${entry.name}: the table claims ${entry.faults.join(" ")} and no parser answers for them — Format would offer itself and fail`);
}
if (faults === 0) console.log("  every extension the plugin offers resolves to a parser");

console.log("\nServed by the file, deliberately not offered (they belong to other languages here):");
for (const entry of report) {
  if (entry.failed !== null || entry.notTaken.length === 0) continue;
  console.log(`  ${entry.name}: ${entry.notTaken.length} — ${entry.notTaken.join(" ")}`);
}

console.log("\nSHA-256 of every file in formatters/ (KNOWN_HASHES is append-only):");
console.log(`  "${engine.sha256}": "standalone.js",`);
for (const folder of [PRETTIER, EXTRA]) {
  if (!existsSync(folder)) continue;
  for (const name of readdirSync(folder).sort()) {
    if (!name.endsWith(".js") || name === "standalone.js") continue;
    console.log(`  "${createHash("sha256").update(readFileSync(new URL(name, folder), "utf8")).digest("hex")}": "${name}",`);
  }
}
process.exit(faults === 0 ? 0 : 1);

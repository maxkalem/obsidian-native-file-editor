#!/usr/bin/env node
/**
 * Bundle one prettier plugin into a single file this plugin can load.
 *
 *   node scripts/build-formatter.mjs @prettier/plugin-php php
 *
 * Why this exists: prettier ships its own browser builds, but the community
 * plugins do not — they are published as several CommonJS or ESM files that
 * import each other and, here and there, a Node module they barely use. A
 * formatter in `<plugin folder>/formatters/` has to be ONE self-contained
 * file that asks for nothing but the prettier engine (ADR-005), so the
 * package is bundled here with two tiny shims in place of `fs` and `path`.
 *
 * The result goes to `formatters/<name>.js`; its SHA-256 is printed and
 * belongs in `KNOWN_HASHES` in `src/fmt/prettierFiles.ts`, appended, never
 * replacing an older entry. Nothing is installed into this repository:
 * install the package in a scratch folder and point `--from` at its
 * node_modules, or run this with npx in that folder.
 *
 * Measured 2026-09-19 with esbuild 0.25.10 and prettier 3.9.8:
 *   @prettier/plugin-php            -> php.js         165 KB, formats in 5 ms
 *   @prettier/plugin-xml            -> xml.js         179 KB, 5 ms (needs prettier/doc)
 *   prettier-plugin-sql             -> sql.js       2 896 KB, 4 ms
 *   prettier-plugin-svelte          -> svelte.js      885 KB, 6 ms (needs estree, babel, postcss)
 *   prettier-plugin-gherkin         -> gherkin.js     205 KB, 3 ms
 *   @shopify/prettier-plugin-liquid -> liquid.js      182 KB, 4 ms
 *   prettier-plugin-nginx           -> nginx.js        13 KB, 2 ms
 *   prettier-plugin-jinja-template  -> jinja.js         8 KB, 2 ms (needs html)
 *   prettier-plugin-properties      -> properties.js    7 KB, 1 ms
 *   prettier-plugin-ini             -> ini.js           5 KB, 1 ms (needs prettier/doc)
 * And what did NOT come out usable: prettier-plugin-toml (34.8 MB, a WASM
 * blob inlined as base64), prettier-plugin-java and prettier-plugin-sh and
 * prettier-plugin-solidity (they need `node:fs/promises` or `node:util`, so
 * they are server-side plugins), prettier-plugin-go-template (written for
 * prettier 2: it asks for `prettier/parser-html`, which prettier 3 has not).
 *
 * A file that leans on another one (Svelte, Jinja) names it in `needs` in
 * `src/fmt/prettierFiles.ts`; `scripts/formatter-languages.mjs` then loads the
 * same set and prints what the pair really serves.
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const [pkg, outName] = process.argv.slice(2);
if (!pkg || !outName) {
  console.error("usage: node scripts/build-formatter.mjs <npm package> <output name without .js>");
  process.exit(2);
}

const repo = fileURLToPath(new URL("..", import.meta.url));
const work = mkdtempSync(join(tmpdir(), "nfe-formatter-"));
let entry = "";

const FS_SHIM = `export const existsSync = () => false;
export const readFileSync = () => "";
export const statSync = () => { throw new Error("a formatter has no filesystem here"); };
export default { existsSync, readFileSync, statSync };
`;

const PATH_SHIM = `const parts = (p) => String(p).split("/");
export const sep = "/";
export const join = (...a) => a.filter(Boolean).join("/");
export const resolve = (...a) => a.filter(Boolean).join("/");
export const dirname = (p) => parts(p).slice(0, -1).join("/");
export const basename = (p) => parts(p).pop() ?? "";
export const extname = (p) => { const b = basename(p); const i = b.lastIndexOf("."); return i < 0 ? "" : b.slice(i); };
export const parse = (p) => ({ root: "", dir: dirname(p), base: basename(p), ext: extname(p), name: basename(p).replace(/\\.[^.]*$/, "") });
export default { sep, join, resolve, dirname, basename, extname, parse };
`;

try {
  writeFileSync(join(work, "fs.js"), FS_SHIM);
  writeFileSync(join(work, "path.js"), PATH_SHIM);
  // The entry must sit where the package is installed, so esbuild resolves it
  // from THAT node_modules: run this from the scratch folder you installed in.
  entry = join(process.cwd(), ".nfe-formatter-entry.mjs");
  writeFileSync(entry, `export * from ${JSON.stringify(pkg)};\nexport { default } from ${JSON.stringify(pkg)};\n`);
  const out = join(repo, "formatters", `${outName}.js`);
  execFileSync(
    "npx",
    [
      "--yes",
      "esbuild@0.25.10",
      entry,
      "--bundle",
      "--format=cjs",
      "--platform=browser",
      "--target=es2021",
      "--minify",
      `--alias:fs=${join(work, "fs.js")}`,
      `--alias:path=${join(work, "path.js")}`,
      // The engine is already loaded when the plugin runs; these three ids are
      // the only ones the loader answers.
      "--external:prettier",
      "--external:prettier/standalone",
      "--external:prettier/doc",
      `--outfile=${out}`,
      "--log-level=warning",
    ],
    { stdio: "inherit" }
  );
  const bytes = readFileSync(out);
  const hash = createHash("sha256").update(bytes).digest("hex");
  console.log(`\n${outName}.js  ${(statSync(out).size / 1024).toFixed(0)} KB\nsha256 ${hash}\n\nAdd to KNOWN_HASHES in src/fmt/prettierFiles.ts (append, never replace):\n  "${hash}": "${pkg} via build-formatter, ${outName}.js",`);
} finally {
  rmSync(work, { recursive: true, force: true });
  if (entry) rmSync(entry, { force: true });
}

import esbuild from "esbuild";
import fs from "fs";
import process from "process";

const banner = `/*
Native File Editor for Obsidian - bundled output. Source: https://github.com/maxkalem/obsidian-native-file-editor
Licence: GPL-3.0-only; src/format and src/model additionally MIT. See LICENSE and THIRD_PARTY_NOTICES.md.
*/`;

const prod = process.argv.includes("production");
const wantSize = process.argv.includes("--size");

/**
 * Obsidian hands these modules to plugins at runtime, so they cost nothing to
 * leave outside the bundle and must not be duplicated inside it: a second copy
 * of @codemirror/state would make every extension this plugin builds
 * incompatible with the EditorView Obsidian created it against. The list is
 * the sample plugin's, read 2026-09-04.
 *
 * It is deliberately explicit rather than "@codemirror/*": the language
 * packages (@codemirror/lang-*, @codemirror/legacy-modes) are NOT provided by
 * Obsidian and have to be bundled, so a glob here would silently break every
 * language at load time.
 */
const externals = [
  "obsidian",
  "electron",
  "@codemirror/autocomplete",
  "@codemirror/collab",
  "@codemirror/commands",
  "@codemirror/language",
  "@codemirror/lint",
  "@codemirror/search",
  "@codemirror/state",
  "@codemirror/view",
  "@lezer/common",
  "@lezer/highlight",
  "@lezer/lr",
  // Node built-ins: desktop transport only, resolved by Electron at runtime and
  // guarded behind Platform.isDesktopApp so the mobile bundle never touches them.
  "fs",
  "path",
  "zlib",
];

/**
 * The repository ROOT is the single source of truth (Obsidian convention):
 * main.js is built there, manifest.json and styles.css are edited there. Every
 * build copies all three into native-file-editor/, the folder a person copies
 * into .obsidian/plugins/ for a manual install, so a manual install and a
 * release ship byte-identical files. CI fails when the copies drift. Never
 * edit the files inside native-file-editor/ by hand.
 */
const INSTALL_DIR = "native-file-editor";

function syncStaticFiles() {
  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  for (const f of ["manifest.json", "styles.css"]) {
    fs.copyFileSync(f, `${INSTALL_DIR}/${f}`);
  }
}

function checkVersions() {
  const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
  if (!(version in versions)) {
    console.error(`versions.json has no entry for manifest version ${version}`);
    process.exit(1);
  }
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
  if (pkg !== version) {
    console.error(`package.json version ${pkg} != manifest.json version ${version}`);
    process.exit(1);
  }
}

/**
 * Per-package size report. Obsidian loads main.js as one script with no code
 * splitting, so every bundled language is parsed at every start. This is what
 * makes the trade visible in a release instead of argued about.
 */
function printSizeReport(metafile) {
  const byPackage = new Map();
  for (const [file, info] of Object.entries(metafile.outputs["main.js"].inputs)) {
    const m = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(file);
    const key = m ? m[1] : "src (this plugin)";
    byPackage.set(key, (byPackage.get(key) ?? 0) + info.bytesInOutput);
  }
  const rows = [...byPackage.entries()].sort((a, b) => b[1] - a[1]);
  const total = rows.reduce((s, [, b]) => s + b, 0);
  console.log("\nBundle contribution to main.js (bytes in output):");
  for (const [name, bytes] of rows) {
    console.log(`${String(bytes).padStart(10)}  ${((bytes / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
  }
  console.log(`${String(total).padStart(10)}  total (minified code only, before the banner)\n`);
}

checkVersions();
syncStaticFiles();

const options = {
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: externals,
  format: "cjs",
  target: "es2021",
  platform: "browser",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  minify: prod,
  metafile: true,
  outfile: "main.js",
};

if (prod) {
  const result = await esbuild.build(options);
  fs.copyFileSync("main.js", `${INSTALL_DIR}/main.js`);
  if (wantSize) printSizeReport(result.metafile);
  process.exit(0);
} else {
  const ctx = await esbuild.context({
    ...options,
    plugins: [
      {
        name: "sync-install-dir",
        setup(build) {
          build.onEnd(() => fs.copyFileSync("main.js", `${INSTALL_DIR}/main.js`));
        },
      },
    ],
  });
  await ctx.watch();
}

# Formatters you install by hand

The plugin formats without any of this: JSON with its own formatter, and every language whose CodeMirror mode provides indentation. What it cannot do on its own is reprint code the way prettier does — spacing, line breaks, quotes, wrapping — and prettier with all its plugins is larger than the whole plugin.

So prettier is not part of the plugin. It is here, in the repository, and you copy the pieces you want into the plugin's own folder:

```
<vault>/.obsidian/plugins/native-file-editor/formatters/
```

The plugin reads what is there at start (names only) and evaluates a file the moment you press Format, then forgets it. Nothing is downloaded, ever — Obsidian's developer policies forbid a plugin to install or update its dependencies, and this one does not try.

## In three steps

1. Create the folder `formatters` inside the plugin's folder, next to `main.js`.
2. Copy `standalone.js` from `prettier/` into it. It is the engine and every language needs it.
3. Copy the file for your language from the table below into the same folder, with its own name and **no subfolder** — whether it came from `prettier/` or from `extra/`, it goes straight into `formatters/`.

Then restart the plugin (Settings → Native File Editor → Plugin → Reload plugin, or Reread) and right-click in a file of that language: **Format ▸ Format**.

A language with no formatter has no Format row at all. A language one of these files would serve keeps the row, and pressing it opens a dialog naming the files to copy and this page.

## Which files to copy

Every language below is what the file itself reports, measured with `node scripts/formatter-languages.mjs` against the copies in this folder. Sizes are rounded.

| I want to format | Copy, beside `standalone.js` (81 KB) | Size |
| --- | --- | --- |
| JavaScript, JSX, JSON, JSON5 (`.js` `.jsx` `.mjs` `.cjs` `.json` `.json5` `.jsonc` `.webmanifest` `.geojson` `.har`) | `estree.js`, `babel.js` | 519 KB |
| TypeScript, TSX (`.ts` `.tsx` `.mts` `.cts`) | `estree.js`, `typescript.js` | 1 089 KB |
| CSS, SCSS, Less (`.css` `.scss` `.less`) | `postcss.js` | 156 KB |
| HTML, Vue (`.html` `.htm` `.vue`) | `html.js` | 165 KB |
| Markdown (`.md` `.markdown` `.mdx`) | `markdown.js` | 287 KB |
| YAML (`.yml` `.yaml`) | `yaml.js` | 133 KB |
| GraphQL (`.graphql` `.gql`) | `graphql.js` | 45 KB |
| PHP (`.php` `.phtml` `.php3` `.php4` `.php5` `.phps` `.phpt` `.ctp`) | `extra/php.js` | 165 KB |
| XML, SVG, XSLT, project files (`.xml` `.xsd` `.xsl` `.xslt` `.rss` `.wsdl` `.xul` `.plist` `.csproj` `.vbproj` `.props` `.targets`) | `extra/xml.js` | 179 KB |
| SQL and its dialects (`.sql` `.mysql` `.pgsql` `.hql` `.cql` `.pls` `.plsql` `.prc` `.tab` `.udf` `.viw`) | `extra/sql.js` | 2 896 KB |
| Svelte (`.svelte`) | `estree.js`, `babel.js`, `postcss.js`, `extra/svelte.js` | 1 560 KB |
| Liquid templates (`.liquid`) | `extra/liquid.js` | 182 KB |
| Jinja, Django, Nunjucks templates (`.jinja` `.jinja2` `.j2`) | `html.js`, `extra/jinja.js` | 173 KB |
| Gherkin, Cucumber (`.feature`) | `extra/gherkin.js` | 205 KB |
| nginx configuration (`.nginx` `.nginxconf` `.vhost`) | `extra/nginx.js` | 13 KB |
| Java properties (`.properties`) | `extra/properties.js` | 7 KB |
| INI and its kin (`.ini` `.cfg` `.cnf` `.editorconfig` `.gitconfig` `.prefs`) | `extra/ini.js` | 5 KB |

`estree.js` is the printer for everything JavaScript-shaped: JavaScript, TypeScript and Svelte all need it, and it is copied once. Nothing else has a companion except Svelte and Jinja, which are listed with theirs.

Copy what you use. CSS alone comes to 237 KB with the engine; all nineteen files together are about 6.7 MB.

### What none of this covers

Python, Go, Rust, C, C++, Java, C#, shell and the rest are formatted by a program on your machine, not by a file in a folder — the plugin's Run mechanism is the way to reach those. Prettier plugins exist for some of them and do not work here: Java, Shell and Solidity need Node's filesystem, TOML comes to 34.8 MB, and the Go-template plugin is written for prettier 2.

Those languages are not left plain, though: Format still offers **indentation** wherever the language's CodeMirror mode provides it, which is most of them.

## What the plugin checks

Every file is read into memory, hashed with SHA-256, compared with the hashes of the copies in this folder, and only then evaluated — the same text that was hashed. A file that is not one of these builds is **not executed**: a dialog names it and its hash, and it runs only if you say you put it there yourself, which is remembered for that exact file. Change the file and it is refused again.

Only the names in the table are ever read. Anything else in the folder is listed in `nfe.log` and ignored.

If Format cannot work — the file for the language is not there, or one that is there fails to load — a dialog says which files to copy, into which folder, and offers to open this page. The log line has the detail.

The reasoning, the measurements and the limits are in [docs/ADR-005](../docs/ADR-005-formatter-from-the-plugin-folder.md).

## Where these came from

`prettier/` holds prettier's own `standalone.js` and `plugins/*.js`, unmodified, under the MIT licence in `prettier/LICENSE`. **The folder name carries no version**: which version it is, is in `prettier/manifest.json` (with the hash of every file), and the plugin's own list names the version beside each hash. That way nothing — not this table, not the docs, not a script — has to be rewritten when prettier moves on.

When the repository ships a newer prettier, the old hashes stay in the plugin's list, so the copy you already installed keeps working and nothing asks you anything.

To use a prettier the repository does not ship, take `standalone.js` and the plugin files out of its npm package and put them in the same folder, under the same names — no version anywhere in the name. The plugin will not recognise the hashes, so it asks once per file whether you put them there, and then logs which version they turned out to be.

## The files in `extra/` are not prettier's own

Prettier covers the web languages; for the rest there are community plugins, and those are published as several files that import each other and sometimes a Node module. `scripts/build-formatter.mjs` bundles one such package into a single self-contained file with esbuild, replacing `fs` and `path` with two-line shims and leaving the prettier engine external:

```
cd /some/scratch/folder
npm install @prettier/plugin-php
node <repo>/scripts/build-formatter.mjs @prettier/plugin-php php
```

It prints the file's SHA-256, which goes into `KNOWN_HASHES` in `src/fmt/prettierFiles.ts` — appended, never replacing an older entry. `extra/manifest.json` says which package and version each file came from, and `scripts/formatter-languages.mjs` prints what every file in this folder actually serves.

Each of these files is one npm package, and each formats its language in one to five milliseconds.

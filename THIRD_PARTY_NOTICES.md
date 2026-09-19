# Third-party notices

Everything that ends up inside `main.js` and is not this plugin's own code is listed here with its licence. `package.json` declares no runtime dependencies; what follows is bundled at build time and moves only with a release. Everything listed is MIT- or Apache-2.0-licensed, both redistributable inside a GPL-3.0-only work (Apache-2.0 is compatible with GPLv3, one way). The full licence texts are in each package's `LICENSE` file under `node_modules/`; MIT reads: permission is granted to use, copy, modify and distribute, provided the copyright notice and the permission notice are included; the software is provided as is, without warranty.

Obsidian provides the CodeMirror core (`@codemirror/state`, `view`, `language`, `commands`, `search`, `autocomplete`, `lint`, `collab`, `@lezer/common`, `highlight`, `lr`) to plugins at runtime. Those packages are used through Obsidian and are not bundled, so they are not listed below.

## Bundled: CodeMirror language packages

All MIT, copyright Marijn Haverbeke and others (the `@lezer/json` grammar also credits Arun Srinivasan). Versions are those in `package-lock.json` at the release; `npm run size` prints what each one adds to `main.js`.

| Package | What it provides |
| --- | --- |
| `@codemirror/lang-javascript`, `@lezer/javascript` | JavaScript, TypeScript, JSX, TSX |
| `@codemirror/lang-python`, `@lezer/python` | Python |
| `@codemirror/lang-html`, `@lezer/html` | HTML (embeds CSS and JavaScript) |
| `@codemirror/lang-css`, `@lezer/css` | CSS |
| `@codemirror/lang-json`, `@lezer/json` | JSON |
| `@codemirror/lang-xml`, `@lezer/xml` | XML |
| `@codemirror/lang-yaml`, `@lezer/yaml` | YAML |
| `@codemirror/lang-sql` | SQL and its dialects |
| `@codemirror/lang-markdown`, `@lezer/markdown` | Markdown (for `.mdx` and friends; `.md` stays with Obsidian) |
| `@codemirror/lang-rust`, `@lezer/rust` | Rust |
| `@codemirror/lang-go`, `@lezer/go` | Go |
| `@codemirror/lang-java`, `@lezer/java` | Java |
| `@codemirror/lang-php`, `@lezer/php` | PHP |
| `@codemirror/lang-cpp`, `@lezer/cpp` | C and C++ |
| `@codemirror/legacy-modes` | The stream-parser modes for roughly a hundred further languages (the CodeMirror 5 modes, ported) |

## Bundled: community CodeMirror language packages (tier 3)

Each one a separate decision, with its size in `main.js` from `npm run size` on 2026-09-05.

| Package | Language, extensions | Licence, author | Size |
| --- | --- | --- | --- |
| `@replit/codemirror-lang-svelte` 6.0.0 | Svelte, `.svelte` (embeds the bundled HTML, CSS and JavaScript grammars) | MIT, Brian Pool / Replit | 45 KB |
| `@fazelstudio/codemirror-lang-astro` 0.2.0 | Astro, `.astro` | MIT, Zulfazli (fazelllyyy) | 6 KB |
| `codemirror-lang-elixir` 4.0.1 and `lezer-elixir` 1.1.3 | Elixir, `.ex` `.exs` | Apache-2.0, Livebook (livebook-dev) | 3 KB + 145 KB |
| `codemirror-lang-hcl` 0.2.0 | HCL and Terraform, `.hcl` `.tf` `.tfvars` `.nomad` | MIT, haoqixu | 19 KB |
| `@replit/codemirror-lang-nix` 6.0.1 | Nix, `.nix` | MIT, Connor Brewster / Replit | 12 KB |
| `@replit/codemirror-lang-solidity` 6.0.2 | Solidity, `.sol` (a stream parser, adapted like tier 2) | MIT, Sergei Chestakov / Replit | 8 KB |
| `@fazelstudio/codemirror-lang-prisma` 0.2.0 | Prisma, `.prisma` | MIT, Zulfazli (fazel-studio) | 11 KB |
| `@codincod/codemirror-lang-assembly` 0.3.0 | Assembly, `.s` `.asm` `.z80` (one grammar for 8080/Z80, NASM/MASM/FASM, GNU as in both syntaxes, 68000, ARM/AArch64, 6502, MIPS, RISC-V, PDP-8, IBM 360; replaces the legacy `gas` and `z80` modes since 2026-09-07) | MIT, reeven (codeberg.org/reeven) | 13 KB |

Not bundled, and why: `cm6-graphql` depends on the `graphql` reference implementation and `graphql-language-service` (close to a megabyte) for schema-aware editing this plugin does not do; GraphQL files get this plugin's own keyword mode (`src/highlight/graphqlMode.ts`) instead.

## Test fixtures (not bundled)

`tests/fixtures/palettes/` holds real theme files the palette converters are tested against; none of them enters `main.js`. `one-dark.js` is `@codemirror/theme-one-dark` 6.1.3 (MIT, Marijn Haverbeke and others); `dracula.js` is from `thememirror` 2.0.1 (MIT, Vadim Demedes); `github.js` is `@uiw/codemirror-theme-github` 4.25.11 (MIT, uiw); `Obsidian.xml` is the Notepad++ theme of that name (GPL-3.0, Notepad++ contributors). Sources and versions are in the folder's README.

## Converted at build time: Notepad++ keyword tables (tier 4)

`src/highlight/langs.generated.ts` is produced by `scripts/convert-langs-model.mjs` from Notepad++'s `langs.model.xml` (Notepad++ 8.7.5, file dated 2024-08-31, read 2026-09-05): for 27 languages no bundled grammar covers, the extensions, the comment syntax and the keyword sets (`instre1`, `instre2`, `type1`...), about 93 KB in `main.js`. Notepad++ is GPL-3.0 (Copyright Don Ho and contributors, https://github.com/notepad-plus-plus/notepad-plus-plus); this plugin is GPL-3.0-only, so the tables are redistributable here, and they live under `src/highlight/`, never under the MIT directories (ADR-002). `docs/languages/hollywood.json` is the Hollywood table from the same file, converted to the vault's JSON shape as an example rather than bundled.

## Shipped in the repository, never in the bundle: prettier (the formatter you install by hand)

`formatters/prettier/` holds prettier's own `standalone.js` and eight of its plugin files (`babel`, `estree`, `typescript`, `postcss`, `html`, `markdown`, `yaml`, `graphql`), unmodified, 2.3 MB in all, under the MIT licence in `formatters/prettier/LICENSE`, the version and the per-file hashes in `formatters/prettier/manifest.json` (3.9.8 today; the folder name stays unversioned so nothing has to be rewritten when it changes) (Copyright © James Long and contributors, https://prettier.io). They are NOT a dependency of this plugin: `package.json` does not name prettier, `main.js` contains none of it, and nothing is ever downloaded. A user who wants full formatting copies the files they need into `<vault>/.obsidian/plugins/native-file-editor/formatters/`, where the plugin reads and evaluates them when Format is pressed and keeps nothing afterwards; each file is identified by the SHA-256 of the exact text that runs, against the hashes in `src/fmt/prettierFiles.ts`. The reasoning and the limits are in `docs/ADR-005-formatter-from-the-plugin-folder.md`, the instructions in `formatters/README.md`.

`formatters/extra/` holds five community prettier plugins, each bundled into one self-contained file by `scripts/build-formatter.mjs` (esbuild, with two-line `fs` and `path` shims, the prettier engine left external): `php.js` from `@prettier/plugin-php` 0.25.0 (MIT), `xml.js` from `@prettier/plugin-xml` 3.4.2 (MIT), `nginx.js` from `prettier-plugin-nginx` 2.0.0 (MIT), `properties.js` from `prettier-plugin-properties` 0.3.1 (MIT), `ini.js` from `prettier-plugin-ini` 1.3.0 (MIT). `formatters/extra/manifest.json` names the package, the version and the SHA-256 of every one. They are not dependencies either: nothing in `package.json`, nothing in `main.js`, and the user copies what they want into the plugin's folder.

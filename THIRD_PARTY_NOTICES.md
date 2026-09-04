# Third-party notices

Everything that ends up inside `main.js` and is not this plugin's own code is listed here with its licence. `package.json` declares no runtime dependencies; what follows is bundled at build time and moves only with a release. Everything listed is MIT-licensed, which is redistributable inside a GPL-3.0-only work. The full MIT licence text is in each package's `LICENSE` file under `node_modules/`, and it reads: permission is granted to use, copy, modify and distribute, provided the copyright notice and the permission notice are included; the software is provided as is, without warranty.

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

## Converted at build time

Nothing yet. The keyword tables converted from Notepad++ `langs.model.xml` (GPL-3.0) will be listed here when `scripts/` gains the converter, with the source file and the Notepad++ release it was read from.

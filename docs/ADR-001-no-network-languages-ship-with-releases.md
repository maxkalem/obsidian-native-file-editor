# ADR-001: No network at runtime; languages, themes and palettes ship with releases

Status: accepted, 2026-09-04.

## Decision

The plugin never makes a network request. Language modes, themes and palettes are bundled at build time or read from local files; nothing is fetched or installed after the plugin is installed.

## Why

Obsidian's developer policy lists, under "Not allowed", plugins that install or update themselves or their dependencies. A language mode fetched from codemirror.net or a theme fetched from thememirror.net is executable JavaScript and a dependency, so a self-updating language list would be a policy violation. Network use as such is allowed when disclosed; this plugin goes further and declares none at all, because "no network, ever" is the promise that separates it from every other Office plugin.

## Consequences

- Coverage is decided at build time. A language outside the bundled set falls to the keyword-based fallback tokenizer; adding a grammar means a release.
- Obsidian loads `main.js` as one script with no code splitting, so every bundled language is parsed at every start. The build prints a per-package size report (`npm run size`) so the trade is visible in every release rather than argued about.
- A language can still arrive without a release as data: a JSON definition in the vault's language folder, read by the generic tokenizer. Data, not code, so nothing is executed and nothing is downloaded.
- `@codemirror/language-data` looks lazy (each language behind a `load()` with a dynamic import) and is not, once esbuild has inlined those imports into one CommonJS bundle. It is not used.

## Rejected

Generating language files into the plugin folder on first run, to reduce resident memory. The generator must contain what it generates, so the tables live in `main.js` as strings, and the engine retains the script's source text for as long as the module is alive; writing those strings to disk makes a second copy and frees nothing. A lezer grammar is also not pure data (external tokenizers, specializers and prop sources are JavaScript), and a plugin writing into its own folder on every start reads to a reviewer as a plugin modifying itself.

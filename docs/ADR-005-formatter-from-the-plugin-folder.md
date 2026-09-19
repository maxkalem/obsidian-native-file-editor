# ADR-005: a formatter the user installs into the plugin folder

Status: accepted 2026-09-19. Supersedes the rule "no code from the vault is ever executed" as it was stated for palettes, and narrows it to what it was really protecting.

## The question

Format has to work on every language a person actually writes, and the cheap universal formatter — CodeMirror's `indentRange` — only fixes indentation. Measured over the 171 code fixtures (ledger, 2026-09-19): of the 113 samples with real indentation it restores 40 exactly, 9 within two lines, and for 64 it does nothing useful. Everything beyond that (spacing, line breaks, quotes, wrapping) needs a real formatter, and the real formatters are big: prettier's full set is 2.29 MB minified, its JavaScript-only subset 615 KB, against a `main.js` of 1.69 MB.

Three ways were measured and put to the user: bundle a library, run the user's own installed formatter through the Run mechanism (ADR-004), or let the user install the formatter into the plugin's folder and load it when it is needed.

## The decision

The plugin depends on no formatter library, bundles none, and downloads none. A user who wants full formatting copies prettier's standalone file into the plugin's folder by hand; the repository carries the file and the instructions. When the file is there, Format uses it. When it is not, Format is what it was: indentation and the plugin's own small formatters. The file is read and evaluated when Format is pressed, and nothing of it is kept between calls. The same on the desktop and on the phone.

## Where the files go, and how they are checked (decided 2026-09-19 after the user asked what an attacker could do)

`.obsidian/plugins/native-file-editor/formatters/`, a fixed path that no setting can move, holding files with names from a list this plugin knows: `standalone.js` and one plugin file per language family (`babel.js`, `estree.js`, `typescript.js`, `postcss.js`, `html.js`, `markdown.js`, `yaml.js`, `graphql.js`). Prettier's own distribution is already split that way, so a person who only formats CSS copies two files of 237 KB instead of 2.3 MB, and each file says for itself which languages it serves (`getSupportInfo` with the loaded plugins answers "JavaScript, JSX, TypeScript, JSON …").

The palette, language and dictionary folders do NOT take part: their paths are chosen in settings and can point anywhere in the vault, including a folder shared with other people, and they are meant for data. A `.js` there is never executed.

Each file is read once into a string, that string is hashed with SHA-256, the hash is compared with the manifest compiled into `main.js` (and with the hashes the user has confirmed, kept in `data.json`), and the SAME string is then evaluated. Hashing after the read and evaluating the hashed text leaves no window between the check and the use; hashing all 2.27 MB of prettier costs 5 ms. A file whose hash is in neither list is not executed: the notice names the file and its hash and offers "I put this there myself", which records that hash in `data.json`. A later silent change is refused again.

What the hash does not do, and the user asked exactly this: it does not stop the person from putting a modified prettier there and confirming it. Nothing can — and nothing needs to, because whoever can write to the plugin's folder can also rewrite `main.js` itself, which Obsidian evaluates at every start. That is why the formatters live in THAT folder and nowhere else: the trust boundary there is one Obsidian already draws.

## Why this is safe enough, and where its limit is

Obsidian already does exactly this with every plugin, on both platforms. Read out of the live `obsidian-1.13.7.asar`:

```js
r = await this.app.vault.adapter.read(manifest.dir + "/main.js");
u = window.eval("(function anonymous(require,module,exports){" + r + "\n})\n//# sourceURL=plugin:" + …);
u(requireShim, module, exports);
```

So a file in `.obsidian/plugins/<id>/` is code Obsidian itself evaluates, and the folder is already as trusted as the application. A formatter the user puts beside `main.js` is in the same place, under the same trust, loaded the same way.

Two things the first version of this ADR did not foresee, both measured on 2026-09-19 and both now part of the rule. A plugin file may ask for the engine that is already loaded — prettier's own plugins import `prettier/doc` for the printer primitives, and `@prettier/plugin-xml` and the INI plugin do nothing without it — so the `require` shim answers exactly three ids (`prettier`, `prettier/standalone`, `prettier/doc`) with what is already in memory and throws for everything else. And a file bundled from an ES module exports its plugin as `default`, which prettier does not unwrap, so the loader does, but only when that default declares `languages`, `parsers` or `printers`.

The community plugins are not prettier's own files, so the repository bundles each one itself with `scripts/build-formatter.mjs` (esbuild, `fs` and `path` replaced by two-line shims, the engine external) into `formatters/extra/`, whose `manifest.json` names the package, the version and the hash of each. That makes them ours to vouch for, which the hash list then does. What did not survive the attempt, and why, is written in that script's header: server-side plugins (Java, Shell, Solidity) need Node modules, TOML inlines a WebAssembly blob of 34.8 MB, and the Go-template plugin is written for prettier 2.

The limit that stays: only names from the list above, only in that fixed folder, never a path from a setting, never anything downloaded, and never a file whose hash nobody has approved. The palette, language and dictionary folders keep the old rule in full — a CodeMirror theme module there is still read as text and never executed, because those folders are meant for data and a person drops files into them without thinking about code.

Measured cost of the load (2.18 MB minified prettier, Node): parse 39 ms, module evaluation 18 ms, 7.2 MB of heap while it is loaded, +0.3 MB after the reference is dropped and the collector runs. Roughly 60 ms per Format, nothing held in between.

## What the community policy allows

Obsidian's developer policies forbid a plugin to "install or update themselves or their dependencies". So the plugin must not fetch prettier: no download button, no update check. It may say where the file goes, open the folder, and name the file it expects. The repository shipping the file is not the plugin installing it — the user copies it, as they copy a localization or a Hunspell dictionary.

## Consequences

- `docs/threat-model.md` names this one path explicitly and keeps the "no code from the vault" rule for every other folder.
- The instructions and the files live in the repository, in `formatters/prettier/` — **no version in the folder name**, because every instruction that named one would have to be rewritten at the next update; the version and the per-file hashes are in that folder's `manifest.json`, and the plugin's hash list names the version beside each entry. Entries in that list are never removed, so a plugin update never turns a user's installed copy into an unknown build. `THIRD_PARTY_NOTICES.md` carries prettier's MIT licence, because the repository now redistributes it.
- A user who does nothing gets the plugin exactly as it is today.

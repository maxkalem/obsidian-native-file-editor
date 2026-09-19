/**
 * The formatter files this plugin knows by name, and the builds it knows by
 * hash (ADR-005). Nothing here is bundled: these are the names it will look
 * for in `<plugin folder>/formatters/` and the SHA-256 of the copies the
 * repository ships, so a file that is one of those is recognised for certain
 * and a file that is not says so before anything runs.
 *
 * Prettier's distribution is already one file per language family, which is
 * why the folder works like the language definitions: a person who formats
 * only CSS copies `standalone.js` and `postcss.js` and nothing else.
 */

/** The fixed folder, inside the plugin's own folder. No setting moves it. */
export const FORMATTER_FOLDER = "formatters";

export interface KnownFile {
  /** The file name, exactly as prettier's package has it. */
  readonly name: string;
  /** What it is for, in the log and in the settings row. */
  readonly what: string;
  /** The extensions it lets Format serve, once `standalone.js` is there too. Empty for the engine and for a printer that serves no language on its own. */
  readonly extensions: readonly string[];
  /** Other files it cannot work without. */
  readonly needs: readonly string[];
}

/**
 * The engine and the language files. The extension lists are the ones
 * prettier's own `getSupportInfo()` reports for these plugins (measured
 * 2026-09-19 against 3.9.8); the loader asks it again at load time and logs
 * a line when the two disagree, so this table cannot rot silently.
 */
export const KNOWN_FILES: readonly KnownFile[] = [
  { name: "standalone.js", what: "the engine", extensions: [], needs: [] },
  { name: "estree.js", what: "the printer for JavaScript-like syntax", extensions: [], needs: ["standalone.js"] },
  // Not `jsonl`/`ndjson`: prettier has no parser for a line-per-record file,
  // and the plugin's own JSON formatter is what serves those (measured
  // 2026-09-19 with scripts/formatter-languages.mjs).
  { name: "babel.js", what: "JavaScript, JSX, JSON", extensions: ["js", "jsx", "mjs", "cjs", "json", "json5", "jsonc", "webmanifest", "geojson", "har"], needs: ["standalone.js", "estree.js"] },
  { name: "typescript.js", what: "TypeScript", extensions: ["ts", "tsx", "mts", "cts"], needs: ["standalone.js", "estree.js"] },
  { name: "postcss.js", what: "CSS, SCSS, Less", extensions: ["css", "scss", "less"], needs: ["standalone.js"] },
  { name: "html.js", what: "HTML, Vue", extensions: ["html", "htm", "vue"], needs: ["standalone.js"] },
  { name: "markdown.js", what: "Markdown", extensions: ["md", "markdown", "mdx"], needs: ["standalone.js"] },
  { name: "yaml.js", what: "YAML", extensions: ["yml", "yaml"], needs: ["standalone.js"] },
  { name: "graphql.js", what: "GraphQL", extensions: ["graphql", "gql"], needs: ["standalone.js"] },
  // Languages prettier itself does not cover: community plugins, each bundled
  // into one self-contained file by `scripts/build-formatter.mjs` and shipped
  // in `formatters/extra/`. The extension lists are what their own
  // `getSupportInfo()` reports (measured 2026-09-19), narrowed where a list
  // claimed an extension that belongs to something else (`.inc`, `.fcgi`,
  // `.properties` under INI, and XML's long tail of vendor formats).
  { name: "php.js", what: "PHP", extensions: ["php", "phtml", "php3", "php4", "php5", "phps", "phpt", "ctp"], needs: ["standalone.js"] },
  // Not `atom`: the plugin's linguist list has `.rss` and not `.atom`, so a
  // claim on it would offer Format and then find no parser.
  { name: "xml.js", what: "XML", extensions: ["xml", "xsd", "xsl", "xslt", "rss", "wsdl", "xul", "plist", "csproj", "vbproj", "props", "targets"], needs: ["standalone.js"] },
  { name: "nginx.js", what: "nginx configuration", extensions: ["nginx", "nginxconf", "vhost"], needs: ["standalone.js"] },
  { name: "properties.js", what: "Java properties", extensions: ["properties"], needs: ["standalone.js"] },
  { name: "ini.js", what: "INI and its kin", extensions: ["ini", "cfg", "cnf", "editorconfig", "gitconfig", "prefs"], needs: ["standalone.js"] },
  { name: "liquid.js", what: "Liquid templates", extensions: ["liquid"], needs: ["standalone.js"] },
  { name: "gherkin.js", what: "Gherkin (Cucumber)", extensions: ["feature"], needs: ["standalone.js"] },
  // Svelte's plugin leans on prettier's own babel, estree and postcss, and
  // says so by requiring `prettier/plugins/...`; the loader answers those
  // three ids with the files listed here, which is why they are `needs`.
  { name: "svelte.js", what: "Svelte", extensions: ["svelte"], needs: ["standalone.js", "estree.js", "babel.js", "postcss.js"] },
  // The Jinja plugin hands the HTML around its tags to prettier's html
  // plugin; without it the expressions come back as placeholders.
  { name: "jinja.js", what: "Jinja, Django and Nunjucks templates", extensions: ["jinja", "jinja2", "j2"], needs: ["standalone.js", "html.js"] },
  { name: "sql.js", what: "SQL and its dialects", extensions: ["sql", "mysql", "pgsql", "hql", "cql", "pls", "plsql", "prc", "tab", "udf", "viw"], needs: ["standalone.js"] },
];

export function knownFile(name: string): KnownFile | null {
  return KNOWN_FILES.find((f) => f.name === name) ?? null;
}

/**
 * Every build this plugin recognises without asking, hash -> what it is.
 *
 * Two rules keep this list honest. **Entries are never removed**: when the
 * repository ships a newer prettier, the older hashes stay, so a user who
 * copied the previous files does not meet a dialog after updating the plugin.
 * And **the version lives here, not in a folder name**: the repository's
 * folder is `formatters/prettier/` whatever version is in it (its
 * `manifest.json` says which), so no instruction, script or check-note has to
 * be rewritten when prettier moves on.
 *
 * A build that is in neither this list nor the user's own confirmations is
 * not executed until the user says they put it there; the plugin then logs
 * the version the file reports of itself.
 */
export const KNOWN_HASHES: Readonly<Record<string, string>> = {
  // prettier 3.9.8, shipped in formatters/prettier/ since 2026-09-19.
  "5249a89653aae718f7a0fb94577a09768f18b865df832cfe68d8158c8207af5c": "prettier 3.9.8 babel.js",
  "7af7b9e59af8113e22d9b25653a760c372fa8d7c04e9adf67d0037c6ebf862b4": "prettier 3.9.8 estree.js",
  b0faef34893f8033b9adeaad048f4cec9456e95baa05f97b51f8315a5a504fec: "prettier 3.9.8 graphql.js",
  abb63e0b690ac15f0f8dc4aad63a2fcb9194892998c67714dc57b7d3257c0b46: "prettier 3.9.8 html.js",
  "2a906852e32d883409987adda1929b0932875f6784b3974a24fd15044a164bd4": "prettier 3.9.8 markdown.js",
  "8dd23dad68a8bb34d304e04b2b6493c187150dbaebdfb5b54061007f430e5058": "prettier 3.9.8 postcss.js",
  "83605683742650f8460cb9fbc4036bd880b6d7b06f461c9fc14fa2ce981b85ee": "prettier 3.9.8 standalone.js",
  ad4ede6b3d28fd1ffa37bebcb6a9e7ab9db0dc045d16d0c65eb65496660f91f0: "prettier 3.9.8 typescript.js",
  "48bbba2bad5d666425fc5b435ab80083c6a77825d614e9a72ff5e9bbb8d428bc": "prettier 3.9.8 yaml.js",
  // The community plugins, bundled by scripts/build-formatter.mjs on
  // 2026-09-19 and shipped in formatters/extra/ (see that folder's manifest).
  "6ddfb8eac6bde004f30948760d35c6878ed91b9b7e75a3e883a020ee5d83bdfb": "@prettier/plugin-php 0.25.0 php.js",
  "47adc8d96f288148b0584c7a22a91989d9d13833bfc432ab9b516772ec67fe23": "@prettier/plugin-xml 3.4.2 xml.js",
  "6612b7b4bf672ad3a42fead504b9fbacc7aaed753ddf7869eba52868737b21f3": "prettier-plugin-nginx 2.0.0 nginx.js",
  "13a68205fc90636b27d2d072ab1f5f41872f39bb4341c2a818e7e1288d0c3b59": "prettier-plugin-properties 0.3.1 properties.js",
  "54ef1f45802a337b960a1f9b7bd3f0fa2f527c1853a7a3a02294e1037bd39362": "prettier-plugin-ini 1.3.0 ini.js",
  "3c90821c4529f8604d840e4cabd2c21256ebc7cad77626fffe7a50d23bb4168e": "@shopify/prettier-plugin-liquid 1.9.3 liquid.js",
  "55fcf3337e9c15deeff889fd463acc7b405641942035e275fb8e2842e15d27ed": "prettier-plugin-gherkin 3.1.2 gherkin.js",
  "1e29ee89d582c7ca11e0565ec8e70babd60c3bee64d380858159576a331c6a88": "prettier-plugin-svelte 3.4.0 svelte.js",
  "0130158764fd27f6b356fcabdab74dc2cc2ac8e55197993f2e83a814bfb8852a": "prettier-plugin-jinja-template 2.1.0 jinja.js",
  "933b8c977eabc44180b092971b5552fe3326a28dbfe740a9852465e6ef026d8f": "prettier-plugin-sql 0.20.0 sql.js",
};

/**
 * Which files have to be present for an extension, and what is missing. The
 * menu asks this with nothing but the folder's file names, so the code is
 * read only when Format is actually pressed.
 */
/** The files that WOULD serve this extension, whether or not they are installed. Null when nothing this plugin knows can format it. */
export function couldServe(extension: string): { readonly files: readonly string[]; readonly what: string } | null {
  const ext = extension.toLowerCase();
  const entry = KNOWN_FILES.find((f) => f.extensions.includes(ext));
  if (!entry) return null;
  return { files: [...new Set([...entry.needs, entry.name])], what: entry.what };
}

export function filesForExtension(extension: string, present: ReadonlySet<string>): { readonly files: readonly string[]; readonly missing: readonly string[] } | null {
  const ext = extension.toLowerCase();
  const entry = KNOWN_FILES.find((f) => f.extensions.includes(ext));
  if (!entry) return null;
  const files = [...new Set([...entry.needs, entry.name])];
  return { files, missing: files.filter((name) => !present.has(name)) };
}

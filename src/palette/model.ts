import { TOKEN_CLASSES } from "../highlight/tokenTable";

/**
 * A palette, whatever file it came from, is a list of rules: selectors
 * relative to the editor host (`.cm-keyword`, `.cm-editor`, `.cm-gutters`)
 * and plain CSS declarations. render.ts turns that into CSS scoped under the
 * plugin's own editor; nothing here knows about the DOM or about files.
 */
export type ThemeVariant = "light" | "dark";

export interface PaletteRule {
  /** Selectors relative to the editor host, each one complete on its own. */
  readonly selectors: readonly string[];
  /** CSS property (kebab-case) -> value, both already validated by the parser. */
  readonly declarations: Readonly<Record<string, string>>;
  /** Set when the rule belongs to one of a file's light/dark variants: it then applies only under Obsidian's matching theme. */
  readonly variant?: ThemeVariant;
}

export interface Palette {
  readonly rules: readonly PaletteRule[];
  /** What the parser skipped and why, for the log. */
  readonly notes: readonly string[];
}

/**
 * The editor's own colours, in one vocabulary for every source: thememirror
 * and @uiw `createTheme` settings, `EditorView.theme` blocks and Notepad++
 * GlobalStyles all land here before becoming rules.
 */
export interface ChromeSettings {
  background?: string;
  foreground?: string;
  caret?: string;
  selection?: string;
  selectionMatch?: string;
  lineHighlight?: string;
  gutterBackground?: string;
  gutterForeground?: string;
  gutterActiveForeground?: string;
  gutterBorder?: string;
  matchingBracket?: string;
  fontFamily?: string;
}

export const CHROME_KEYS: ReadonlyArray<keyof ChromeSettings> = [
  "background",
  "foreground",
  "caret",
  "selection",
  "selectionMatch",
  "lineHighlight",
  "gutterBackground",
  "gutterForeground",
  "gutterActiveForeground",
  "gutterBorder",
  "matchingBracket",
  "fontFamily",
];

/** Chrome settings to rules on the CodeMirror elements the plugin builds. */
export function chromeRules(s: ChromeSettings, variant?: ThemeVariant): PaletteRule[] {
  const out: PaletteRule[] = [];
  const add = (selectors: string[], declarations: Record<string, string | undefined>) => {
    const clean: Record<string, string> = {};
    for (const [k, v] of Object.entries(declarations)) if (v !== undefined) clean[k] = v;
    if (Object.keys(clean).length > 0) out.push(variant ? { selectors, declarations: clean, variant } : { selectors, declarations: clean });
  };
  add([".cm-editor"], { "background-color": s.background, color: s.foreground });
  add([".cm-scroller"], { "font-family": s.fontFamily });
  add([".cm-cursor", ".cm-dropCursor"], { "border-left-color": s.caret });
  add([".cm-selectionBackground", ".cm-focused .cm-selectionBackground", ".cm-content ::selection"], { "background-color": s.selection });
  add([".cm-selectionMatch"], { "background-color": s.selectionMatch });
  add([".cm-activeLine", ".cm-activeLineGutter"], { "background-color": s.lineHighlight });
  add([".cm-gutters"], { "background-color": s.gutterBackground, color: s.gutterForeground, "border-right-color": s.gutterBorder });
  add([".cm-activeLineGutter"], { color: s.gutterActiveForeground });
  add([".cm-matchingBracket"], { "background-color": s.matchingBracket });
  return out;
}

/**
 * Token roles: the vocabulary Notepad++ style names are mapped onto. Each role
 * names the classes a token of that kind carries. On Obsidian's forked stream
 * modes a token has only its `cm-*` class, on lezer grammars both, so every
 * role lists the `cm-*` class first and the plugin's own `nfe-tok-*` class
 * where the `cm-*` one is shared by several roles.
 */
export type TokenRole =
  | "comment"
  | "docComment"
  | "keyword"
  | "string"
  | "regexp"
  | "escape"
  | "number"
  | "operator"
  | "punctuation"
  | "type"
  | "function"
  | "builtin"
  | "variable"
  | "property"
  | "meta"
  | "tag"
  | "attribute"
  | "atom"
  | "label"
  | "invalid"
  | "link"
  | "heading"
  | "inserted"
  | "deleted"
  | "changed";

export const ROLE_SELECTORS: Readonly<Record<TokenRole, readonly string[]>> = {
  comment: [".cm-comment", ".nfe-tok-comment"],
  docComment: [".nfe-tok-doc"],
  keyword: [".cm-keyword", ".nfe-tok-keyword"],
  string: [".cm-string", ".nfe-tok-string"],
  regexp: [".cm-string-2", ".nfe-tok-regexp"],
  escape: [".nfe-tok-escape"],
  number: [".cm-number", ".nfe-tok-number"],
  operator: [".cm-operator", ".nfe-tok-operator"],
  punctuation: [".cm-punctuation", ".cm-bracket", ".nfe-tok-punctuation"],
  type: [".cm-type", ".nfe-tok-type"],
  function: [".cm-def", ".nfe-tok-function"],
  builtin: [".cm-builtin", ".nfe-tok-builtin"],
  variable: [".cm-variable", ".cm-variable-2", ".cm-variable-3", ".nfe-tok-variable"],
  property: [".cm-property", ".nfe-tok-property"],
  meta: [".cm-meta", ".nfe-tok-meta", ".nfe-tok-preproc"],
  tag: [".cm-tag", ".nfe-tok-tag"],
  attribute: [".cm-attribute", ".nfe-tok-attribute"],
  atom: [".cm-atom", ".nfe-tok-constant", ".nfe-tok-value"],
  label: [".nfe-tok-label"],
  invalid: [".cm-error", ".nfe-tok-invalid"],
  link: [".cm-link", ".cm-url", ".nfe-tok-link"],
  heading: [".cm-header", ".nfe-tok-heading"],
  inserted: [".cm-positive", ".nfe-tok-inserted"],
  deleted: [".cm-negative", ".nfe-tok-deleted"],
  changed: [".cm-qualifier", ".nfe-tok-changed"],
};

/**
 * The `cm-*` class whose first row in the token table this is. A `cm-*` class
 * shared by several rows (cm-def for functions and definitions, cm-atom for
 * every constant) is addressed only by its canonical row; the other rows
 * reach their tokens through their `nfe-tok-*` classes, so two rules for two
 * tags never fight over one `cm-*` selector.
 */
const CANONICAL_CM_ROW: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const row of TOKEN_CLASSES) {
    const cm = row.class.split(" ").find((c) => c.startsWith("cm-"));
    if (cm && !m.has(cm)) m.set(cm, String(row.tag));
  }
  return m;
})();

const CLASSES_BY_TAG_NAME: ReadonlyMap<string, string> = new Map(TOKEN_CLASSES.map((row) => [String(row.tag), row.class]));

/**
 * Selectors for one lezer tag name (`keyword`, `function(variableName)`), or
 * null when the token table has no row for it. The `cm-*` class is included
 * only for the tag's canonical row; the `nfe-tok-*` classes of the row form one
 * compound selector, so a row with two of them (`definition(variableName)`:
 * `nfe-tok-variable nfe-tok-definition`) matches only tokens carrying both.
 */
export function selectorsForTagName(tagName: string): string[] | null {
  const classes = CLASSES_BY_TAG_NAME.get(tagName);
  if (classes === undefined) return null;
  const parts = classes.split(" ");
  const out: string[] = [];
  const cm = parts.find((c) => c.startsWith("cm-"));
  if (cm && CANONICAL_CM_ROW.get(cm) === tagName) out.push(`.${cm}`);
  const nfe = parts.filter((c) => c.startsWith("nfe-tok-"));
  if (nfe.length > 0) out.push(nfe.map((c) => `.${c}`).join(""));
  return out.length > 0 ? out : null;
}

/** Every tag name the token table knows, for parsers that need to expand a parent tag. */
export function knownTagNames(): string[] {
  return [...CLASSES_BY_TAG_NAME.keys()];
}

/**
 * Lezer tags the token table does not name, and what they stand for here.
 * A parent tag (`name`) expands to every child the table knows; a sibling
 * with no row of its own (`character`, `paren`) is treated as its nearest
 * relative. Read from @lezer/highlight's tag list, 2026-09-05.
 */
export const TAG_EQUIVALENTS: Readonly<Record<string, readonly string[]>> = {
  name: ["variableName", "propertyName", "typeName", "className", "namespace", "labelName", "attributeName", "tagName", "macroName"],
  character: ["string"],
  integer: ["number"],
  float: ["number"],
  separator: ["punctuation"],
  paren: ["bracket"],
  brace: ["bracket"],
  squareBracket: ["bracket"],
  angleBracket: ["bracket"],
  annotation: ["meta"],
  self: ["variableName"],
  definitionKeyword: ["keyword"],
  moduleKeyword: ["keyword"],
  operatorKeyword: ["keyword"],
  typeOperator: ["operator"],
  compareOperator: ["operator"],
  arithmeticOperator: ["operator"],
  logicOperator: ["operator"],
  bitwiseOperator: ["operator"],
  updateOperator: ["operator"],
  definitionOperator: ["operator"],
  derefOperator: ["operator"],
  controlOperator: ["operator"],
  documentMeta: ["meta"],
  lineComment: ["comment"],
  blockComment: ["comment"],
  special: [],
};

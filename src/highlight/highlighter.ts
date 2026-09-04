import type { Language } from "@codemirror/language";
import { type Highlighter, type Tag, highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";

/**
 * One highlighter for every language source: lezer grammars and stream modes
 * both emit lezer highlight tags, and this maps each tag to a stable
 * `nfe-tok-*` class. No CodeMirror theme object exists anywhere; styles.css
 * binds these classes to Obsidian's `--code-*` variables, so a theme that sets
 * those already restyles the editor, and a palette is a plain CSS file.
 *
 * The table is the vocabulary a palette can address. Order matters only where
 * one tag is a modifier of another: `tagHighlighter` walks each tag's set from
 * the most specific form outwards and takes the first class it finds, so
 * `function(variableName)` lands on `nfe-tok-function` and a bare
 * `variableName` on `nfe-tok-variable`.
 */
export const TOKEN_CLASSES: ReadonlyArray<{ readonly tag: Tag; readonly class: string }> = [
  { tag: t.comment, class: "nfe-tok-comment" },
  { tag: t.docComment, class: "nfe-tok-comment nfe-tok-doc" },
  { tag: t.keyword, class: "nfe-tok-keyword" },
  { tag: t.controlKeyword, class: "nfe-tok-keyword nfe-tok-control" },
  { tag: t.modifier, class: "nfe-tok-keyword nfe-tok-modifier" },
  { tag: t.atom, class: "nfe-tok-constant" },
  { tag: t.bool, class: "nfe-tok-constant nfe-tok-bool" },
  { tag: t.null, class: "nfe-tok-constant nfe-tok-null" },
  { tag: t.unit, class: "nfe-tok-constant" },
  { tag: t.literal, class: "nfe-tok-value" },
  { tag: t.number, class: "nfe-tok-number" },
  { tag: t.string, class: "nfe-tok-string" },
  { tag: t.docString, class: "nfe-tok-string nfe-tok-doc" },
  { tag: t.special(t.string), class: "nfe-tok-string nfe-tok-special" },
  { tag: t.regexp, class: "nfe-tok-regexp" },
  { tag: t.escape, class: "nfe-tok-escape" },
  { tag: t.color, class: "nfe-tok-value" },
  { tag: t.url, class: "nfe-tok-link" },
  { tag: t.link, class: "nfe-tok-link" },
  { tag: t.variableName, class: "nfe-tok-variable" },
  { tag: t.definition(t.variableName), class: "nfe-tok-variable nfe-tok-definition" },
  { tag: t.special(t.variableName), class: "nfe-tok-variable nfe-tok-special" },
  { tag: t.constant(t.variableName), class: "nfe-tok-constant" },
  { tag: t.standard(t.variableName), class: "nfe-tok-builtin" },
  { tag: t.function(t.variableName), class: "nfe-tok-function" },
  { tag: t.function(t.definition(t.variableName)), class: "nfe-tok-function nfe-tok-definition" },
  { tag: t.propertyName, class: "nfe-tok-property" },
  { tag: t.definition(t.propertyName), class: "nfe-tok-property nfe-tok-definition" },
  { tag: t.function(t.propertyName), class: "nfe-tok-function" },
  { tag: t.attributeName, class: "nfe-tok-attribute" },
  { tag: t.typeName, class: "nfe-tok-type" },
  { tag: t.className, class: "nfe-tok-type" },
  { tag: t.namespace, class: "nfe-tok-namespace" },
  { tag: t.tagName, class: "nfe-tok-tag" },
  { tag: t.labelName, class: "nfe-tok-label" },
  { tag: t.macroName, class: "nfe-tok-preproc" },
  { tag: t.operator, class: "nfe-tok-operator" },
  { tag: t.punctuation, class: "nfe-tok-punctuation" },
  { tag: t.bracket, class: "nfe-tok-punctuation nfe-tok-bracket" },
  { tag: t.meta, class: "nfe-tok-meta" },
  { tag: t.processingInstruction, class: "nfe-tok-preproc" },
  { tag: t.heading, class: "nfe-tok-heading" },
  { tag: t.contentSeparator, class: "nfe-tok-separator" },
  { tag: t.list, class: "nfe-tok-list" },
  { tag: t.quote, class: "nfe-tok-quote" },
  { tag: t.emphasis, class: "nfe-tok-emphasis" },
  { tag: t.strong, class: "nfe-tok-strong" },
  { tag: t.strikethrough, class: "nfe-tok-strikethrough" },
  { tag: t.monospace, class: "nfe-tok-monospace" },
  { tag: t.inserted, class: "nfe-tok-inserted" },
  { tag: t.deleted, class: "nfe-tok-deleted" },
  { tag: t.changed, class: "nfe-tok-changed" },
  { tag: t.invalid, class: "nfe-tok-invalid" },
];

export const nfeHighlighter: Highlighter = tagHighlighter(TOKEN_CLASSES);

/** Every distinct class the highlighter can emit, for the styles test and for palette authors. */
export function tokenClassNames(): string[] {
  const out = new Set<string>();
  for (const e of TOKEN_CLASSES) for (const c of e.class.split(" ")) out.add(c);
  return [...out].sort();
}

export interface PreviewToken {
  readonly text: string;
  /** Space-separated classes, or null for text with no token class. */
  readonly classes: string | null;
}

/**
 * Tokens for a static rendering of `text` in `language`, one entry per run of
 * text with the same classes, with `"\n"` entries for line breaks. This is what
 * the preview renders from: it parses once and never builds an editor.
 */
export function tokenizeForPreview(text: string, language: Language): PreviewToken[] {
  const tree = language.parser.parse(text);
  const out: PreviewToken[] = [];
  highlightCode(
    text,
    tree,
    nfeHighlighter,
    (code, classes) => out.push({ text: code, classes: classes === "" ? null : classes }),
    () => out.push({ text: "\n", classes: null })
  );
  return out;
}

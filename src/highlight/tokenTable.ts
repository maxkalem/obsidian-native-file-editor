import { type Tag, tags as t } from "@lezer/highlight";

/**
 * The token table: one row per lezer highlight tag, with Obsidian's `cm-*`
 * class and this plugin's `nfe-tok-*` class. Its own module because both the
 * highlighter and the Obsidian-fork adapter read it.
 */
/**
 * One highlighter for every language source: lezer grammars and stream modes
 * both emit lezer highlight tags, and this maps each tag to two classes on the
 * same span.
 *
 * The first is Obsidian's own: the `cm-*` names Obsidian gives tokens in its
 * Live Preview code blocks (the CodeMirror 5 vocabulary: `cm-keyword`,
 * `cm-string`, `cm-atom`, `cm-def`, `cm-variable-2`, ...). Obsidian's
 * stylesheet colours them under `.cm-s-obsidian`, every community theme
 * restyles them, so a `.ts` file here looks exactly like a ```ts block in a
 * note, in any theme, with no colour rule of this plugin's.
 *
 * The second is this plugin's stable `nfe-tok-*` name, the vocabulary a
 * palette addresses. styles.css binds a few of them that Obsidian has no
 * class for (diff insertions and deletions, log warnings) and leaves the
 * rest to Obsidian. No CodeMirror theme object exists anywhere.
 *
 * The highlighter walks each tag's set from the most specific form outwards
 * and takes the first row it finds, so `function(variableName)` lands on
 * `cm-def nfe-tok-function` and a bare `variableName` on `cm-variable
 * nfe-tok-variable`.
 */
export const TOKEN_CLASSES: ReadonlyArray<{ readonly tag: Tag; readonly class: string }> = [
  { tag: t.comment, class: "cm-comment nfe-tok-comment" },
  { tag: t.docComment, class: "cm-comment nfe-tok-comment nfe-tok-doc" },
  { tag: t.keyword, class: "cm-keyword nfe-tok-keyword" },
  { tag: t.controlKeyword, class: "cm-keyword nfe-tok-keyword nfe-tok-control" },
  { tag: t.modifier, class: "cm-keyword nfe-tok-keyword nfe-tok-modifier" },
  { tag: t.atom, class: "cm-atom nfe-tok-constant" },
  { tag: t.bool, class: "cm-atom nfe-tok-constant nfe-tok-bool" },
  { tag: t.null, class: "cm-atom nfe-tok-constant nfe-tok-null" },
  { tag: t.unit, class: "cm-atom nfe-tok-constant" },
  { tag: t.literal, class: "cm-atom nfe-tok-value" },
  { tag: t.number, class: "cm-number nfe-tok-number" },
  { tag: t.string, class: "cm-string nfe-tok-string" },
  { tag: t.docString, class: "cm-string nfe-tok-string nfe-tok-doc" },
  { tag: t.special(t.string), class: "cm-string-2 nfe-tok-string nfe-tok-special" },
  { tag: t.regexp, class: "cm-string-2 nfe-tok-regexp" },
  { tag: t.escape, class: "cm-string-2 nfe-tok-escape" },
  { tag: t.color, class: "cm-atom nfe-tok-value" },
  { tag: t.url, class: "cm-url nfe-tok-link" },
  { tag: t.link, class: "cm-link nfe-tok-link" },
  { tag: t.variableName, class: "cm-variable nfe-tok-variable" },
  { tag: t.definition(t.variableName), class: "cm-def nfe-tok-variable nfe-tok-definition" },
  { tag: t.special(t.variableName), class: "cm-variable-2 nfe-tok-variable nfe-tok-special" },
  { tag: t.local(t.variableName), class: "cm-variable-2 nfe-tok-variable" },
  { tag: t.constant(t.variableName), class: "cm-atom nfe-tok-constant" },
  { tag: t.standard(t.variableName), class: "cm-builtin nfe-tok-builtin" },
  { tag: t.function(t.variableName), class: "cm-def nfe-tok-function" },
  { tag: t.function(t.definition(t.variableName)), class: "cm-def nfe-tok-function nfe-tok-definition" },
  { tag: t.propertyName, class: "cm-property nfe-tok-property" },
  { tag: t.definition(t.propertyName), class: "cm-property nfe-tok-property nfe-tok-definition" },
  { tag: t.function(t.propertyName), class: "cm-def nfe-tok-function" },
  { tag: t.attributeName, class: "cm-attribute nfe-tok-attribute" },
  { tag: t.attributeValue, class: "cm-string nfe-tok-string" },
  { tag: t.typeName, class: "cm-type nfe-tok-type" },
  { tag: t.className, class: "cm-type nfe-tok-type" },
  { tag: t.namespace, class: "cm-variable-2 nfe-tok-namespace" },
  { tag: t.tagName, class: "cm-tag nfe-tok-tag" },
  { tag: t.labelName, class: "cm-variable-2 nfe-tok-label" },
  { tag: t.macroName, class: "cm-meta nfe-tok-preproc" },
  { tag: t.operator, class: "cm-operator nfe-tok-operator" },
  { tag: t.punctuation, class: "cm-punctuation nfe-tok-punctuation" },
  { tag: t.bracket, class: "cm-bracket nfe-tok-punctuation nfe-tok-bracket" },
  { tag: t.meta, class: "cm-meta nfe-tok-meta" },
  { tag: t.processingInstruction, class: "cm-meta nfe-tok-preproc" },
  { tag: t.heading, class: "cm-header nfe-tok-heading" },
  { tag: t.contentSeparator, class: "cm-hr nfe-tok-separator" },
  // The markdown grammar tags a whole list item `list` (the marker itself is a
  // processingInstruction); Obsidian's `cm-formatting-list` is its marker
  // colour, so the item's text stays plain and only a palette can address it.
  { tag: t.list, class: "nfe-tok-list" },
  { tag: t.quote, class: "cm-quote nfe-tok-quote" },
  { tag: t.emphasis, class: "cm-em nfe-tok-emphasis" },
  { tag: t.strong, class: "cm-strong nfe-tok-strong" },
  { tag: t.strikethrough, class: "cm-strikethrough nfe-tok-strikethrough" },
  { tag: t.monospace, class: "cm-inline-code nfe-tok-monospace" },
  { tag: t.inserted, class: "cm-positive nfe-tok-inserted" },
  { tag: t.deleted, class: "cm-negative nfe-tok-deleted" },
  { tag: t.changed, class: "cm-qualifier nfe-tok-changed" },
  { tag: t.invalid, class: "cm-error nfe-tok-invalid" },
];

/**
 * Obsidian colours its token classes only under `.cm-s-obsidian`, the class of
 * its own editor root; the preview `pre` and the editor root both carry it.
 */
export const OBSIDIAN_SCHEME_CLASS = "cm-s-obsidian";

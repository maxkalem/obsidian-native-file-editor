import { type Language, ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { type Highlighter, type Tag, highlightCode, tagHighlighter, tags as t } from "@lezer/highlight";

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
 * `tagHighlighter` walks each tag's set from the most specific form outwards
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
  { tag: t.list, class: "cm-formatting-list nfe-tok-list" },
  { tag: t.quote, class: "cm-quote nfe-tok-quote" },
  { tag: t.emphasis, class: "cm-em nfe-tok-emphasis" },
  { tag: t.strong, class: "cm-strong nfe-tok-strong" },
  { tag: t.strikethrough, class: "cm-strikethrough nfe-tok-strikethrough" },
  { tag: t.monospace, class: "cm-inline-code nfe-tok-monospace" },
  { tag: t.inserted, class: "cm-positive nfe-tok-inserted" },
  { tag: t.deleted, class: "cm-negative nfe-tok-deleted" },
  { tag: t.changed, class: "cm-meta nfe-tok-changed" },
  { tag: t.invalid, class: "cm-error nfe-tok-invalid" },
];

/**
 * Obsidian colours its token classes only under `.cm-s-obsidian`, the class of
 * its own editor root; the preview `pre` and the editor root both carry it.
 */
export const OBSIDIAN_SCHEME_CLASS = "cm-s-obsidian";

export const nfeHighlighter: Highlighter = tagHighlighter(TOKEN_CLASSES);

/** Every distinct `nfe-tok-*` class the highlighter can emit: the palette vocabulary. */
export function tokenClassNames(): string[] {
  const out = new Set<string>();
  for (const e of TOKEN_CLASSES) for (const c of e.class.split(" ")) if (/^nfe-tok-/.test(c)) out.add(c);
  return [...out].sort();
}

export interface PreviewToken {
  readonly text: string;
  /** Space-separated classes, or null for text with no token class. */
  readonly classes: string | null;
}

/** How long one preview parse may run before the preview falls back to plain text. */
export const PREVIEW_PARSE_TIMEOUT_MS = 5000;

/**
 * Tokens for a static rendering of `text` in `language`, one entry per run of
 * text with the same classes, with `"\n"` entries for line breaks, or null
 * when the parse did not finish in time. This is what the preview renders
 * from: it parses once and never builds an editor.
 *
 * The parse goes through an EditorState and `ensureSyntaxTree`, not through
 * `language.parser.parse(text)`. The direct call works with npm's
 * `@codemirror/language` and fails inside Obsidian's: its stream-mode parser
 * reads `context.viewport` without a null check when there is no parse
 * context, so every legacy mode threw `Cannot read properties of null
 * (reading 'viewport')` on the device (log, 2026-09-04) while lezer grammars
 * worked. `ensureSyntaxTree` is the API Obsidian itself uses and always has a
 * context.
 */
export function tokenizeForPreview(text: string, language: Language, timeoutMs = PREVIEW_PARSE_TIMEOUT_MS): PreviewToken[] | null {
  const state = EditorState.create({ doc: text, extensions: [language] });
  const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
  if (!tree) return null;
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

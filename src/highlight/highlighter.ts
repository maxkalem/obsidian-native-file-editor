import { type Language, ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { NodeType, SyntaxNode, Tree } from "@lezer/common";
import { type Highlighter, type Tag, highlightCode, tags as t } from "@lezer/highlight";

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

/**
 * Tag name -> classes. Tags are matched by NAME, never by object identity or
 * id: Obsidian's build carries more than one copy of `@lezer/highlight` (the
 * one inside its `@codemirror/language`, which stream modes use to tag their
 * tokens, and the one handed to plugins, which lezer grammars and this module
 * use). A `tagHighlighter` keyed on tag ids sees nothing on tokens tagged by
 * the other copy, which is how every stream-mode file previewed with two
 * tokens and no class on the device (log, 2026-09-04). Names are the one thing
 * both copies agree on: `tag.toString()` gives "keyword" or
 * "definition(variableName)" in either.
 */
const CLASS_BY_TAG_NAME: ReadonlyMap<string, string> = new Map(TOKEN_CLASSES.map((row) => [String(row.tag), row.class]));

/** The shape of a Tag from any copy of @lezer/highlight: a name and its set, most specific first. */
interface TagLike {
  readonly set: readonly TagLike[];
  toString(): string;
}

/** The shape of the rule `styleTags` attaches to a node type, from any copy. */
interface RuleLike {
  readonly tags: readonly TagLike[];
  /** Node-name context the rule applies in (`"Function/VariableDefinition"` style), or null for any. */
  readonly context?: readonly string[] | null;
  readonly next?: RuleLike | null;
}

function isTagLike(v: unknown): v is TagLike {
  return typeof v === "object" && v !== null && Array.isArray((v as { set?: unknown }).set);
}

function isRuleLike(v: unknown): v is RuleLike {
  return typeof v === "object" && v !== null && Array.isArray((v as { tags?: unknown }).tags) && (v as { tags: unknown[] }).tags.every(isTagLike);
}

/** Classes for a list of tags: for each tag the first name in its set that the table knows. */
export function classesForTags(tags: readonly TagLike[]): string | null {
  const out = new Set<string>();
  for (const tag of tags) {
    for (const sub of tag.set) {
      const cls = CLASS_BY_TAG_NAME.get(String(sub));
      if (cls !== undefined) {
        for (const c of cls.split(" ")) out.add(c);
        break;
      }
    }
  }
  return out.size === 0 ? null : [...out].join(" ");
}

export const nfeHighlighter: Highlighter = {
  style: (tags: readonly Tag[]) => classesForTags(tags),
};

/**
 * The style rule on a node type, found by shape rather than through
 * `getStyleTags`, which only sees rules attached with its own copy's NodeProp.
 */
export function ruleOf(type: NodeType): RuleLike | null {
  const props = (type as unknown as { props?: Record<string, unknown> }).props;
  if (!props) return null;
  for (const v of Object.values(props)) if (isRuleLike(v)) return v;
  return null;
}

/** The rule that applies to this node: the first in the chain whose context matches, as `getStyleTags` does. */
export function ruleFor(node: SyntaxNode): RuleLike | null {
  let rule = ruleOf(node.type);
  while (rule && rule.context && !node.matchContext(rule.context)) rule = rule.next ?? null;
  return rule;
}

/** Every distinct `nfe-tok-*` class the highlighter can emit: the palette vocabulary. */
export function tokenClassNames(): string[] {
  const out = new Set<string>();
  for (const e of TOKEN_CLASSES) for (const c of e.class.split(" ")) if (/^nfe-tok-/.test(c)) out.add(c);
  return [...out].sort();
}

export interface TextToken {
  readonly text: string;
  /** Space-separated classes, or null for text with no token class. */
  readonly classes: string | null;
}

/** How long one standalone parse may run before `tokenize` gives up. */
export const TOKENIZE_TIMEOUT_MS = 5000;

/**
 * Tokens of `text` in `language`, one entry per run of text with the same
 * classes, with `"\n"` entries for line breaks, or null when the parse did
 * not finish in time. The view does not use this (both of its modes are
 * CodeMirror instances, which highlight incrementally); the load-time
 * self-test and the test suites do, because it exercises the same parser and
 * the same highlighter outside an editor.
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
export function tokenize(text: string, language: Language, timeoutMs = TOKENIZE_TIMEOUT_MS): TextToken[] | null {
  const state = EditorState.create({ doc: text, extensions: [language] });
  const tree = ensureSyntaxTree(state, state.doc.length, timeoutMs);
  if (!tree) return null;
  const out: TextToken[] = [];
  highlightCode(
    text,
    tree,
    nfeHighlighter,
    (code, classes) => out.push({ text: code, classes: classes === "" ? null : classes }),
    () => out.push({ text: "\n", classes: null })
  );
  // `highlightCode` finds rules through its own copy's NodeProp. When the
  // tree was tagged by the other copy it styles nothing; then the tree is
  // walked here, reading the rules by shape.
  if (out.every((tok) => tok.classes === null) && treeHasRules(tree)) return paintByName(text, tree);
  return out;
}

/** Whether any node in the tree carries a style rule (by shape). Stops at the first. */
export function treeHasRules(tree: Tree): boolean {
  let found = false;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (ruleOf(node.type)) found = true;
      return !found;
    },
  });
  return found;
}

/**
 * The same output as `highlightCode`, produced by walking the tree and reading
 * each node's rule by shape: a run per stretch of text with the same classes,
 * inner nodes overriding outer ones, line breaks as their own tokens.
 */
export function paintByName(text: string, tree: Tree): TextToken[] {
  const out: TextToken[] = [];
  const emit = (from: number, to: number, classes: string | null) => {
    if (to <= from) return;
    const slice = text.slice(from, to);
    let start = 0;
    for (;;) {
      const nl = slice.indexOf("\n", start);
      if (nl === -1) break;
      if (nl > start) push(slice.slice(start, nl), classes);
      out.push({ text: "\n", classes: null });
      start = nl + 1;
    }
    if (start < slice.length) push(slice.slice(start), classes);
  };
  const push = (t: string, classes: string | null) => {
    const last = out[out.length - 1];
    if (last && last.classes === classes && last.text !== "\n") out[out.length - 1] = { text: last.text + t, classes };
    else out.push({ text: t, classes });
  };
  const walk = (node: SyntaxNode, inherited: string | null) => {
    const rule = ruleFor(node);
    const own = rule ? classesForTags(rule.tags) : null;
    const classes = own ?? inherited;
    let pos = node.from;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      emit(pos, child.from, classes);
      walk(child, classes);
      pos = child.to;
    }
    emit(pos, node.to, classes);
  };
  const top = tree.topNode;
  emit(0, top.from, null);
  walk(top, null);
  emit(top.to, text.length, null);
  return out;
}

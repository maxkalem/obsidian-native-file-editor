import { type Language, ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { NodeType, SyntaxNode, Tree } from "@lezer/common";
import { type Highlighter, type Tag, highlightCode, highlightTree } from "@lezer/highlight";
import { cm5Classes, forkTokenClassProp } from "./obsidianFork";
import { TOKEN_CLASSES } from "./tokenTable";

export { OBSIDIAN_SCHEME_CLASS, TOKEN_CLASSES } from "./tokenTable";



/**
 * Tag name -> classes. Tags are matched by NAME (`tag.toString()`: "keyword",
 * "definition(variableName)"), never by object identity or id, so the
 * highlighter does not depend on which copy of `@lezer/highlight` created a
 * tag. (Obsidian turned out to ship one copy; the stream-mode failure had a
 * different cause, see obsidianFork.ts. Name matching stays: it costs nothing
 * and the assumption it removes is one a host could break at any time.)
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
  // `highlightCode` finds highlight rules through @lezer/highlight's NodeProp.
  // Obsidian's stream tokens carry none (obsidianFork.ts): then the tree is
  // walked here, reading rules by shape and the fork's token strings.
  if (out.every((tok) => tok.classes === null) && treeHasRules(tree)) return paintByName(text, tree);
  return out;
}

/** Whether any node in the tree carries a style rule (by shape). Stops at the first. */
export function treeHasRules(tree: Tree): boolean {
  let found = false;
  tree.iterate({
    enter(node) {
      if (found) return false;
      if (ruleOf(node.type) || forkTokenOf(node.type) !== null) found = true;
      return !found;
    },
  });
  return found;
}

/** The raw CM5 token string Obsidian's fork attaches to a stream token, or null. */
export function forkTokenOf(type: NodeType): string | null {
  if (!forkTokenClassProp) return null;
  const v = type.prop(forkTokenClassProp);
  return typeof v === "string" && v.length > 0 ? v : null;
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
    const forkToken = rule ? null : forkTokenOf(node.type);
    const own = rule ? classesForTags(rule.tags) : forkToken ? cm5Classes(forkToken) : null;
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

/** What a stretch of a document is to a tool that rewrites it: text it may touch, or a string or comment it must not. */
export type SegmentKind = "code" | "string" | "comment";

export interface TextSegment {
  readonly from: number;
  readonly to: number;
  readonly kind: SegmentKind;
}

/**
 * The document as strings, comments and the rest, in order and without gaps,
 * from the same tree and the same highlighter the editor colours with. This is
 * what Compress works on: a token class is the one thing every language the
 * plugin knows agrees on, while node names differ per grammar.
 *
 * On a lezer grammar the spans come from `highlightTree`, so a comment or a
 * string that spans lines is one segment. On Obsidian's stream fork the tree
 * carries no highlight rules and the tokens are per line (`paintByName`), so
 * two comment tokens either side of a line break are joined when the first
 * does not begin with a line-comment marker, and two string tokens always:
 * a string that ends on one line and another that begins on the next with
 * nothing between them is not a construct the plugin's languages have.
 */
export function segmentsOf(text: string, tree: Tree): TextSegment[] {
  const spans: { from: number; to: number; kind: SegmentKind }[] = [];
  highlightTree(tree, nfeHighlighter, (from, to, classes) => {
    const kind = kindOfClasses(classes);
    if (kind !== "code") spans.push({ from, to, kind });
  });
  if (spans.length === 0 && treeHasRules(tree)) spans.push(...spansByName(text, tree));
  const out: TextSegment[] = [];
  let pos = 0;
  const push = (from: number, to: number, kind: SegmentKind) => {
    if (to <= from) return;
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.to === from) out[out.length - 1] = { from: last.from, to, kind };
    else out.push({ from, to, kind });
  };
  for (const span of spans) {
    if (span.from < pos) continue;
    push(pos, span.from, "code");
    push(span.from, span.to, span.kind);
    pos = span.to;
  }
  push(pos, text.length, "code");
  return out;
}

function kindOfClasses(classes: string | null): SegmentKind {
  if (classes === null) return "code";
  if (/\bnfe-tok-comment\b/.test(classes)) return "comment";
  if (/\bnfe-tok-(string|regexp|escape)\b/.test(classes)) return "string";
  return "code";
}

/** A line comment ends at its newline; anything else that is a comment may go on. */
const LINE_COMMENT_MARKER = /^(\/\/|#|--|;|%|'|!|::|REM\b|dnl\b)/i;

/** The fork's per-line tokens as spans, with the line breaks inside a string or a block comment given back to it. */
function spansByName(text: string, tree: Tree): { from: number; to: number; kind: SegmentKind }[] {
  const tokens = paintByName(text, tree);
  const out: { from: number; to: number; kind: SegmentKind }[] = [];
  let pos = 0;
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const from = pos;
    pos += token.text.length;
    if (token.text === "\n") {
      const prev = out[out.length - 1];
      const next = tokens[i + 1];
      if (prev && prev.to === from && next && next.text !== "\n" && kindOfClasses(next.classes) === prev.kind && (prev.kind === "string" || (prev.kind === "comment" && !LINE_COMMENT_MARKER.test(text.slice(prev.from, prev.to))))) {
        out[out.length - 1] = { ...prev, to: pos };
      }
      continue;
    }
    const kind = kindOfClasses(token.classes);
    if (kind === "code") continue;
    const prev = out[out.length - 1];
    if (prev && prev.kind === kind && prev.to === from) out[out.length - 1] = { ...prev, to: pos };
    else out.push({ from, to: pos, kind });
  }
  return out;
}

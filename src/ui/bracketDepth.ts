import { indentNodeProp, indentService, syntaxTree, type IndentContext } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { NodeProp, type SyntaxNode } from "@lezer/common";

/**
 * Indentation by bracket depth, in place of CodeMirror's bracket alignment.
 *
 * CodeMirror's default rule for a bracketed node aligns its content to the
 * bracket when a token follows the bracket on the same line, and puts the
 * closing bracket in the bracket's own column: `foo(a,\n    b)`. On a line
 * that opens two blocks, `impl X for Y {    fn f() {`, that puts the body one
 * level deep instead of two and the outer `}` at column 29 (seen 2026-09-25 on
 * a Rust file). The same rule reaches every grammar without its own strategy.
 *
 * This rule counts brackets instead: the content of a bracket is one unit
 * deeper than the line the bracket opens on, plus one unit for every enclosing
 * bracket opened on that same line; the closing bracket sits at that depth.
 * Nodes with an indentation strategy of their own (`if` continuation,
 * strings, comments, Python bodies) are left to CodeMirror, and so is every
 * language whose tree carries no bracket information (the stream modes).
 *
 * What it gives up: the aligned style itself. `foo(a,\n    b)` now indents
 * `b` by one unit rather than under `a`.
 */
export function bracketDepthIndent(): Extension {
  return indentService.of(bracketDepth);
}

/** Exported for the tests; the extension above is the way in. */
export function bracketDepth(cx: IndentContext, pos: number): number | undefined {
  const tree = syntaxTree(cx.state);
  if (tree.length < pos) return undefined;
  for (let cur: SyntaxNode | null = tree.resolveInner(pos, -1); cur; cur = cur.parent) {
    // An explicit strategy wins, as it does in CodeMirror's own walk.
    if (cur.type.prop(indentNodeProp)) return undefined;
    const open = cur.firstChild;
    const closers = open?.type.prop(NodeProp.closedBy);
    if (!open || !closers || open.to > pos) continue;
    const line = referenceLine(cx, cur);
    let depth = 0;
    for (let p = cur.parent; p; p = p.parent) {
      const first = p.firstChild;
      if (first && first.type.prop(NodeProp.closedBy) && first.from >= line.from && first.from <= line.to) depth++;
    }
    const base = cx.lineIndent(line.from) + depth * cx.unit;
    return closesHere(cx, cur, closers, pos) ? base : base + cx.unit;
  }
  return undefined;
}

/** Does the line at `pos` start with this node's closing bracket? */
function closesHere(cx: IndentContext, node: SyntaxNode, closers: readonly string[], pos: number): boolean {
  const last = node.lastChild;
  if (!last || last === node.firstChild || !closers.includes(last.name)) return false;
  const after = cx.textAfterPos(pos);
  // A simulated double break (Enter between `{` and `}`) reports an empty
  // line although the closer stands at `pos`; then the closer is not on
  // this line, as CodeMirror's own rule has it.
  if (after.length === 0 && pos < cx.state.doc.lineAt(pos).to) return false;
  const space = /^\s*/.exec(after)?.[0].length ?? 0;
  return last.from === pos + space;
}

/**
 * The line a bracketed node is measured from: the line it starts on, unless
 * a node that is not its parent covers that line's start — then that node's
 * line, and so on. The same walk as CodeMirror's `baseIndentFor`.
 */
function referenceLine(cx: IndentContext, node: SyntaxNode) {
  let line = cx.state.doc.lineAt(node.from);
  for (;;) {
    let atBreak = node.resolve(line.from);
    while (atBreak.parent && atBreak.parent.from === atBreak.from) atBreak = atBreak.parent;
    if (isParent(atBreak, node)) break;
    line = cx.state.doc.lineAt(atBreak.from);
  }
  return line;
}

function isParent(parent: SyntaxNode, of: SyntaxNode): boolean {
  for (let cur: SyntaxNode | null = of; cur; cur = cur.parent) if (cur.from === parent.from && cur.to === parent.to && cur.type === parent.type) return true;
  return false;
}

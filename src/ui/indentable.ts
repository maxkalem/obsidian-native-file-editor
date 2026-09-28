import { getIndentation } from "@codemirror/language";
import type { EditorState } from "@codemirror/state";

/**
 * Does anything provide indentation for this document's language?
 * `getIndentation` answers null when nothing does, and a line of plain text
 * answers null everywhere, so a few lines are asked before the answer is "no".
 *
 * Never the first line: with no language the syntax tree is empty, and
 * `getIndentation` still answers 0 at offset 0 because the tree's top node
 * indents, so a plain-text file looked indentable and showed the Format group
 * (seen 2026-09-21 on a .txt). From offset 1 on, an empty tree answers null. A
 * one-line file has nothing to reindent anyway.
 */
export function indentable(state: EditorState, maxLines = 40): boolean {
  const lines = Math.min(state.doc.lines, maxLines);
  for (let n = 2; n <= lines; n++) {
    const line = state.doc.line(n);
    if (line.text.trim().length === 0) continue;
    if (getIndentation(state, line.from) !== null) return true;
  }
  return false;
}

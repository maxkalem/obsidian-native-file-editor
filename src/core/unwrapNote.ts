import type { Editor, EditorPosition } from "obsidian";
import { DEFAULT_UNWRAP_OPTIONS, type RejoinedWord, type UnwrapResult, restoreHyphens, unwrapLines } from "../fmt/unwrap";
import { DEFAULT_WRAP_OPTIONS, type WrapResult, wrapLines } from "../fmt/wrap";

/**
 * "Unwrap lines" and "Wrap lines" inside Obsidian's own Markdown editor. `.md`
 * is Obsidian's file type and this plugin never opens it, so the commands
 * reach a note through the editor menu and act through Obsidian's `Editor`:
 * the lines the selection touches (the whole note when nothing is selected)
 * are replaced in one transaction, which is one step of Obsidian's undo.
 */

/** The part of Obsidian's Editor this uses, so a test can hand in a fake. */
export type NoteEditor = Pick<Editor, "somethingSelected" | "getCursor" | "lineCount" | "getLine" | "getRange" | "getValue" | "transaction">;

/**
 * The lines the selection touches, or the whole note, handed to `transform`
 * with whether they start at the top, whether they were a selection and the
 * whole note (which Unwrap reads its hyphen evidence from); what comes back
 * replaces them (a selection stays selected on the result).
 */
export function transformNoteLines<T extends { readonly text: string }>(editor: NoteEditor, transform: (text: string, atDocumentStart: boolean, selected: boolean, document: string) => T): T {
  const selected = editor.somethingSelected();
  const fromLine = selected ? editor.getCursor("from").line : 0;
  let toLine = selected ? editor.getCursor("to").line : editor.lineCount() - 1;
  // A selection that ends at the very start of a line does not mean that line.
  if (selected && toLine > fromLine && editor.getCursor("to").ch === 0) toLine--;
  const from: EditorPosition = { line: fromLine, ch: 0 };
  const to: EditorPosition = { line: toLine, ch: editor.getLine(toLine).length };
  const before = editor.getRange(from, to);
  const result = transform(before, fromLine === 0, selected, selected ? editor.getValue() : before);
  if (result.text !== before) {
    const lines = result.text.split("\n");
    const end: EditorPosition = { line: fromLine + lines.length - 1, ch: lines[lines.length - 1]?.length ?? 0 };
    editor.transaction({ changes: [{ from, to, text: result.text }], selection: selected ? { from, to: end } : undefined });
  }
  return result;
}

export function unwrapInNote(editor: NoteEditor): UnwrapResult {
  return transformNoteLines(editor, (text, atDocumentStart, selection, document) => unwrapLines(text, { ...DEFAULT_UNWRAP_OPTIONS, markdown: true, atDocumentStart, selection, evidenceText: document }));
}

/**
 * The review step's fix inside a note: the hyphens go back into the text
 * Unwrap left, as a second edit and so a second undo step. The text is
 * compared with what Unwrap produced first, because the dialog was open while
 * the user could type: a changed text is left alone and the caller says so.
 */
export function restoreInNote(editor: NoteEditor, produced: string, restore: readonly RejoinedWord[]): boolean {
  let applied = false;
  transformNoteLines(editor, (text) => {
    if (text !== produced) return { text };
    applied = true;
    return { text: restoreHyphens(text, restore) };
  });
  return applied;
}

export function wrapInNote(editor: NoteEditor, width: number, breakWords: boolean): WrapResult {
  return transformNoteLines(editor, (text, atDocumentStart) => wrapLines(text, { ...DEFAULT_WRAP_OPTIONS, width, breakWords, markdown: true, atDocumentStart }));
}

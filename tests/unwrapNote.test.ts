import { describe, expect, it } from "vitest";
import type { EditorPosition, EditorTransaction } from "obsidian";
import { type NoteEditor, unwrapInNote, wrapInNote } from "../src/core/unwrapNote";

/** Enough of Obsidian's Editor for the command: lines, a selection, and the one transaction it makes. */
class FakeNoteEditor implements NoteEditor {
  lines: string[];
  transactions: EditorTransaction[] = [];
  private from: EditorPosition | null = null;
  private to: EditorPosition | null = null;
  constructor(text: string) {
    this.lines = text.split("\n");
  }
  select(from: EditorPosition, to: EditorPosition): void {
    this.from = from;
    this.to = to;
  }
  somethingSelected(): boolean {
    return this.from !== null;
  }
  getCursor(which?: "from" | "to" | "head" | "anchor"): EditorPosition {
    const pos = which === "to" ? this.to : this.from;
    return pos ?? { line: 0, ch: 0 };
  }
  lineCount(): number {
    return this.lines.length;
  }
  getLine(n: number): string {
    return this.lines[n] ?? "";
  }
  getValue(): string {
    return this.lines.join("\n");
  }
  getRange(from: EditorPosition, to: EditorPosition): string {
    const out: string[] = [];
    for (let i = from.line; i <= to.line; i++) {
      const line = this.lines[i] ?? "";
      out.push(line.slice(i === from.line ? from.ch : 0, i === to.line ? to.ch : line.length));
    }
    return out.join("\n");
  }
  transaction(tx: EditorTransaction): void {
    this.transactions.push(tx);
    for (const change of tx.changes ?? []) {
      const { from, to } = change;
      const end = to ?? from;
      const head = (this.lines[from.line] ?? "").slice(0, from.ch);
      const tail = (this.lines[end.line] ?? "").slice(end.ch);
      this.lines.splice(from.line, end.line - from.line + 1, ...(head + change.text + tail).split("\n"));
    }
  }
}

const WRAPPED = [
  "# A note",
  "",
  "The first line of a paragraph that a mail client cut at seventy-two columns",
  "and the second line of it, which also runs on to the very end of the row",
  "and stops.",
  "",
  "- a list item that is long enough to be measured as a line of the paragraph",
  "- another",
  "",
  "Another paragraph whose lines were cut by the same client at the same width",
  "and which ends here.",
];

describe("unwrapInNote", () => {
  it("with nothing selected, joins the whole note in one transaction and leaves the structure", () => {
    const editor = new FakeNoteEditor(WRAPPED.join("\n"));
    const result = unwrapInNote(editor);
    expect(result.joined).toBe(3);
    expect(editor.transactions).toHaveLength(1);
    expect(editor.transactions[0]?.selection).toBeUndefined();
    expect(editor.lines).toEqual([
      "# A note",
      "",
      "The first line of a paragraph that a mail client cut at seventy-two columns and the second line of it, which also runs on to the very end of the row and stops.",
      "",
      "- a list item that is long enough to be measured as a line of the paragraph",
      "- another",
      "",
      "Another paragraph whose lines were cut by the same client at the same width and which ends here.",
    ]);
  });

  it("with a selection, touches only the lines it covers and selects the result", () => {
    const editor = new FakeNoteEditor(WRAPPED.join("\n"));
    // From inside line 9 to the start of line 11: line 11 is not meant.
    editor.select({ line: 9, ch: 5 }, { line: 10, ch: 0 });
    const result = unwrapInNote(editor);
    expect(result.joined).toBe(0);
    expect(editor.transactions).toHaveLength(0);
    editor.select({ line: 9, ch: 5 }, { line: 10, ch: 3 });
    expect(unwrapInNote(editor).joined).toBe(1);
    expect(editor.lines.slice(0, 5)).toEqual(WRAPPED.slice(0, 5));
    expect(editor.lines[9]).toBe("Another paragraph whose lines were cut by the same client at the same width and which ends here.");
    expect(editor.transactions[0]?.selection).toEqual({ from: { line: 9, ch: 0 }, to: { line: 9, ch: 96 } });
  });

  it("wrapInNote cuts the long lines of the selection at the width, in one transaction", () => {
    const editor = new FakeNoteEditor(WRAPPED.join("\n"));
    unwrapInNote(editor);
    editor.transactions.length = 0;
    editor.select({ line: 2, ch: 0 }, { line: 2, ch: 10 });
    const result = wrapInNote(editor, 40, false);
    expect(result.wrapped).toBe(1);
    expect(editor.transactions).toHaveLength(1);
    expect(editor.lines[2]).toBe("The first line of a paragraph that a");
    expect(editor.lines.slice(2, 2 + result.added + 1).every((l) => l.length <= 40)).toBe(true);
    expect(editor.lines[0]).toBe("# A note");
    expect(wrapInNote(editor, 40, false).wrapped).toBe(0);
  });

  it("changes nothing in a note that is not hard-wrapped", () => {
    const editor = new FakeNoteEditor("# Title\n\nOne paragraph on one line, as Obsidian notes usually are.\nAnother one, kept apart from it by a line break alone.\n");
    const result = unwrapInNote(editor);
    expect(result.joined).toBe(0);
    expect(editor.transactions).toHaveLength(0);
  });
});

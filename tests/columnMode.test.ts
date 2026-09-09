import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { addCursorVertically, moveWithinLine, paddingFor, rectangleFor, rectangleSelection, selectAllOccurrences, virtualColumns } from "../src/ui/columnMode";

/**
 * Column mode without a DOM: the rectangle, the virtual columns, the padding
 * the first keystroke inserts, the arrows that stay on their line, and
 * "select every occurrence". What needs layout (the phantom, the mouse) is
 * the device's.
 */

const DOC = "fifth line\nsixth line\n7 line\n123\nавпівпав\n1230\n\nвцвцфвфвфвц";
const state = () => EditorState.create({ doc: DOC, extensions: [virtualColumns, EditorState.allowMultipleSelections.of(true)] });
const pos = (s: EditorState, line: number, col: number) => ({ line, col, off: Math.min(col, s.doc.line(line).length) });

/** A view stand-in for the commands that only need state, dispatch and character motion. */
function fakeView(s: EditorState): EditorView & { state: EditorState } {
  const view = {
    state: s,
    dispatch(spec: Parameters<EditorView["dispatch"]>[0]) {
      view.state = view.state.update(spec as never).state;
    },
    moveByChar(range: { head: number; anchor: number }, forward: boolean) {
      const head = Math.max(0, Math.min(view.state.doc.length, range.head + (forward ? 1 : -1)));
      return EditorSelection.cursor(head);
    },
    moveByGroup(range: { head: number }, forward: boolean) {
      // A word is a run of letters; good enough for "the next word boundary on this line or beyond".
      const text = view.state.doc.toString();
      let head = range.head;
      const step = forward ? 1 : -1;
      const isWord = (i: number) => /\p{L}|\p{N}/u.test(text.charAt(forward ? i : i - 1));
      while (head + step >= 0 && head + step <= text.length && !isWord(head)) head += step;
      while (head + step >= 0 && head + step <= text.length && isWord(head)) head += step;
      return EditorSelection.cursor(Math.max(0, Math.min(text.length, head)));
    },
    moveVertically(range: { head: number; goalColumn?: number }, forward: boolean) {
      const line = view.state.doc.lineAt(range.head);
      const col = range.head - line.from;
      const target = view.state.doc.line(line.number + (forward ? 1 : -1));
      const goal = range.goalColumn ?? col;
      return EditorSelection.cursor(target.from + Math.min(goal, target.length), -1, undefined, goal);
    },
  };
  return view as unknown as EditorView & { state: EditorState };
}

describe("the rectangle (Alt+drag)", () => {
  it("gives a range per line, a cursor at the end of a line the rectangle starts past, and remembers its column", () => {
    const s = state();
    // Lines 2 to 8 (sixth line … вцвцфвфвфвц), columns 5 to 8: the user's 2026-09-09 case.
    const { ranges, virtual } = rectangleFor(s, pos(s, 8, 8), pos(s, 2, 5));
    expect(ranges.map((r) => s.sliceDoc(r.from, r.to))).toEqual([" li", "e", "", "пав", "", "", "вфв"]);
    // "123" (3 chars), "1230" (4 chars) and "" end before column 5: cursors at their ends, virtual column 5 (Notepad++'s 7x3 rectangle).
    expect(virtual.map((v) => [s.doc.lineAt(v.pos).number, v.col])).toEqual([
      [4, 5],
      [6, 5],
      [7, 5],
    ]);
    expect(ranges.filter((r) => r.empty)).toHaveLength(3);
  });

  it("the virtual columns live in the state until another selection change, and pad the first keystroke", () => {
    let s = state();
    const selection = rectangleSelection(s, pos(s, 8, 8), pos(s, 2, 5));
    expect(selection).not.toBeNull();
    s = s.update({ selection: selection! }).state;
    expect(s.field(virtualColumns).length).toBe(3);
    const short = s.selection.ranges.find((r) => s.doc.lineAt(r.head).number === 4)!;
    expect(paddingFor(s, short)).toBe("  ");
    const empty = s.selection.ranges.find((r) => s.doc.lineAt(r.head).number === 7)!;
    expect(paddingFor(s, empty)).toBe("     ");
    const four = s.selection.ranges.find((r) => s.doc.lineAt(r.head).number === 6)!;
    expect(paddingFor(s, four)).toBe(" ");
    const real = s.selection.ranges.find((r) => s.doc.lineAt(r.head).number === 2)!;
    expect(paddingFor(s, real)).toBe("");
    // An edit keeps them (positions mapped); a selection set by anything else drops them.
    const edited = s.update({ changes: { from: 0, insert: "X" } }).state;
    expect(edited.field(virtualColumns).map((v) => v.pos)).toEqual(s.field(virtualColumns).map((v) => v.pos + 1));
    const moved = s.update({ selection: EditorSelection.single(0) }).state;
    expect(moved.field(virtualColumns)).toEqual([]);
  });
});

describe("arrows with several cursors", () => {
  it("stop at the ends of their lines instead of wrapping; one cursor falls through", () => {
    const s = state();
    const line4 = s.doc.line(4); // "123"
    const line5 = s.doc.line(5); // "авпівпав"
    const view = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.to - 1), EditorSelection.cursor(line5.from + 2)], 0) }).state);
    expect(moveWithinLine(view, true, false)).toBe(true);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([line4.to, line5.from + 3]);
    // Again: the first is at its end and stays; the second moves.
    moveWithinLine(view, true, false);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([line4.to, line5.from + 4]);
    // Left from the start of a line stays too.
    const atStarts = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.from), EditorSelection.cursor(line5.from + 1)]) }).state);
    moveWithinLine(atStarts, false, false);
    expect(atStarts.state.selection.ranges.map((r) => r.head)).toEqual([line4.from, line5.from]);
    // Shift extends within the line.
    const extend = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.to - 1), EditorSelection.cursor(line5.from)]) }).state);
    moveWithinLine(extend, true, true);
    moveWithinLine(extend, true, true);
    expect(extend.state.selection.ranges.map((r) => [r.anchor, r.head])).toEqual([
      [line4.to - 1, line4.to],
      [line5.from, line5.from + 2],
    ]);
    expect(moveWithinLine(fakeView(s), true, false)).toBe(false);
    // By word (Ctrl+Right): the same clamp.
    const words = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.from), EditorSelection.cursor(line5.from)]) }).state);
    moveWithinLine(words, true, false, "group");
    moveWithinLine(words, true, false, "group");
    expect(words.state.selection.ranges.map((r) => r.head)).toEqual([line4.to, line5.to]);
  });

  it("Ctrl+Alt+Up adds a cursor per line above, at the end of a shorter one, and the arrows then keep each on its line", () => {
    const s = state();
    const last = s.doc.line(8);
    const view = fakeView(s.update({ selection: EditorSelection.single(last.from + 8) }).state);
    for (let i = 0; i < 4; i++) expect(addCursorVertically(view, false)).toBe(true);
    expect(view.state.selection.ranges.map((r) => [s.doc.lineAt(r.head).number, r.head - s.doc.lineAt(r.head).from])).toEqual([
      [4, 3],
      [5, 8],
      [6, 4],
      [7, 0],
      [8, 8],
    ]);
    for (let i = 0; i < 11; i++) moveWithinLine(view, true, false);
    // Notepad++'s result (the user's screenshot 9): every caret at its line's end, none on another line.
    expect(view.state.selection.ranges.map((r) => [s.doc.lineAt(r.head).number, r.head === s.doc.lineAt(r.head).to])).toEqual([
      [4, true],
      [5, true],
      [6, true],
      [7, true],
      [8, true],
    ]);
  });
});

describe("select every occurrence", () => {
  it("takes the main range's text, or the word at the cursor, whatever the number of ranges, and keeps the main one", () => {
    const s = EditorState.create({ doc: "line one\nline two\nline three\n--", extensions: [EditorState.allowMultipleSelections.of(true)] });
    const view = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.range(0, 4), EditorSelection.range(9, 13)], 1) }).state);
    expect(selectAllOccurrences(view)).toBe(true);
    expect(view.state.selection.ranges.map((r) => [r.from, r.to])).toEqual([
      [0, 4],
      [9, 13],
      [18, 22],
    ]);
    expect(view.state.selection.mainIndex).toBe(1);
    const word = fakeView(s.update({ selection: EditorSelection.single(20) }).state);
    expect(selectAllOccurrences(word)).toBe(true);
    expect(word.state.selection.ranges).toHaveLength(3);
    // No word at the cursor (between the dashes): nothing to select.
    expect(selectAllOccurrences(fakeView(s.update({ selection: EditorSelection.single(s.doc.length - 1) }).state))).toBe(false);
  });
});

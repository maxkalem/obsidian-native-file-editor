import { EditorSelection, EditorState } from "@codemirror/state";
import type { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { addCursorVertically, backspaceInVirtualSpace, cancelTextDragWithAlt, moveWithinLine, paddingFor, phantomSegments, rectangleFor, rectangleSelection, sameVirtualColumns, selectAllOccurrences, setVirtualColumns, virtualColumns } from "../src/ui/columnMode";

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
    // Lines 2 to 8 (sixth line … вцвцфвфвфвц), columns 5 to 8.
    const { ranges, virtual } = rectangleFor(s, pos(s, 8, 8), pos(s, 2, 5));
    expect(ranges.map((r) => s.sliceDoc(r.from, r.to))).toEqual([" li", "e", "", "пав", "", "", "вфв"]);
    // "123" (3 chars), "1230" (4 chars) and "" end before column 5: cursors at their ends, virtual column 5 (Notepad++'s 7x3 rectangle).
    // …with the rectangle's columns (5 to 8) and the caret at the drag's column (5, the drag went up-left).
    // "7 line" (6 long) ends inside the rectangle: a range to its end and a virtual tail.
    expect(virtual.map((v) => [s.doc.lineAt(v.pos).number, v.from, v.to, v.caret])).toEqual([
      [3, 5, 8, 5],
      [4, 5, 8, 5],
      [6, 5, 8, 5],
      [7, 5, 8, 5],
    ]);
    expect(ranges.filter((r) => r.empty)).toHaveLength(3);
    // Dragged up and to the left: the caret of every range is at its start, where the drag ended; dragged the other way, at its end.
    expect(ranges.filter((r) => !r.empty).every((r) => r.head === r.from)).toBe(true);
    const forward = rectangleFor(s, pos(s, 2, 5), pos(s, 8, 8));
    expect(forward.ranges.filter((r) => !r.empty).every((r) => r.head === r.to)).toBe(true);
    // A line that ends inside the rectangle (авпівпав is 8 long; a rectangle to column 10) gets a range to its end and a virtual tail.
    const tail = rectangleFor(s, pos(s, 5, 6), pos(s, 5, 10));
    expect(tail.ranges.map((r) => s.sliceDoc(r.from, r.to))).toEqual(["ав"]);
    expect(tail.virtual).toEqual([{ pos: s.doc.line(5).to, from: 6, to: 10, caret: 10 }]);
    // The phantom: plain up to the rectangle, tinted inside it.
    expect(phantomSegments(3, 8, 5, 8)).toEqual([
      { width: 2, selected: false },
      { width: 3, selected: true },
    ]);
    expect(phantomSegments(8, 10, 6, 10)).toEqual([{ width: 2, selected: true }]);
    expect(phantomSegments(4, 5, 5, 8)).toEqual([{ width: 1, selected: false }]);
  });

  it("the virtual columns live in the state until another selection change, and pad the first keystroke", () => {
    let s = state();
    const selection = rectangleSelection(s, pos(s, 8, 8), pos(s, 2, 5));
    expect(selection).not.toBeNull();
    s = s.update({ selection: selection! }).state;
    expect(s.field(virtualColumns).length).toBe(4);
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

describe("a wider rectangle with the same ranges", () => {
  it("is the case CodeMirror would not dispatch: the columns differ, the ranges do not; the effect carries them into the field", () => {
    const s = state();
    // From 5:6 down past every line's end: at column 12 and at column 20 the ranges are the same (every line ends inside), only the virtual columns differ.
    const narrow = rectangleSelection(s, pos(s, 5, 6), pos(s, 8, 12))!;
    const wide = rectangleSelection(s, pos(s, 5, 6), pos(s, 8, 20))!;
    expect(wide.eq(narrow, true)).toBe(true);
    const withNarrow = s.update({ selection: narrow }).state;
    const narrowColumns = withNarrow.field(virtualColumns);
    expect(narrowColumns.map((v) => v.to)).toEqual([12, 12, 12, 12]);
    const { virtual } = rectangleFor(s, pos(s, 5, 6), pos(s, 8, 20));
    expect(sameVirtualColumns(narrowColumns, virtual)).toBe(false);
    // The effect alone, no selection in the transaction: the field takes the new columns.
    const widened = withNarrow.update({ effects: setVirtualColumns.of(virtual) }).state;
    expect(widened.selection.eq(narrow)).toBe(true);
    expect(widened.field(virtualColumns).map((v) => v.to)).toEqual([20, 20, 20, 20]);
    expect(sameVirtualColumns(widened.field(virtualColumns), virtual)).toBe(true);
  });
});

describe("the browser's text drag", () => {
  it("is cancelled while Alt is down, so a rectangle started inside the selection keeps following the mouse; without Alt it is left alone", () => {
    let prevented = 0;
    const event = (altKey: boolean) => ({ altKey, preventDefault: () => void prevented++ });
    expect(cancelTextDragWithAlt(event(true))).toBe(true);
    expect(prevented).toBe(1);
    expect(cancelTextDragWithAlt(event(false))).toBe(false);
    expect(prevented).toBe(1);
  });
});

describe("arrows with several cursors", () => {
  it("step into virtual space at the end of their lines instead of wrapping; a move by word is clamped; one cursor falls through", () => {
    const s = state();
    const line4 = s.doc.line(4); // "123"
    const line5 = s.doc.line(5); // "авпівпав"
    const view = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.to - 1), EditorSelection.cursor(line5.from + 2)], 0) }).state);
    expect(moveWithinLine(view, true, false)).toBe(true);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([line4.to, line5.from + 3]);
    // Again: the first is at its end and steps into virtual space (column 4 past "123"), the second moves.
    moveWithinLine(view, true, false);
    expect(view.state.selection.ranges.map((r) => r.head)).toEqual([line4.to, line5.from + 4]);
    expect(view.state.field(virtualColumns)).toEqual([{ pos: line4.to, from: 4, to: 4, caret: 4 }]);
    moveWithinLine(view, true, false);
    expect(view.state.field(virtualColumns).map((v) => v.caret)).toEqual([5]);
    // ← brings it back through the virtual space and then into the text.
    moveWithinLine(view, false, false);
    moveWithinLine(view, false, false);
    expect(view.state.field(virtualColumns)).toEqual([]);
    expect(view.state.selection.ranges[0]!.head).toBe(line4.to);
    moveWithinLine(view, false, false);
    expect(view.state.selection.ranges[0]!.head).toBe(line4.to - 1);
    // Left from the start of a line stays too.
    const atStarts = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.from), EditorSelection.cursor(line5.from + 1)]) }).state);
    moveWithinLine(atStarts, false, false);
    expect(atStarts.state.selection.ranges.map((r) => r.head)).toEqual([line4.from, line5.from]);
    // Shift extends within the line and, at the line's end, on into virtual space: the real part stays, a tail entry carries the virtual head.
    const extend = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.to - 1), EditorSelection.cursor(line5.from)]) }).state);
    moveWithinLine(extend, true, true);
    moveWithinLine(extend, true, true);
    expect(extend.state.selection.ranges.map((r) => [r.anchor, r.head])).toEqual([
      [line4.to - 1, line4.to],
      [line5.from, line5.from + 2],
    ]);
    expect(extend.state.field(virtualColumns)).toEqual([{ pos: line4.to, from: 3, to: 4, caret: 4 }]);
    expect(moveWithinLine(fakeView(s), true, false)).toBe(false);
    // By word (Ctrl+Right): clamped at the line's end, no virtual space.
    const words = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.from), EditorSelection.cursor(line5.from)]) }).state);
    moveWithinLine(words, true, false, "group");
    moveWithinLine(words, true, false, "group");
    expect(words.state.selection.ranges.map((r) => r.head)).toEqual([line4.to, line5.to]);
  });

  it("Ctrl+Alt+Up adds a cursor per line above in the SAME column, in virtual space on a shorter line; the arrows then drop the virtual columns and keep each caret on its line", () => {
    const s = state();
    const last = s.doc.line(8);
    // 12:11 in the sample file's numbering is column 10 here (the doc lacks its first four lines).
    const view = fakeView(s.update({ selection: EditorSelection.single(last.from + 10) }).state);
    for (let i = 0; i < 3; i++) expect(addCursorVertically(view, false)).toBe(true);
    const at = (r: { head: number }) => [s.doc.lineAt(r.head).number, r.head - s.doc.lineAt(r.head).from];
    // Carets at the ends of the shorter lines (авпівпав 8, 1230 4, the empty line 0) …
    expect(view.state.selection.ranges.map(at)).toEqual([
      [5, 8],
      [6, 4],
      [7, 0],
      [8, 10],
    ]);
    // … each with a virtual column 10, drawn as a phantom of blanks and padded on typing (Notepad++: the caret past авпівпав, under column 10).
    expect(view.state.field(virtualColumns).map((v) => [s.doc.lineAt(v.pos).number, v.from, v.to, v.caret])).toEqual([
      [7, 10, 10, 10],
      [6, 10, 10, 10],
      [5, 10, 10, 10],
    ]);
    const short = view.state.selection.ranges.find((r) => at(r)[0] === 6)!;
    expect(paddingFor(view.state, short)).toBe("      ");
    // A fourth press from the topmost caret (still at column 10 virtually) reaches "123" (3 long): column 10 again.
    expect(addCursorVertically(view, false)).toBe(true);
    expect(view.state.field(virtualColumns).some((v) => s.doc.lineAt(v.pos).number === 4 && v.caret === 10)).toBe(true);
    // Pressing again adds nothing new above the top line? Line 3 ("7 line", 6 long) gets one; the existing ones are not duplicated.
    const before = view.state.selection.ranges.length;
    expect(addCursorVertically(view, false)).toBe(true);
    expect(view.state.selection.ranges.length).toBe(before + 1);
    // → twice and ← once: → moves a virtual caret one column further right, ← takes one back; a real caret moves within its line.
    for (let i = 0; i < 2; i++) moveWithinLine(view, true, false);
    // The real caret on вцвцфвфвфвц (11 long, at column 10) reaches the end with the first → and steps past it with the second: six entries.
    expect(view.state.field(virtualColumns).map((v) => v.caret)).toEqual([12, 12, 12, 12, 12, 12]);
    for (let i = 0; i < 3; i++) moveWithinLine(view, false, false);
    expect(view.state.field(virtualColumns).map((v) => [s.doc.lineAt(v.pos).number, v.caret])).toEqual([
      [3, 9],
      [4, 9],
      [5, 9],
      [6, 9],
      [7, 9],
    ]);
    expect(view.state.selection.ranges.map(at)).toEqual([
      [3, 6],
      [4, 3],
      [5, 8],
      [6, 4],
      [7, 0],
      [8, 9],
    ]);
    // ← again and again: the caret past авпівпав (8 long) becomes real at column 8 and then moves in the text.
    moveWithinLine(view, false, false);
    expect(view.state.field(virtualColumns).map((v) => [s.doc.lineAt(v.pos).number, v.caret])).toEqual([
      [3, 8],
      [4, 8],
      [6, 8],
      [7, 8],
    ]);
    moveWithinLine(view, false, false);
    expect(view.state.selection.ranges.map(at)).toEqual([
      [3, 6],
      [4, 3],
      [5, 7],
      [6, 4],
      [7, 0],
      [8, 7],
    ]);
  });

  it("the sequence 3×Ctrl+Alt+↑ from 12:11, → → ← Shift+←: the virtual carets end where they started, no selection on their lines, the real one selects a character", () => {
    const s = state();
    const last = s.doc.line(8);
    const view = fakeView(s.update({ selection: EditorSelection.single(last.from + 10) }).state);
    for (let i = 0; i < 3; i++) addCursorVertically(view, false);
    moveWithinLine(view, true, false);
    moveWithinLine(view, true, false);
    moveWithinLine(view, false, false);
    // Shift+← on a virtual caret takes a virtual column like ←, and selects nothing there: Notepad++ shows the carets over
    // авпівпав, 1230 and the empty line in one column past the ends and nothing selected on those lines
    // (build 260909.2157975 selected the last character and scattered the carets to the line ends).
    moveWithinLine(view, false, true);
    const at = (r: { anchor: number; head: number }) => [s.doc.lineAt(r.head).number, r.anchor - s.doc.lineAt(r.head).from, r.head - s.doc.lineAt(r.head).from];
    expect(view.state.selection.ranges.map(at)).toEqual([
      [5, 8, 8],
      [6, 4, 4],
      [7, 0, 0],
      [8, 11, 10],
    ]);
    // …and selects the column of virtual space it crossed, as a rectangle: the shadow from 10 to 11, the caret at 10.
    expect(view.state.field(virtualColumns).map((v) => [s.doc.lineAt(v.pos).number, v.from, v.to, v.caret])).toEqual([
      [5, 10, 11, 10],
      [6, 10, 11, 10],
      [7, 10, 11, 10],
    ]);
    // Shift+→ brings the caret back onto its anchor: the virtual selection collapses.
    moveWithinLine(view, true, true);
    expect(view.state.field(virtualColumns).map((v) => [v.from, v.to, v.caret])).toEqual([
      [11, 11, 11],
      [11, 11, 11],
      [11, 11, 11],
    ]);
    expect(at(view.state.selection.ranges[3]!)).toEqual([8, 11, 11]);
    // Shift+→ twice more: a two-column shadow to the right of the anchor on every line — the real caret at вцвцфвфвфвц's end (column 11) steps out too; ← without Shift collapses each to its left edge (the last one back onto its line's end, no entry).
    moveWithinLine(view, true, true);
    moveWithinLine(view, true, true);
    expect(view.state.field(virtualColumns).map((v) => [v.from, v.to, v.caret])).toEqual([
      [11, 13, 13],
      [11, 13, 13],
      [11, 13, 13],
      [11, 13, 13],
    ]);
    moveWithinLine(view, false, false);
    expect(view.state.field(virtualColumns).map((v) => [v.from, v.to, v.caret])).toEqual([
      [11, 11, 11],
      [11, 11, 11],
      [11, 11, 11],
    ]);
    // Shift+← from the line's end of a real caret: nothing to select leftwards in virtual space, so the ordinary extend runs (clamped at the start).
    // Shift+→ from a real caret at its line's end selects the first virtual column.
    const ends = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(s.doc.line(4).to), EditorSelection.cursor(s.doc.line(6).to)]) }).state);
    moveWithinLine(ends, true, true);
    expect(ends.state.field(virtualColumns).map((v) => [s.doc.lineAt(v.pos).number, v.from, v.to, v.caret])).toEqual([
      [4, 3, 4, 4],
      [6, 4, 5, 5],
    ]);
    // Backspace on a virtual selection collapses it to its start and deletes nothing; a second Backspace, now at the line's end, deletes a character.
    expect(backspaceInVirtualSpace(ends)).toBe(true);
    expect(ends.state.field(virtualColumns)).toEqual([]);
    expect(ends.state.doc.line(4).text).toBe("123");
    expect(backspaceInVirtualSpace(ends)).toBe(false);
  });

  it("Shift+arrows cross the line's end in both directions with the anchor on either side", () => {
    const s = state();
    const line4 = s.doc.line(4); // "123"
    const line6 = s.doc.line(6); // "1230"
    const at = (r: { anchor: number; head: number }) => [r.anchor - s.doc.lineAt(r.anchor).from, r.head - s.doc.lineAt(r.head).from];
    const entries = (v: EditorView & { state: EditorState }) => v.state.field(virtualColumns).map((e) => [s.doc.lineAt(e.pos).number, e.from, e.to, e.caret]);
    // A real selection whose head is at the line's end goes on into virtual space with Shift+→: the range keeps its real part, a tail entry carries the virtual head.
    const view = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.range(line4.from + 1, line4.to), EditorSelection.range(line6.from + 1, line6.to)]) }).state);
    moveWithinLine(view, true, true);
    moveWithinLine(view, true, true);
    expect(view.state.selection.ranges.map(at)).toEqual([
      [1, 3],
      [1, 4],
    ]);
    expect(entries(view)).toEqual([
      [4, 3, 5, 5],
      [6, 4, 6, 6],
    ]);
    // Shift+← three times: back through the virtual space into the text, the anchor untouched.
    for (let i = 0; i < 3; i++) moveWithinLine(view, false, true);
    expect(entries(view)).toEqual([]);
    expect(view.state.selection.ranges.map(at)).toEqual([
      [1, 2],
      [1, 3],
    ]);
    // The other way round: a caret in virtual space, Shift+← past the line's end into the text: the anchor stays virtual (a tail entry with the caret at the line's end, drawn left of the shadow), the head walks the text.
    const back = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.to), EditorSelection.cursor(line6.to)]) }).state);
    moveWithinLine(back, true, false);
    moveWithinLine(back, true, false);
    expect(entries(back)).toEqual([
      [4, 5, 5, 5],
      [6, 6, 6, 6],
    ]);
    for (let i = 0; i < 4; i++) moveWithinLine(back, false, true);
    expect(back.state.selection.ranges.map(at)).toEqual([
      [3, 1],
      [4, 2],
    ]);
    expect(entries(back)).toEqual([
      [4, 3, 5, 3],
      [6, 4, 6, 4],
    ]);
    // Shift+→ twice: the head is back at the line's end, the anchor still virtual: an empty range with the entry.
    moveWithinLine(back, true, true);
    moveWithinLine(back, true, true);
    expect(back.state.selection.ranges.map(at)).toEqual([
      [3, 3],
      [4, 4],
    ]);
    expect(entries(back)).toEqual([
      [4, 3, 5, 3],
      [6, 4, 6, 4],
    ]);
    // → without Shift collapses to the right side: virtual carets at the anchors' columns.
    moveWithinLine(back, true, false);
    expect(entries(back)).toEqual([
      [4, 5, 5, 5],
      [6, 6, 6, 6],
    ]);
    // Typing into a virtual selection pads to its start (Scintilla collapses it there).
    const typed = fakeView(s.update({ selection: EditorSelection.create([EditorSelection.cursor(line4.to), EditorSelection.cursor(line6.to)]) }).state);
    moveWithinLine(typed, true, true);
    moveWithinLine(typed, true, true);
    expect(paddingFor(typed.state, typed.state.selection.ranges[0]!)).toBe("");
    moveWithinLine(typed, true, false);
    moveWithinLine(typed, true, true);
    expect(paddingFor(typed.state, typed.state.selection.ranges[0]!)).toBe("  ");
  });

  it("Backspace at a virtual caret takes one virtual column (Scintilla's DelCharBack) and deletes nothing; a real caret in the same set deletes as usual", () => {
    const s = state();
    const last = s.doc.line(8);
    const view = fakeView(s.update({ selection: EditorSelection.single(last.from + 10) }).state);
    addCursorVertically(view, false); // the empty line 7, virtual column 10
    expect(backspaceInVirtualSpace(view)).toBe(true);
    expect(view.state.doc.toString()).toBe(DOC.slice(0, last.from + 9) + DOC.slice(last.from + 10));
    expect(view.state.field(virtualColumns).map((v) => [s.doc.lineAt(v.pos).number, v.caret])).toEqual([[7, 9]]);
    // Down to the line's real end (column 0 on the empty line): ten presses in all, the text loses one character per press from the real caret only.
    for (let i = 0; i < 9; i++) backspaceInVirtualSpace(view);
    expect(view.state.field(virtualColumns)).toEqual([]);
    expect(view.state.doc.line(8).text).toBe("ц");
    // No virtual caret left: falls through to CodeMirror's own command.
    expect(backspaceInVirtualSpace(view)).toBe(false);
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

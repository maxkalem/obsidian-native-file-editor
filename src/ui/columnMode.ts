import { copyLineDown, copyLineUp, moveLineDown, moveLineUp, selectLine, toggleBlockComment } from "@codemirror/commands";
import { SearchCursor } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension, type Range, type SelectionRange, StateEffect, StateField, countColumn, findColumn } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type KeyBinding, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { HOTKEY_ACTIONS, type HotkeyPlatform, chordFor, toCodeMirrorKey } from "../core/hotkeys";

/**
 * Several cursors the way Notepad++ (Scintilla) has them, the model this
 * plugin follows for cursors and selection. Three things CodeMirror does differently
 * out of the box, and what is done about each:
 *
 * 1. Column selection (Alt+drag) over lines shorter than the rectangle. Notepad++
 *    keeps a caret in "virtual space" past the end of a short line and pads
 *    with spaces when you type; CodeMirror puts the cursor at the line's end.
 *    Here the rectangle handler is the plugin's own (after CodeMirror's, MIT):
 *    a short line gets a cursor at its end plus a remembered virtual column;
 *    a phantom of spaces is drawn up to that column so the caret sits where
 *    Notepad++ would show it, and the first keystroke inserts the padding. The
 *    virtual columns live in a StateField and are dropped by any other change
 *    of the selection.
 * 2. Left/Right with several cursors. In Notepad++ a caret at the end of its
 *    line stays there; CodeMirror wraps it onto the next line, which merges
 *    cursors and was reported as "the cursor jumps to another line". With more
 *    than one range the arrows here treat virtual space as a place to go:
 *    → from a line's end steps past it and on, ← (with or
 *    without Shift) and Backspace walk back through it, and a caret at a
 *    line's start stays; a selection is clamped at the line's ends.
 * 3. Ctrl+Alt+Up/Down: absent from Obsidian's copy of `@codemirror/commands`
 *    (older than 6.8), so bound here — and as Notepad++ does it, keeping the
 *    column in virtual space on a shorter line, not as CodeMirror's own
 *    `addCursorAbove` (the line's end).
 *
 * Also here: "select every occurrence" (Ctrl+Shift+L). CodeMirror's own
 * `selectSelectionMatches` refuses when there is more than one range or the
 * selection is empty, which is exactly the state after Ctrl+D; this one takes
 * the main range's text, or the word at the cursor.
 */

/**
 * A line of the rectangle that ends before the rectangle does. `pos` is the
 * line's end; `from`/`to` the rectangle's columns (the part past the line's
 * end is virtual: drawn as a tinted phantom, as Notepad++ draws its `Sel:
 * 4x3`); `caret` the column the drag ended at, where the caret is drawn when
 * the whole rectangle lies past the line. Typing pads to `from`.
 */
interface VirtualColumn {
  readonly pos: number;
  readonly from: number;
  readonly to: number;
  readonly caret: number;
}

/**
 * The rectangle handler hands its virtual columns to the StateField through
 * the selection object itself: CodeMirror's mouse handling dispatches the
 * EditorSelection the style returns, and a transaction carries no room for
 * anything else. A WeakMap keyed by that object is the channel.
 */
const virtualBySelection = new WeakMap<EditorSelection, readonly VirtualColumn[]>();

/**
 * The second channel: new virtual columns for an UNCHANGED selection. CodeMirror's
 * mouse selection dispatches only when the selection differs from the state's
 * (`MouseSelection.select`), so once every line of the rectangle ends inside it
 * — the pointer past the longest line — a wider rectangle changes nothing but
 * the virtual columns and nothing was dispatched: the rectangle froze at the
 * longest line's end (seen 2026-09-15: it grew again only when the pointer
 * crossed a row, which did change the ranges). The rectangle handler dispatches
 * this effect itself in that case.
 */
export const setVirtualColumns = StateEffect.define<readonly VirtualColumn[]>();

export const virtualColumns = StateField.define<readonly VirtualColumn[]>({
  create: () => [],
  update(value, tr) {
    for (const e of tr.effects) if (e.is(setVirtualColumns)) return e.value;
    if (tr.selection) {
      const fresh = virtualBySelection.get(tr.selection);
      return fresh ?? [];
    }
    if (tr.docChanged) return value.map((v) => ({ ...v, pos: tr.changes.mapPos(v.pos, 1) }));
    return value;
  },
});

/** Whether two lists of virtual columns say the same, in the same order. */
export function sameVirtualColumns(a: readonly VirtualColumn[], b: readonly VirtualColumn[]): boolean {
  return a.length === b.length && a.every((v, i) => v.pos === b[i]?.pos && v.from === b[i]?.from && v.to === b[i]?.to && v.caret === b[i]?.caret);
}

/** Columns are counted the way CodeMirror counts them for the rectangle: tabs expand. */
function columnAt(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return countColumn(line.text, state.tabSize, pos - line.from);
}

/**
 * The virtual entry a range's head stands in (an empty range at its line's
 * end, with something past the end: a caret out there, or a selected span of
 * virtual space), or null. An entry that has come back to the line's end is
 * dead and reads as null.
 */
function virtualAt(state: EditorState, range: SelectionRange): VirtualColumn | null {
  if (!range.empty) return null;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return null;
  const entry = state.field(virtualColumns, false)?.find((v) => v.pos === range.head);
  if (!entry) return null;
  const lineCol = columnAt(state, range.head);
  return entry.caret > lineCol || entry.to > lineCol ? entry : null;
}

/** A virtual caret at `col` with a selection of virtual space from `anchor` to it (equal: none), clipped to the line's end. */
function virtualRange(pos: number, lineCol: number, anchor: number, col: number): VirtualColumn {
  const from = Math.max(lineCol, Math.min(anchor, col));
  const to = Math.max(lineCol, Math.max(anchor, col));
  return { pos, from, to, caret: Math.max(lineCol, col) };
}

/** The virtual tail of a range that ends AT its line's end while the rectangle goes on (the line ends inside the rectangle), or null. */
function virtualTailAt(state: EditorState, range: SelectionRange): VirtualColumn | null {
  const line = state.doc.lineAt(range.to);
  if (range.to !== line.to) return null;
  const entry = state.field(virtualColumns, false)?.find((v) => v.pos === range.to);
  if (!entry) return null;
  return entry.to > columnAt(state, range.to) && entry.from <= columnAt(state, range.to) ? entry : null;
}

// --- the rectangle ---------------------------------------------------------

/** Above this offset a column is taken to be the offset (CodeMirror's own shortcut for very long lines). */
const MAX_OFF = 2000;

export interface RectPos {
  readonly line: number;
  readonly col: number;
  readonly off: number;
}

/**
 * The column of a pointer past a line's end, measured from the document's
 * first character in character widths — CodeMirror's own way. A measure from
 * the pointer's line's end was tried on 2026-09-15 and taken back the same
 * night: the phantom widget at that very position moved the measured end as
 * it grew, and the rectangle flickered while dragging.
 */
function absoluteColumn(view: EditorView, x: number): number {
  const ref = view.coordsAtPos(view.viewport.from);
  return ref ? Math.round(Math.abs((ref.left - x) / view.defaultCharacterWidth)) : -1;
}

function getPos(view: EditorView, event: MouseEvent): RectPos {
  const offset = view.posAtCoords({ x: event.clientX, y: event.clientY }, false);
  const line = view.state.doc.lineAt(offset);
  const off = offset - line.from;
  const col = off > MAX_OFF ? -1 : off === line.length ? absoluteColumn(view, event.clientX) : countColumn(line.text, view.state.tabSize, off);
  return { line: line.number, col, off };
}

/**
 * One range per line of the rectangle, `a` the anchor and `b` the drag's end.
 * A line that ends before the rectangle's left edge gets a cursor at its end
 * and a virtual entry (the rectangle drawn past the line, the caret at `b`'s
 * column); a line that ends inside the rectangle gets a range to its end and
 * a virtual tail.
 */
export function rectangleFor(state: EditorState, a: RectPos, b: RectPos): { ranges: SelectionRange[]; virtual: VirtualColumn[] } {
  const startLine = Math.min(a.line, b.line);
  const endLine = Math.max(a.line, b.line);
  const ranges: SelectionRange[] = [];
  const virtual: VirtualColumn[] = [];
  if (a.off > MAX_OFF || b.off > MAX_OFF || a.col < 0 || b.col < 0) {
    const startOff = Math.min(a.off, b.off);
    const endOff = Math.max(a.off, b.off);
    for (let i = startLine; i <= endLine; i++) {
      const line = state.doc.line(i);
      if (line.length <= endOff) ranges.push(EditorSelection.range(line.from + startOff, line.to + endOff));
    }
    return { ranges, virtual };
  }
  const startCol = Math.min(a.col, b.col);
  const endCol = Math.max(a.col, b.col);
  // The caret of every range stands on the side the drag ended at, as Scintilla's does.
  const backwards = b.col < a.col;
  const span = (from: number, to: number) => (backwards ? EditorSelection.range(to, from) : EditorSelection.range(from, to));
  for (let i = startLine; i <= endLine; i++) {
    const line = state.doc.line(i);
    const start = findColumn(line.text, startCol, state.tabSize, true);
    if (start < 0) {
      ranges.push(EditorSelection.cursor(line.to));
      virtual.push({ pos: line.to, from: startCol, to: endCol, caret: b.col });
    } else {
      const end = findColumn(line.text, endCol, state.tabSize, true);
      if (end < 0) {
        // The line ends inside the rectangle: the range runs to its end, the rest is virtual.
        ranges.push(span(line.from + start, line.to));
        virtual.push({ pos: line.to, from: startCol, to: endCol, caret: b.col });
      } else {
        ranges.push(span(line.from + start, line.from + end));
      }
    }
  }
  return { ranges, virtual };
}

/** The selection for a rectangle, with its virtual columns registered for the StateField; null when the rectangle holds no line. */
export function rectangleSelection(state: EditorState, a: RectPos, b: RectPos, extra: readonly SelectionRange[] = []): EditorSelection | null {
  const { ranges, virtual } = rectangleFor(state, a, b);
  if (!ranges.length) return null;
  const selection = EditorSelection.create(ranges.concat(extra));
  virtualBySelection.set(selection, virtual);
  return selection;
}

function rectangleSelectionStyle(view: EditorView, event: MouseEvent) {
  let start = getPos(view, event);
  let startSel = view.state.selection;
  return {
    update(update: ViewUpdate) {
      if (update.docChanged) {
        const newStart = update.changes.mapPos(update.startState.doc.line(start.line).from);
        const newLine = update.state.doc.lineAt(newStart);
        start = { line: newLine.number, col: start.col, off: Math.min(start.off, newLine.length) };
        startSel = startSel.map(update.changes);
      }
    },
    get(event: MouseEvent, _extend: boolean, multiple: boolean) {
      const selection = rectangleSelection(view.state, start, getPos(view, event), multiple ? startSel.ranges : []);
      if (!selection) return startSel;
      // Same ranges as the state has, other virtual columns: CodeMirror will not dispatch this selection
      // (see `setVirtualColumns`), so the columns go through the effect here, before it compares.
      const virtual = virtualBySelection.get(selection) ?? [];
      if (selection.eq(view.state.selection, true) && !sameVirtualColumns(view.state.field(virtualColumns, false) ?? [], virtual)) {
        view.dispatch({ effects: setVirtualColumns.of(virtual), userEvent: "select.pointer" });
      }
      return selection;
    },
  };
}

// --- the phantom and the padding -------------------------------------------

/** A run of drawn spaces, some of them tinted as selected: the rectangle past a line's end. Drawn, not in the document. */
interface Segment {
  readonly width: number;
  readonly selected: boolean;
}

class PhantomWidget extends WidgetType {
  constructor(private readonly segments: readonly Segment[]) {
    super();
  }
  override eq(other: PhantomWidget): boolean {
    return other.segments.length === this.segments.length && other.segments.every((seg, i) => seg.width === this.segments[i]?.width && seg.selected === this.segments[i]?.selected);
  }
  override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "nfe-virtual-space";
    span.setAttribute("aria-hidden", "true");
    for (const seg of this.segments) {
      if (seg.width <= 0) continue;
      const part = view.dom.ownerDocument.createElement("span");
      part.className = seg.selected ? "nfe-virtual-selected" : "nfe-virtual-blank";
      part.textContent = " ".repeat(seg.width);
      span.appendChild(part);
    }
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/** The segments from column `start` to column `end`, tinted where inside [from, to). */
export function phantomSegments(start: number, end: number, from: number, to: number): Segment[] {
  const out: Segment[] = [];
  const cut = (a: number, b: number, selected: boolean) => {
    if (b > a) out.push({ width: b - a, selected });
  };
  const tintFrom = Math.max(start, from);
  const tintTo = Math.min(end, to);
  if (tintFrom >= tintTo) {
    cut(start, end, false);
    return out;
  }
  cut(start, tintFrom, false);
  cut(tintFrom, tintTo, true);
  cut(tintTo, end, false);
  return out;
}

function phantoms(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const range of state.selection.ranges) {
    const whole = virtualAt(state, range);
    if (whole) {
      // The caret stands at the drag's column: what comes before it goes in a widget on the left of the
      // position (side -1), what comes after in one on the right (side 1); the caret is drawn between them.
      const lineCol = columnAt(state, range.head);
      const caret = Math.max(lineCol, Math.min(whole.caret, Math.max(whole.to, whole.caret)));
      const right = Math.max(whole.to, caret);
      const before = phantomSegments(lineCol, caret, whole.from, whole.to);
      const after = phantomSegments(caret, right, whole.from, whole.to);
      if (before.length) ranges.push(Decoration.widget({ widget: new PhantomWidget(before), side: -1 }).range(range.head));
      if (after.length) ranges.push(Decoration.widget({ widget: new PhantomWidget(after), side: 1 }).range(range.head));
      continue;
    }
    const tail = virtualTailAt(state, range);
    if (tail) {
      // The caret sits where the drag ended: on the right of the shadow when the drag went right (the widget
      // before the position, side -1, so the caret is drawn after it), on the left otherwise (his
      // 2026-09-15: the caret stayed at the text's end while the shadow went on).
      const lineCol = columnAt(state, range.to);
      const caretRight = range.head === range.to;
      ranges.push(Decoration.widget({ widget: new PhantomWidget(phantomSegments(lineCol, tail.to, tail.from, tail.to)), side: caretRight ? -1 : 1 }).range(range.to));
    }
  }
  return Decoration.set(ranges, true);
}

const phantomPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = phantoms(view.state);
    }
    update(update: ViewUpdate): void {
      // The field can change without the selection (the `setVirtualColumns` effect): redraw on that too.
      if (update.selectionSet || update.docChanged || update.state.field(virtualColumns, false) !== update.startState.field(virtualColumns, false)) this.decorations = phantoms(update.state);
    }
  },
  { decorations: (v) => v.decorations }
);

/** What the first keystroke inserts at a virtual caret: the spaces up to the rectangle's left column, then the text. */
export function paddingFor(state: EditorState, range: SelectionRange): string {
  const entry = virtualAt(state, range);
  return entry === null ? "" : " ".repeat(entry.from - columnAt(state, range.head));
}

const padOnInput = EditorView.inputHandler.of((view, _from, _to, text) => {
  const { state } = view;
  if (!state.selection.ranges.some((r) => virtualAt(state, r) !== null)) return false;
  view.dispatch(
    state.changeByRange((range) => {
      const insert = paddingFor(state, range) + text;
      return { changes: { from: range.from, to: range.to, insert }, range: EditorSelection.cursor(range.from + insert.length) };
    }),
    { userEvent: "input.type", scrollIntoView: true }
  );
  return true;
});

// --- the keys ----------------------------------------------------------------

/**
 * Ctrl+Alt+↑/↓ as Notepad++ has it: a caret on
 * the line above / below in the SAME column, in virtual space when that line
 * is shorter — drawn by the phantom, padded with spaces by the first
 * keystroke — so repeated presses build a straight column whatever the line
 * lengths. (CodeMirror's own `addCursorAbove`, which Obsidian's copy of
 * `@codemirror/commands` lacks anyway, would put such a caret at the line's
 * end.) A caret already standing in virtual space keeps its column. An arrow
 * key afterwards drops the virtual columns (Notepad++ converts the column to
 * a multi-edit the same way) and the carets move within their lines.
 */
export function addCursorVertically(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  const existing = state.field(virtualColumns, false) ?? [];
  const ranges = state.selection.ranges.slice();
  const virtual = [...existing];
  const has = (pos: number, col: number) => ranges.some((r) => r.head === pos && (r.head !== state.doc.lineAt(pos).to || (virtual.find((v) => v.pos === pos)?.caret ?? columnAt(state, pos)) === col));
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    const targetNumber = line.number + (forward ? 1 : -1);
    if (targetNumber < 1 || targetNumber > state.doc.lines) continue;
    const col = existing.find((v) => v.pos === range.head && range.empty && range.head === line.to)?.caret ?? columnAt(state, range.head);
    const target = state.doc.line(targetNumber);
    const offset = findColumn(target.text, col, state.tabSize, true);
    const pos = offset < 0 ? target.to : target.from + offset;
    if (has(pos, col)) continue;
    ranges.push(EditorSelection.cursor(pos));
    if (offset < 0) virtual.push({ pos, from: col, to: col, caret: col });
  }
  if (ranges.length === state.selection.ranges.length) return false;
  const selection = EditorSelection.create(ranges, ranges.length - 1);
  virtualBySelection.set(selection, virtual);
  view.dispatch({ selection, userEvent: "select", scrollIntoView: true });
  return true;
}

/**
 * A range on one line as two columns, real or virtual: a real position is its
 * column in the line, a virtual one is a column past the line's end (`lineCol`
 * is the end). The four shapes the state can hold, and how each reads:
 * both real: a plain range; both virtual: an empty range at the line's end
 * with an entry spanning them; head virtual, anchor real: a range to the
 * line's end plus a tail entry whose `caret` is the head; anchor virtual, head
 * real: a range FROM the line's end plus a tail entry whose `caret` is the
 * line's end (the caret is drawn on the left, the shadow on the right).
 */
interface LineColumns {
  readonly lineCol: number;
  readonly anchor: number;
  readonly head: number;
}

function columnsOf(state: EditorState, range: SelectionRange): LineColumns {
  const line = state.doc.lineAt(range.head);
  const lineCol = countColumn(line.text, state.tabSize, line.length);
  const col = (pos: number) => countColumn(line.text, state.tabSize, pos - line.from);
  const entries = state.field(virtualColumns, false) ?? [];
  if (range.empty && range.head === line.to) {
    const entry = virtualAt(state, range);
    if (!entry) return { lineCol, anchor: lineCol, head: lineCol };
    return { lineCol, head: entry.caret, anchor: entry.caret === entry.to ? entry.from : entry.to };
  }
  if (!range.empty && range.to === line.to) {
    const tail = entries.find((v) => v.pos === line.to && v.from <= lineCol && v.to > lineCol);
    if (tail) return range.head === range.to ? { lineCol, anchor: col(range.from), head: tail.to } : { lineCol, anchor: tail.to, head: col(range.head) };
  }
  return { lineCol, anchor: col(range.anchor), head: col(range.head) };
}

/** The range and the virtual entry (if any) for two columns on a line; the inverse of `columnsOf`. */
function rangeOf(state: EditorState, line: { from: number; to: number; text: string }, c: LineColumns): { range: SelectionRange; entry: VirtualColumn | null } {
  const off = (colv: number) => line.from + findColumn(line.text, Math.min(colv, c.lineCol), state.tabSize, false);
  if (c.anchor <= c.lineCol && c.head <= c.lineCol) return { range: EditorSelection.range(off(c.anchor), off(c.head)), entry: null };
  if (c.anchor > c.lineCol && c.head > c.lineCol) return { range: EditorSelection.cursor(line.to), entry: virtualRange(line.to, c.lineCol, c.anchor, c.head) };
  if (c.head > c.lineCol) return { range: EditorSelection.range(off(c.anchor), line.to), entry: { pos: line.to, from: c.lineCol, to: c.head, caret: c.head } };
  return { range: EditorSelection.range(line.to, off(c.head)), entry: { pos: line.to, from: c.lineCol, to: c.anchor, caret: c.lineCol } };
}

/**
 * Left/Right (and Ctrl+Left/Right, by word) with several cursors: each moves
 * within its own line, past its end into virtual space rather than onto the
 * next line (Notepad++). One cursor falls through to CodeMirror's own
 * command, which wraps.
 */
export function moveWithinLine(view: EditorView, forward: boolean, extend: boolean, by: "char" | "group" = "char"): boolean {
  const { state } = view;
  if (state.selection.ranges.length < 2) return false;
  // Virtual space is a place the arrows can go (Scintilla's SCVS_USERACCESSIBLE): with several cursors, → from
  // a line's end or from virtual space goes one column further right, ← takes one column back and the
  // caret is real again once none is left. With Shift the same move extends a selection into or out of
  // virtual space, drawn as the rectangle's shadow, whichever side of the line's end the anchor is on;
  // without Shift a selection collapses to the side it moves towards.
  // A move by word walks columns too while virtual space is involved, else it is CodeMirror's.
  const virtual: VirtualColumn[] = [];
  const ranges = state.selection.ranges.map((range) => {
    const line = state.doc.lineAt(range.head);
    const c = columnsOf(state, range);
    const involved = c.anchor > c.lineCol || c.head > c.lineCol || (by === "char" && forward && c.head === c.lineCol && (range.empty || range.head === range.to));
    if (!involved) {
      const moved = by === "group" ? view.moveByGroup(range, forward) : view.moveByChar(range, forward);
      const head = moved.head < line.from || moved.head > line.to ? range.head : moved.head;
      if (extend) return EditorSelection.range(range.anchor, head);
      // Without extending, a selection collapses to the side it moves towards, as everywhere else.
      if (!range.empty) return EditorSelection.cursor(forward ? range.to : range.from);
      return EditorSelection.cursor(head);
    }
    let next: LineColumns;
    if (extend) next = { ...c, head: Math.max(0, c.head + (forward ? 1 : -1)) };
    else if (c.anchor !== c.head) next = { ...c, anchor: forward ? Math.max(c.anchor, c.head) : Math.min(c.anchor, c.head), head: forward ? Math.max(c.anchor, c.head) : Math.min(c.anchor, c.head) };
    else next = { ...c, anchor: Math.max(0, c.head + (forward ? 1 : -1)), head: Math.max(0, c.head + (forward ? 1 : -1)) };
    const out = rangeOf(state, line, next);
    if (out.entry) virtual.push(out.entry);
    return out.range;
  });
  const selection = EditorSelection.create(ranges, state.selection.mainIndex);
  if (selection.eq(state.selection) && sameVirtualColumns(state.field(virtualColumns, false) ?? [], virtual)) return true;
  if (virtual.length > 0) virtualBySelection.set(selection, virtual);
  view.dispatch({ selection, userEvent: "select", scrollIntoView: true });
  return true;
}

/**
 * Backspace at a caret in virtual space takes one virtual column, as Scintilla's
 * `DelCharBack` does (`caret.SetVirtualSpace(caret.VirtualSpace() - 1)`, read in
 * Editor.cxx 2026-09-14); the text is untouched until the caret is real again.
 * Carets that are not virtual delete as usual, in the same transaction. Falls
 * through (false) when no caret is virtual, so CodeMirror's own command runs.
 */
export function backspaceInVirtualSpace(view: EditorView): boolean {
  const { state } = view;
  if (!state.selection.ranges.some((r) => virtualAt(state, r) !== null)) return false;
  const virtual: VirtualColumn[] = [];
  const tr = state.changeByRange((range) => {
    const entry = virtualAt(state, range);
    if (entry) {
      const lineCol = columnAt(state, range.head);
      // A selected span of virtual space collapses to its start (Scintilla: "collapse to start of virtual space"); a caret steps back.
      const col = entry.to > entry.from ? entry.from : entry.caret - 1;
      if (col > lineCol) virtual.push({ pos: range.head, from: col, to: col, caret: col });
      return { range: EditorSelection.cursor(range.head) };
    }
    const from = range.empty ? Math.max(0, range.from - 1) : range.from;
    return { changes: { from, to: range.to }, range: EditorSelection.cursor(from) };
  });
  // The virtual columns travel with the selection object (the WeakMap channel above); the field maps them through the changes.
  virtualBySelection.set(tr.selection, virtual.map((v) => ({ ...v, pos: tr.changes.mapPos(v.pos, 1) })));
  view.dispatch({ ...tr, userEvent: "delete.backward", scrollIntoView: true });
  return true;
}

/**
 * Every occurrence of the main range's text (the word at the cursor when
 * nothing is selected) becomes a selection, whatever the number of ranges;
 * the main one stays main. Capped at 1000 matches, as CodeMirror caps it.
 */
export function selectAllOccurrences(view: EditorView): boolean {
  const { state } = view;
  let { from, to } = state.selection.main;
  if (from === to) {
    const word = state.wordAt(from);
    if (!word) return false;
    from = word.from;
    to = word.to;
  }
  const text = state.sliceDoc(from, to);
  const ranges: SelectionRange[] = [];
  let main = 0;
  for (const cursor = new SearchCursor(state.doc, text); !cursor.next().done; ) {
    if (ranges.length > 1000) return false;
    if (cursor.value.from === from) main = ranges.length;
    ranges.push(EditorSelection.range(cursor.value.from, cursor.value.to));
  }
  if (ranges.length === 0) return false;
  view.dispatch({ selection: EditorSelection.create(ranges, main), userEvent: "select.search.matches" });
  return true;
}

/**
 * `@codemirror/commands` resolves its own nested `@codemirror/state` typings
 * (see codemirror.ts); a StateCommand is run through a cast.
 */
function runCommand(command: unknown, view: EditorView): boolean {
  return (command as (target: EditorView) => boolean)(view);
}

/** The commands behind the remappable editor bindings (core/hotkeys.ts, `where: "editor"`). */
const EDITOR_COMMANDS: Readonly<Record<string, (view: EditorView) => boolean>> = {
  "add-cursor-above": (view) => addCursorVertically(view, false),
  "add-cursor-below": (view) => addCursorVertically(view, true),
  "move-line-up": (view) => runCommand(moveLineUp, view),
  "move-line-down": (view) => runCommand(moveLineDown, view),
  "copy-line-up": (view) => runCommand(copyLineUp, view),
  "copy-line-down": (view) => runCommand(copyLineDown, view),
  "select-line": (view) => runCommand(selectLine, view),
  "toggle-block-comment": (view) => runCommand(toggleBlockComment, view),
};

/** The CodeMirror keys `defaultKeymap` binds to the remappable editor commands; dropped from it, so a remapped key is not still bound to the old one. */
export const DEFAULT_KEYS_TAKEN: ReadonlySet<string> = new Set(["Alt-ArrowUp", "Shift-Alt-ArrowUp", "Alt-ArrowDown", "Shift-Alt-ArrowDown", "Alt-l", "Ctrl-l", "Alt-A", "Ctrl-A", "Mod-Alt-ArrowUp", "Mod-Alt-ArrowDown"]);

/**
 * Bindings that go BEFORE `defaultKeymap`, so they win where both bind a key:
 * the remappable editor actions on their configured chords, and the arrows
 * clamped per line with several cursors.
 */
export function columnKeymap(hotkeys: Readonly<Record<string, string>>, platform: HotkeyPlatform): KeyBinding[] {
  const bindings: KeyBinding[] = [];
  for (const action of HOTKEY_ACTIONS) {
    if (action.where !== "editor") continue;
    const run = EDITOR_COMMANDS[action.id];
    if (!run) continue;
    bindings.push({ key: toCodeMirrorKey(chordFor(action.id, hotkeys, platform)), run, preventDefault: true });
  }
  bindings.push(
    { key: "ArrowLeft", run: (view) => moveWithinLine(view, false, false), shift: (view) => moveWithinLine(view, false, true) },
    { key: "ArrowRight", run: (view) => moveWithinLine(view, true, false), shift: (view) => moveWithinLine(view, true, true) },
    { key: "Mod-ArrowLeft", run: (view) => moveWithinLine(view, false, false, "group"), shift: (view) => moveWithinLine(view, false, true, "group") },
    { key: "Mod-ArrowRight", run: (view) => moveWithinLine(view, true, false, "group"), shift: (view) => moveWithinLine(view, true, true, "group") },
    { key: "Backspace", run: backspaceInVirtualSpace }
  );
  return bindings;
}

/**
 * An Alt+drag that starts inside the current selection must not become a
 * text drag. CodeMirror leaves that to the browser: a mousedown inside the
 * primary selection makes the mouse selection `dragging: null`, the browser
 * fires `dragstart` from the contenteditable, and from then on the rectangle
 * stops following the mouse (seen 2026-09-15: a rectangle drawn a second
 * time from a cell of the first froze at the point of entry into the last
 * line). Cancelling the browser's drag while Alt is down keeps the mouse
 * selection alive; the rectangle then updates once the pointer has moved 10 px.
 */
export function cancelTextDragWithAlt(event: { altKey: boolean; preventDefault: () => void }): boolean {
  if (!event.altKey) return false;
  event.preventDefault();
  return true;
}

/** The whole of column mode: Alt+drag, the virtual columns, the phantom, the padding. The keys are `columnKeymap`. */
export function columnMode(): Extension {
  return [
    virtualColumns,
    EditorView.mouseSelectionStyle.of((view, event) => (event.altKey && event.button === 0 ? rectangleSelectionStyle(view, event) : null)),
    EditorView.domEventHandlers({ dragstart: (event) => cancelTextDragWithAlt(event) }),
    phantomPlugin,
    padOnInput,
  ];
}

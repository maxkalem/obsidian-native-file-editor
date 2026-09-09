import { SearchCursor } from "@codemirror/search";
import { EditorSelection, EditorState, type Extension, type Range, type SelectionRange, StateField, countColumn, findColumn } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, type KeyBinding, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";

/**
 * Several cursors the way Notepad++ (Scintilla) has them, which the user
 * named as the model (2026-09-09). Three things CodeMirror does differently
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
 *    than one range the arrows here stop at the line's ends.
 * 3. Ctrl+Alt+Up/Down: absent from Obsidian's copy of `@codemirror/commands`
 *    (older than 6.8), so bound here, after the upstream algorithm.
 *
 * Also here: "select every occurrence" (Ctrl+Shift+L). CodeMirror's own
 * `selectSelectionMatches` refuses when there is more than one range or the
 * selection is empty, which is exactly the state after Ctrl+D; this one takes
 * the main range's text, or the word at the cursor.
 */

/** A cursor that stands, in Notepad++'s terms, past the end of its line: the position is the line's end, the column is where it wants to be. */
interface VirtualColumn {
  readonly pos: number;
  readonly col: number;
}

/**
 * The rectangle handler hands its virtual columns to the StateField through
 * the selection object itself: CodeMirror's mouse handling dispatches the
 * EditorSelection the style returns, and a transaction carries no room for
 * anything else. A WeakMap keyed by that object is the channel.
 */
const virtualBySelection = new WeakMap<EditorSelection, readonly VirtualColumn[]>();

export const virtualColumns = StateField.define<readonly VirtualColumn[]>({
  create: () => [],
  update(value, tr) {
    if (tr.selection) {
      const fresh = virtualBySelection.get(tr.selection);
      return fresh ?? [];
    }
    if (tr.docChanged) return value.map((v) => ({ pos: tr.changes.mapPos(v.pos, 1), col: v.col }));
    return value;
  },
});

/** Columns are counted the way CodeMirror counts them for the rectangle: tabs expand. */
function columnAt(state: EditorState, pos: number): number {
  const line = state.doc.lineAt(pos);
  return countColumn(line.text, state.tabSize, pos - line.from);
}

/** The virtual column of a range's head, or null when the cursor is a real one. */
function virtualAt(state: EditorState, range: SelectionRange): number | null {
  if (!range.empty) return null;
  const line = state.doc.lineAt(range.head);
  if (range.head !== line.to) return null;
  const entry = state.field(virtualColumns, false)?.find((v) => v.pos === range.head);
  if (!entry) return null;
  const col = columnAt(state, range.head);
  return entry.col > col ? entry.col : null;
}

// --- the rectangle ---------------------------------------------------------

/** Above this offset a column is taken to be the offset (CodeMirror's own shortcut for very long lines). */
const MAX_OFF = 2000;

export interface RectPos {
  readonly line: number;
  readonly col: number;
  readonly off: number;
}

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
 * One range per line of the rectangle. A line that ends before the
 * rectangle's left edge gets a cursor at its end and a virtual column; a line
 * that ends inside the rectangle gets a range to its end.
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
  for (let i = startLine; i <= endLine; i++) {
    const line = state.doc.line(i);
    const start = findColumn(line.text, startCol, state.tabSize, true);
    if (start < 0) {
      ranges.push(EditorSelection.cursor(line.to));
      virtual.push({ pos: line.to, col: startCol });
    } else {
      const end = findColumn(line.text, endCol, state.tabSize);
      ranges.push(EditorSelection.range(line.from + start, line.from + end));
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
      return rectangleSelection(view.state, start, getPos(view, event), multiple ? startSel.ranges : []) ?? startSel;
    },
  };
}

// --- the phantom and the padding -------------------------------------------

/** The spaces a virtual caret stands behind: drawn, not in the document. */
class PhantomWidget extends WidgetType {
  constructor(private readonly width: number) {
    super();
  }
  override eq(other: PhantomWidget): boolean {
    return other.width === this.width;
  }
  override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "nfe-virtual-space";
    span.textContent = " ".repeat(this.width);
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

function phantoms(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const range of state.selection.ranges) {
    const col = virtualAt(state, range);
    if (col === null) continue;
    const width = col - columnAt(state, range.head);
    // side -1: the phantom comes before the position, so the caret drawn at the position stands after it.
    ranges.push(Decoration.widget({ widget: new PhantomWidget(width), side: -1 }).range(range.head));
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
      if (update.selectionSet || update.docChanged) this.decorations = phantoms(update.state);
    }
  },
  { decorations: (v) => v.decorations }
);

/** What the first keystroke inserts at a virtual caret: the spaces up to its column, then the text. */
export function paddingFor(state: EditorState, range: SelectionRange): string {
  const col = virtualAt(state, range);
  return col === null ? "" : " ".repeat(col - columnAt(state, range.head));
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

/** After the upstream `addCursorVertically` (CodeMirror, MIT), which Obsidian's `@codemirror/commands` does not have. */
export function addCursorVertically(view: EditorView, forward: boolean): boolean {
  const { state } = view;
  const ranges = state.selection.ranges.slice();
  for (const range of state.selection.ranges) {
    const line = state.doc.lineAt(range.head);
    if (forward ? line.to >= state.doc.length : line.from <= 0) continue;
    for (let cur = range; ; ) {
      const next = view.moveVertically(cur, forward);
      if (next.head < line.from || next.head > line.to) {
        if (!ranges.some((r) => r.head === next.head)) ranges.push(next);
        break;
      }
      if (next.head === cur.head) break;
      cur = next;
    }
  }
  if (ranges.length === state.selection.ranges.length) return false;
  view.dispatch({ selection: EditorSelection.create(ranges, ranges.length - 1), userEvent: "select", scrollIntoView: true });
  return true;
}

/**
 * Left/Right (and Ctrl+Left/Right, by word) with several cursors: each moves
 * within its own line and stops at the line's ends (Notepad++). One cursor
 * falls through to CodeMirror's own command, which wraps.
 */
export function moveWithinLine(view: EditorView, forward: boolean, extend: boolean, by: "char" | "group" = "char"): boolean {
  const { state } = view;
  if (state.selection.ranges.length < 2) return false;
  const selection = EditorSelection.create(
    state.selection.ranges.map((range) => {
      const line = state.doc.lineAt(range.head);
      const moved = by === "group" ? view.moveByGroup(range, forward) : view.moveByChar(range, forward);
      const head = moved.head < line.from || moved.head > line.to ? range.head : moved.head;
      if (extend) return EditorSelection.range(range.anchor, head);
      // Without extending, a selection collapses to the side it moves towards, as everywhere else.
      if (!range.empty) return EditorSelection.cursor(forward ? range.to : range.from);
      return EditorSelection.cursor(head);
    }),
    state.selection.mainIndex
  );
  if (selection.eq(state.selection)) return true;
  view.dispatch({ selection, userEvent: "select", scrollIntoView: true });
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

/** Bindings that go BEFORE `defaultKeymap`, so they win where both bind a key. */
export const columnKeymap: readonly KeyBinding[] = [
  { key: "Mod-Alt-ArrowUp", run: (view) => addCursorVertically(view, false) },
  { key: "Mod-Alt-ArrowDown", run: (view) => addCursorVertically(view, true) },
  { key: "ArrowLeft", run: (view) => moveWithinLine(view, false, false), shift: (view) => moveWithinLine(view, false, true) },
  { key: "ArrowRight", run: (view) => moveWithinLine(view, true, false), shift: (view) => moveWithinLine(view, true, true) },
  { key: "Mod-ArrowLeft", run: (view) => moveWithinLine(view, false, false, "group"), shift: (view) => moveWithinLine(view, false, true, "group") },
  { key: "Mod-ArrowRight", run: (view) => moveWithinLine(view, true, false, "group"), shift: (view) => moveWithinLine(view, true, true, "group") },
];

/** The whole of column mode: Alt+drag, the virtual columns, the phantom, the padding. The keys are `columnKeymap`. */
export function columnMode(): Extension {
  return [virtualColumns, EditorView.mouseSelectionStyle.of((view, event) => (event.altKey && event.button === 0 ? rectangleSelectionStyle(view, event) : null)), phantomPlugin, padOnInput];
}

import { EditorState, type Extension, type Range, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/**
 * Row tints, the way Native Git Bridge (the same author's other plugin) draws
 * a diff and a conflict: the whole line takes a translucent background rather
 * than the `+`/`-` text taking a colour: the palette of its diff and conflict
 * panes. Two independent pieces:
 *
 * - `diffLineTints` for `.diff`/`.patch`/`.rej`: added lines green, removed
 *   lines red, hunk headers and file headers muted. Computed for the visible
 *   lines only, from the first character of each line.
 * - `conflictTints` for every file: the blocks between Git's markers
 *   (`<<<<<<< ours`, `=======`, `>>>>>>> theirs`, and diff3's `|||||||`)
 *   tinted ours-green and theirs-blue with a coloured edge on the marker
 *   lines. A StateField over the whole document, rebuilt on a change and
 *   skipped in a moment when the text holds no `<<<<<<<` at all.
 *
 * The colours themselves live in styles.css as `--nfe-diff-*`/`--nfe-conf-*`,
 * with Native Git Bridge's values.
 */

const DIFF_CLASSES = {
  ins: Decoration.line({ class: "nfe-diff-ins" }),
  del: Decoration.line({ class: "nfe-diff-del" }),
  hunk: Decoration.line({ class: "nfe-diff-hunk" }),
  header: Decoration.line({ class: "nfe-diff-header" }),
};

/** What a diff line is, from its first characters; null for context and anything else. */
export function diffLineKind(text: string): keyof typeof DIFF_CLASSES | null {
  if (text.startsWith("+++ ") || text.startsWith("--- ")) return "header";
  if (text.startsWith("+")) return "ins";
  if (text.startsWith("-")) return "del";
  if (text.startsWith("@@")) return "hunk";
  if (/^(diff |index |Index: |={4,}|new file mode|deleted file mode|similarity index|rename (from|to) |Binary files )/.test(text)) return "header";
  return null;
}

function diffDecorations(view: EditorView): DecorationSet {
  const ranges: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = view.state.doc.lineAt(pos);
      const kind = diffLineKind(line.text);
      if (kind) ranges.push(DIFF_CLASSES[kind].range(line.from));
      if (line.to >= to) break;
      pos = line.to + 1;
    }
  }
  return Decoration.set(ranges, true);
}

export function diffLineTints(): Extension {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = diffDecorations(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = diffDecorations(update.view);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

const CONFLICT_CLASSES = {
  oursHead: Decoration.line({ class: "nfe-conf-ours-head" }),
  ours: Decoration.line({ class: "nfe-conf-ours" }),
  base: Decoration.line({ class: "nfe-conf-base" }),
  sep: Decoration.line({ class: "nfe-conf-sep" }),
  theirs: Decoration.line({ class: "nfe-conf-theirs" }),
  theirsHead: Decoration.line({ class: "nfe-conf-theirs-head" }),
};

export type ConflictLine = keyof typeof CONFLICT_CLASSES;

/**
 * The class of every line inside a conflict, by line number (1-based), for
 * the whole text. Markers must start the line; a `<<<<<<<` without its
 * `>>>>>>>` tints to the end of the text, which is what a half-resolved
 * conflict looks like.
 */
export function conflictLines(lines: readonly string[]): Map<number, ConflictLine> {
  const out = new Map<number, ConflictLine>();
  let section: "ours" | "base" | "theirs" | null = null;
  lines.forEach((text, i) => {
    const n = i + 1;
    if (/^<{7}(\s|$)/.test(text)) {
      section = "ours";
      out.set(n, "oursHead");
      return;
    }
    if (section === null) return;
    if (/^\|{7}(\s|$)/.test(text) && section === "ours") {
      section = "base";
      out.set(n, "sep");
      return;
    }
    if (/^={7}$/.test(text) && (section === "ours" || section === "base")) {
      section = "theirs";
      out.set(n, "sep");
      return;
    }
    if (/^>{7}(\s|$)/.test(text) && section === "theirs") {
      section = null;
      out.set(n, "theirsHead");
      return;
    }
    out.set(n, section);
  });
  return out;
}

function conflictDecorations(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  if (!text.includes("<<<<<<<")) return Decoration.none;
  const ranges: Range<Decoration>[] = [];
  const lines = text.split("\n");
  for (const [n, kind] of conflictLines(lines)) ranges.push(CONFLICT_CLASSES[kind].range(state.doc.line(n).from));
  return Decoration.set(ranges, true);
}

export const conflictTints: Extension = StateField.define<DecorationSet>({
  create: conflictDecorations,
  update(value, tr) {
    return tr.docChanged ? conflictDecorations(tr.state) : value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

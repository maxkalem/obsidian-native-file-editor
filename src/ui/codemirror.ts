import { plural, t } from "../core/i18n";
import { autocompletion, completeAnyWord, startCompletion } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab, selectAll, toggleBlockComment, toggleComment } from "@codemirror/commands";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, findNext, findPrevious, highlightSelectionMatches, openSearchPanel, replaceAll, search, searchKeymap, searchPanelOpen, selectMatches, selectNextOccurrence } from "@codemirror/search";
import { Compartment, EditorSelection, EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  highlightWhitespace,
  keymap,
  lineNumbers,
} from "@codemirror/view";
import { changeCase } from "../core/editText";
import { chordFor, describeChord } from "../core/hotkeys";
import { wordAtPosition } from "../core/words";
import { OBSIDIAN_SCHEME_CLASS, nfeHighlighter } from "../highlight/highlighter";
import { forkLineHighlighter } from "../highlight/obsidianFork";
import type { EditorFactory, EditorHandle, EditorOptions, LineDirection, SelectionInfo } from "./editor";
import { DEFAULT_KEYS_TAKEN, columnKeymap, columnMode, selectAllOccurrences } from "./columnMode";
import { conflictTints, diffLineTints } from "./lineTints";
import { createSearchPanel } from "./searchPanel";

/** The gutter marker: a triangle pointing down when open, right when folded. */
function foldMarker(open: boolean): HTMLElement {
  const span = activeDocument.createElement("span");
  span.className = open ? "nfe-fold-marker nfe-fold-open" : "nfe-fold-marker nfe-fold-closed";
  span.textContent = open ? "\u25BE" : "\u25B8";
  span.title = open ? "Fold" : "Unfold";
  return span;
}

/** What a folded range collapses to: a distinct symbol, not an ellipsis that reads as text. */
function foldPlaceholder(view: EditorView, onclick: (event: Event) => void): HTMLElement {
  const span = view.dom.ownerDocument.createElement("span");
  span.className = "nfe-fold-placeholder";
  span.textContent = "\u2194";
  span.title = "Unfold";
  span.setAttribute("aria-label", t("editor.foldedCode"));
  span.onclick = onclick;
  return span;
}

/** The badge at the end of a line when invisibles are shown: the file's line ending, as Notepad++ writes it. */
class EolWidget extends WidgetType {
  constructor(private readonly label: string) {
    super();
  }
  override eq(other: EolWidget): boolean {
    return other.label === this.label;
  }
  override toDOM(view: EditorView): HTMLElement {
    const span = view.dom.ownerDocument.createElement("span");
    span.className = "nfe-eol";
    span.textContent = this.label;
    span.setAttribute("aria-hidden", "true");
    return span;
  }
  override ignoreEvent(): boolean {
    return true;
  }
}

/**
 * Invisibles: CodeMirror's own `highlightWhitespace` (a dot per space, an
 * arrow per tab, in the viewport only) plus a line-ending badge after every
 * line but the last. The text is normalised to `\n`, so the badge says what
 * the file has (`eolLabel`) rather than what the buffer holds.
 */
function eolMarkers(label: string): Extension {
  const widget = Decoration.widget({ widget: new EolWidget(label), side: 1 });
  const build = (view: EditorView): DecorationSet => {
    const ranges: Range<Decoration>[] = [];
    const lastLine = view.state.doc.lines;
    for (const { from, to } of view.visibleRanges) {
      let pos = from;
      while (pos <= to) {
        const line = view.state.doc.lineAt(pos);
        if (line.number < lastLine) ranges.push(widget.range(line.to));
        if (line.to >= to) break;
        pos = line.to + 1;
      }
    }
    return Decoration.set(ranges, true);
  };
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged) this.decorations = build(update.view);
      }
    },
    { decorations: (v) => v.decorations }
  );
}

function invisibles(options: EditorOptions): Extension {
  return options.showInvisibles ? [highlightWhitespace(), eolMarkers(options.eolLabel)] : [];
}

/**
 * Text direction. `auto` is CodeMirror's per-line detection (a line whose first
 * strong character is Arabic or Hebrew runs right to left); the two others put
 * `dir` on the content element and the whole document follows.
 */
function direction(setting: EditorOptions["textDirection"]): Extension {
  // `auto`: `unicode-bidi: plaintext` on every line (styles.css, keyed on the
  // data attribute) lets the browser pick each line's direction, and the facet
  // makes CodeMirror's cursor motion read it back per line.
  if (setting === "auto") return [EditorView.perLineTextDirection.of(true), EditorView.contentAttributes.of({ "data-nfe-dir": "auto" })];
  return EditorView.contentAttributes.of({ dir: setting, "data-nfe-dir": setting });
}

/**
 * The one character the encoding refused (TextView.markProblem): a mark
 * decoration set by an effect, cleared by any change to the document.
 */
const setProblem = StateEffect.define<{ from: number; to: number } | null>();
const problemMark = Decoration.mark({ class: "nfe-unencodable" });
const problemField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    if (tr.docChanged) value = Decoration.none;
    for (const e of tr.effects) {
      if (e.is(setProblem)) value = e.value ? Decoration.set([problemMark.range(e.value.from, e.value.to)]) : Decoration.none;
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * A direction forced on single lines from the context menu ("Left to right" /
 * "Right to left" for this line, as Obsidian's editor offers): a line
 * decoration with a class styles.css turns into `direction` and
 * `unicode-bidi: isolate`, which beats the per-line `plaintext` of the `auto`
 * setting. CodeMirror reads the computed direction back for cursor motion.
 * The marks move with the text and end with the editor; nothing is written
 * into the file.
 */
const setLineDirectionEffect = StateEffect.define<{ from: number; to: number; direction: LineDirection }>();
const lineDirectionMarks = {
  ltr: Decoration.line({ class: "nfe-line-ltr" }),
  rtl: Decoration.line({ class: "nfe-line-rtl" }),
};
const lineDirectionField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(value, tr) {
    value = value.map(tr.changes);
    for (const e of tr.effects) {
      if (!e.is(setLineDirectionEffect)) continue;
      const { from, to, direction } = e.value;
      const first = tr.state.doc.lineAt(from);
      const last = tr.state.doc.lineAt(to);
      const add: Range<Decoration>[] = [];
      if (direction) {
        for (let n = first.number; n <= last.number; n++) add.push(lineDirectionMarks[direction].range(tr.state.doc.line(n).from));
      }
      value = value.update({ filter: (pos) => pos < first.from || pos > last.from, add });
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

/**
 * Completion on request only (Ctrl+Space and the context menu): the words of
 * this document through `completeAnyWord`, registered as language data for
 * every language so the sources a grammar brings are offered as well. Nothing
 * pops up while typing; a code file is not a form.
 */
function completion(): Extension {
  return [autocompletion({ activateOnTyping: false }), EditorState.languageData.of(() => [{ autocomplete: completeAnyWord }])];
}

function selectionInfo(state: EditorState): SelectionInfo {
  const parts = state.selection.ranges.filter((r) => !r.empty).map((r) => state.sliceDoc(r.from, r.to));
  return { text: parts.join(state.lineBreak), empty: parts.length === 0 };
}

/**
 * A right click outside the selection puts the cursor there first, as every
 * editor does, then the view builds its menu from what is selected.
 */
function contextMenu(options: EditorOptions): Extension {
  const open = options.onContextMenu;
  if (!open) return [];
  return EditorView.domEventHandlers({
    contextmenu(evt, view) {
      const pos = view.posAtCoords({ x: evt.clientX, y: evt.clientY });
      if (pos !== null && !view.state.selection.ranges.some((r) => r.from <= pos && pos <= r.to)) view.dispatch({ selection: { anchor: pos } });
      open(evt, selectionInfo(view.state));
      return true;
    },
  });
}

/**
 * `@codemirror/commands` resolves its own nested `@codemirror/state` typings
 * (npm puts 6.7 under it beside the 6.5 Obsidian pins), so a StateCommand does
 * not accept the view by type. At runtime both are Obsidian's one module.
 */
function runStateCommand(command: unknown, view: EditorView): boolean {
  return (command as (target: EditorView) => boolean)(view);
}

/** A clipboard when the platform has one; the menu items do nothing quietly otherwise. */
function clipboard(): { writeText(text: string): Promise<void>; readText(): Promise<string> } | null {
  const c = (globalThis as { navigator?: { clipboard?: { writeText?: unknown; readText?: unknown } } }).navigator?.clipboard;
  return c && typeof c.writeText === "function" && typeof c.readText === "function" ? (c as { writeText(text: string): Promise<void>; readText(): Promise<string> }) : null;
}

/**
 * The plugin's own extension set on the CodeMirror core Obsidian provides.
 * Obsidian's Markdown-specific extensions are not attached, and no theme object
 * is used anywhere: the editor root carries Obsidian's own `cm-s-obsidian`
 * class, so Obsidian's stylesheet and the active theme colour the tokens the
 * way they colour a code block in a note, and styles.css adds only what
 * Obsidian has no rule for.
 */
export function buildExtensions(options: EditorOptions, wrap: Compartment = new Compartment(), marks: Compartment = new Compartment(), dir: Compartment = new Compartment()): Extension[] {
  const ext: Extension[] = [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    columnMode(),
    highlightSelectionMatches(),
    search({ top: true, createPanel: (view) => createSearchPanel(view, { hints: options.searchHints, readOnly: options.readOnly, keyOf: (id) => describeChord(chordFor(id, options.hotkeys, options.platform), options.platform === "mac") }) }),
    problemField,
    lineDirectionField,
    conflictTints,
    ...(options.languageName === "Diff" ? [diffLineTints()] : []),
    contextMenu(options),
    syntaxHighlighting(nfeHighlighter),
    codeFolding({ placeholderDOM: foldPlaceholder }),
    // Obsidian's fork colours stream-mode tokens with its own decorator, which
    // StreamLanguage.define() does not include (obsidianFork.ts). Absent
    // elsewhere; harmless on lezer trees.
    ...(forkLineHighlighter ? [forkLineHighlighter] : []),
    EditorView.editorAttributes.of({ class: OBSIDIAN_SCHEME_CLASS }),
    EditorState.tabSize.of(options.tabSize),
    indentUnit.of(options.tabInsertsSpaces ? " ".repeat(options.tabSize) : "\t"),
    // The plugin's bindings first (the remappable ones on their configured chords), then CodeMirror's own without the keys the remappable commands had by default.
    keymap.of([...columnKeymap(options.hotkeys, options.platform), ...defaultKeymap.filter((b) => !b.key || !DEFAULT_KEYS_TAKEN.has(b.key)), ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange();
      // The panel is state, not DOM: the head's search button follows it here.
      if (options.onSearchToggle) {
        const was = searchPanelOpen(update.startState);
        const is = searchPanelOpen(update.state);
        if (was !== is) options.onSearchToggle(is);
      }
    }),
    // Wrapping and invisibles live in compartments so the pane menu can switch them live.
    wrap.of(options.wordWrap ? EditorView.lineWrapping : []),
    marks.of(invisibles(options)),
    dir.of(direction(options.textDirection)),
  ];
  if (options.language !== null) ext.push(options.language);
  // The active-line highlight follows the caret; a read-only view has none.
  if (!options.readOnly) ext.push(highlightActiveLine(), completion());
  if (options.lineNumbers) ext.push(lineNumbers(), foldGutter({ markerDOM: foldMarker }));
  if (options.lineNumbers && !options.readOnly) ext.push(highlightActiveLineGutter());
  if (options.readOnly) ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  return ext;
}

export const codeMirrorFactory: EditorFactory = {
  create(parent: HTMLElement, options: EditorOptions): EditorHandle {
    const wrap = new Compartment();
    const marks = new Compartment();
    const dir = new Compartment();
    const view = new EditorView({
      state: EditorState.create({ doc: options.text, extensions: buildExtensions(options, wrap, marks, dir) }),
      parent,
    });
    return {
      getText: () => view.state.doc.toString(),
      setText: (text: string) => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      focus: () => view.focus(),
      destroy: () => view.destroy(),
      openSearch: () => void openSearchPanel(view),
      closeSearch: () => {
        closeSearchPanel(view);
        view.focus();
      },
      isSearchOpen: () => searchPanelOpen(view.state),
      findNext: () => void findNext(view),
      findPrevious: () => void findPrevious(view),
      selectAllMatches: () => {
        selectMatches(view);
        view.focus();
      },
      replaceAllMatches: () => {
        if (!options.readOnly) replaceAll(view);
      },
      selectNextOccurrence: () => {
        selectNextOccurrence(view);
        view.focus();
      },
      selectAllOccurrences: () => {
        selectAllOccurrences(view);
        view.focus();
      },
      selection: () => selectionInfo(view.state),
      copy: async () => {
        const { text, empty } = selectionInfo(view.state);
        if (!empty) await clipboard()?.writeText(text);
      },
      cut: async () => {
        if (options.readOnly) return;
        const { text, empty } = selectionInfo(view.state);
        if (empty) return;
        await clipboard()?.writeText(text);
        view.dispatch(view.state.replaceSelection(""));
        view.focus();
      },
      paste: async () => {
        if (options.readOnly) return;
        const text = await clipboard()?.readText();
        if (text) view.dispatch(view.state.replaceSelection(text));
        view.focus();
      },
      selectAll: () => {
        runStateCommand(selectAll, view);
        view.focus();
      },
      wordAtCursor: () => {
        const head = view.state.selection.main.head;
        const line = view.state.doc.lineAt(head);
        return wordAtPosition(line.text, head - line.from);
      },
      transformLines: (transform) => {
        if (options.readOnly) return false;
        const { state } = view;
        const range = state.selection.main;
        const from = range.empty ? 0 : state.doc.lineAt(range.from).from;
        const to = range.empty ? state.doc.length : state.doc.lineAt(range.to).to;
        const before = state.sliceDoc(from, to);
        const after = transform(before, from === 0, state.doc.toString());
        if (after === null || after === before) return false;
        view.dispatch({
          changes: { from, to, insert: after },
          selection: range.empty ? undefined : EditorSelection.range(from, from + after.length),
          userEvent: "input.format",
        });
        view.focus();
        return true;
      },
      changeCase: (kind) => {
        if (options.readOnly) return;
        view.dispatch(
          view.state.changeByRange((range) => {
            let { from, to } = range;
            if (range.empty) {
              const word = view.state.wordAt(range.head);
              if (!word) return { range };
              from = word.from;
              to = word.to;
            }
            const text = changeCase(view.state.sliceDoc(from, to), kind);
            return { changes: { from, to, insert: text }, range: EditorSelection.range(from, from + text.length) };
          })
        );
        view.focus();
      },
      toggleLineComment: () => !options.readOnly && runStateCommand(toggleComment, view),
      toggleBlockComment: () => !options.readOnly && runStateCommand(toggleBlockComment, view),
      startCompletion: () => {
        if (options.readOnly) return;
        view.focus();
        startCompletion(view);
      },
      insertText: (text) => {
        if (options.readOnly) return;
        view.dispatch(view.state.replaceSelection(text));
        view.focus();
      },
      setLineDirection: (direction) => {
        const { from, to } = view.state.selection.main;
        view.dispatch({ effects: setLineDirectionEffect.of({ from, to, direction }) });
      },
      lineDirection: () => {
        const line = view.state.doc.lineAt(view.state.selection.main.head);
        let found: LineDirection = null;
        view.state.field(lineDirectionField).between(line.from, line.from, (_from, _to, value) => {
          found = value.spec.class === "nfe-line-rtl" ? "rtl" : value.spec.class === "nfe-line-ltr" ? "ltr" : null;
        });
        return found;
      },
      setWordWrap: (on: boolean) => {
        view.dispatch({ effects: wrap.reconfigure(on ? EditorView.lineWrapping : []) });
      },
      setInvisibles: (on: boolean) => {
        view.dispatch({ effects: marks.reconfigure(invisibles({ ...options, showInvisibles: on })) });
      },
      setTextDirection: (setting) => {
        view.dispatch({ effects: dir.reconfigure(direction(setting)) });
      },
      markProblem: (problem) => {
        if (!problem) {
          view.dispatch({ effects: setProblem.of(null) });
          return;
        }
        const doc = view.state.doc;
        if (problem.line < 1 || problem.line > doc.lines) return;
        const line = doc.line(problem.line);
        const from = Math.min(line.from + problem.column - 1, line.to);
        const to = Math.min(from + Math.max(problem.length, 1), line.to);
        view.dispatch({ effects: setProblem.of({ from, to }), selection: { anchor: from, head: to }, scrollIntoView: true });
      },
    };
  },
};

import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { closeSearchPanel, findNext, findPrevious, highlightSelectionMatches, openSearchPanel, search, searchKeymap, searchPanelOpen } from "@codemirror/search";
import { Compartment, EditorState, type Extension, type Range, StateEffect, StateField } from "@codemirror/state";
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
  rectangularSelection,
} from "@codemirror/view";
import { OBSIDIAN_SCHEME_CLASS, nfeHighlighter } from "../highlight/highlighter";
import { forkLineHighlighter } from "../highlight/obsidianFork";
import type { EditorFactory, EditorHandle, EditorOptions } from "./editor";
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
  span.setAttribute("aria-label", "folded code");
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
    rectangularSelection(),
    highlightSelectionMatches(),
    search({ top: true, createPanel: (view) => createSearchPanel(view, { hints: options.searchHints, readOnly: options.readOnly, help: options.regexHelp }) }),
    problemField,
    syntaxHighlighting(nfeHighlighter),
    codeFolding({ placeholderDOM: foldPlaceholder }),
    // Obsidian's fork colours stream-mode tokens with its own decorator, which
    // StreamLanguage.define() does not include (obsidianFork.ts). Absent
    // elsewhere; harmless on lezer trees.
    ...(forkLineHighlighter ? [forkLineHighlighter] : []),
    EditorView.editorAttributes.of({ class: OBSIDIAN_SCHEME_CLASS }),
    EditorState.tabSize.of(options.tabSize),
    indentUnit.of(options.tabInsertsSpaces ? " ".repeat(options.tabSize) : "\t"),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
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
  if (!options.readOnly) ext.push(highlightActiveLine());
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

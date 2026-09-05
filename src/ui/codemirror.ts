import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, codeFolding, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import {
  EditorView,
  drawSelection,
  dropCursor,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from "@codemirror/view";
import { OBSIDIAN_SCHEME_CLASS, nfeHighlighter } from "../highlight/highlighter";
import { forkLineHighlighter } from "../highlight/obsidianFork";
import type { EditorFactory, EditorHandle, EditorOptions } from "./editor";

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

/**
 * The plugin's own extension set on the CodeMirror core Obsidian provides.
 * Obsidian's Markdown-specific extensions are not attached, and no theme object
 * is used anywhere: the editor root carries Obsidian's own `cm-s-obsidian`
 * class, so Obsidian's stylesheet and the active theme colour the tokens the
 * way they colour a code block in a note, and styles.css adds only what
 * Obsidian has no rule for.
 */
export function buildExtensions(options: EditorOptions): Extension[] {
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
    search({ top: true }),
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
    }),
  ];
  if (options.language !== null) ext.push(options.language);
  // The active-line highlight follows the caret; a read-only view has none.
  if (!options.readOnly) ext.push(highlightActiveLine());
  if (options.lineNumbers) ext.push(lineNumbers(), foldGutter({ markerDOM: foldMarker }));
  if (options.lineNumbers && !options.readOnly) ext.push(highlightActiveLineGutter());
  if (options.wordWrap) ext.push(EditorView.lineWrapping);
  if (options.readOnly) ext.push(EditorState.readOnly.of(true), EditorView.editable.of(false));
  return ext;
}

export const codeMirrorFactory: EditorFactory = {
  create(parent: HTMLElement, options: EditorOptions): EditorHandle {
    const view = new EditorView({
      state: EditorState.create({ doc: options.text, extensions: buildExtensions(options) }),
      parent,
    });
    return {
      getText: () => view.state.doc.toString(),
      setText: (text: string) => {
        view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } });
      },
      focus: () => view.focus(),
      destroy: () => view.destroy(),
    };
  },
};

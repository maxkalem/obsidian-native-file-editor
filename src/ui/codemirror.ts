import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
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
import { nfeHighlighter } from "../highlight/highlighter";
import type { EditorFactory, EditorHandle, EditorOptions } from "./editor";

/**
 * The plugin's own extension set on the CodeMirror core Obsidian provides.
 * Obsidian's Markdown-specific extensions are not attached, and no theme object
 * is used anywhere: the look comes from styles.css through Obsidian's
 * variables, which is what keeps every palette a plain CSS file.
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
    highlightActiveLine(),
    highlightSelectionMatches(),
    search({ top: true }),
    syntaxHighlighting(nfeHighlighter),
    EditorState.tabSize.of(options.tabSize),
    indentUnit.of(options.tabInsertsSpaces ? " ".repeat(options.tabSize) : "\t"),
    keymap.of([...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) options.onChange();
    }),
  ];
  if (options.language !== null) ext.push(options.language);
  if (options.lineNumbers) ext.push(lineNumbers(), highlightActiveLineGutter(), foldGutter());
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

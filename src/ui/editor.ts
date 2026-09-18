import type { Extension } from "@codemirror/state";
import type { CaseKind } from "../core/editText";
import type { HotkeyPlatform } from "../core/hotkeys";

/**
 * What the text view needs from an editor, without naming CodeMirror. The
 * view is built against this interface so a test can hand in a fake and drive
 * mode switches and autosave without a real DOM; codemirror.ts is the one
 * implementation.
 */

export interface EditorOptions {
  readonly text: string;
  /** The language support from the registry, or null for plain text. */
  readonly language: Extension | null;
  /** The registry's name for it ("Diff" turns on the diff row tints), or null. */
  readonly languageName: string | null;
  readonly readOnly: boolean;
  readonly lineNumbers: boolean;
  readonly wordWrap: boolean;
  /** Spaces, tabs and line ends made visible; `eolLabel` is what the badge at each line end says (LF, CRLF, CR). */
  readonly showInvisibles: boolean;
  readonly eolLabel: string;
  /** `auto`: each line by its first strong character; `ltr`/`rtl`: the whole document. */
  readonly textDirection: "auto" | "ltr" | "rtl";
  /** Whether the search panel's buttons spell out their shortcuts. */
  readonly searchHints: () => boolean;
  /** The user's key remapping for THIS platform (core/hotkeys.ts) and which platform it is, consulted when the editor is built; a change applies to editors built afterwards. */
  readonly hotkeys: Readonly<Record<string, string>>;
  readonly platform: HotkeyPlatform;
  readonly tabSize: number;
  readonly tabInsertsSpaces: boolean;
  /** Called after every document change. */
  readonly onChange: () => void;
  /** Called when the search panel opens or closes, so the head can follow. */
  readonly onSearchToggle?: (open: boolean) => void;
  /**
   * Called on a right click in the text, with what is selected, so the view
   * can show its context menu. Absent, the browser's default menu shows.
   */
  readonly onContextMenu?: (evt: MouseEvent, selection: SelectionInfo) => void;
}

/** What a right click or a menu needs to know about the selection. */
export interface SelectionInfo {
  /** The selected text of every range, joined with line breaks; empty when nothing is selected. */
  readonly text: string;
  readonly empty: boolean;
}

export type { CaseKind };
export type LineDirection = "ltr" | "rtl" | null;

export interface EditorHandle {
  getText(): string;
  /** Replace the whole document, for example after the file changed on disk. */
  setText(text: string): void;
  focus(): void;
  destroy(): void;
  /** The search panel: open it (focusing its field), close it, ask whether it is open. */
  openSearch(): void;
  closeSearch(): void;
  isSearchOpen(): boolean;
  /** Move to the next or previous match of the current query, without opening the panel. */
  findNext(): void;
  findPrevious(): void;
  /** Every match of the current query becomes a selection and the editor takes the focus, so typing changes all of them. */
  selectAllMatches(): void;
  /** Replace every match with the panel's Replace text (the editor only). */
  replaceAllMatches(): void;
  /** Add the next occurrence of the selected text (the word at the cursor when nothing is selected) as another selection. */
  selectNextOccurrence(): void;
  /** Every occurrence of the main selection's text (the word at the cursor when nothing is selected) becomes a selection. */
  selectAllOccurrences(): void;
  /** What the context menu asks about before it is built. */
  selection(): SelectionInfo;
  /** Clipboard and selection, as the context menu offers them. Paste and cut do nothing in a read-only view. */
  cut(): Promise<void>;
  copy(): Promise<void>;
  paste(): Promise<void>;
  selectAll(): void;
  /** Change the case of the selected text (the word at each cursor when nothing is selected). */
  changeCase(kind: CaseKind): void;
  /** Toggle the language's line or block comment on the selection; false when the language has no such comment. */
  toggleLineComment(): boolean;
  toggleBlockComment(): boolean;
  /** Open the completion list at the cursor: words of this document and what the language offers. */
  startCompletion(): void;
  /** Insert text at every cursor, replacing what is selected. */
  insertText(text: string): void;
  /**
   * The lines the main selection touches (the whole document when nothing is
   * selected), handed to `transform` as one text with `\n` line breaks and
   * replaced by what comes back, as one undo step; `null` or the same text
   * changes nothing. `atDocumentStart` says whether the first of those lines is
   * the document's first, and `document` is the whole text, which a transform
   * that learns from the words around the selection reads. Returns whether the
   * document changed.
   */
  transformLines(transform: (text: string, atDocumentStart: boolean, document: string) => string | null): boolean;
  /** The word the main cursor stands in, hyphens and apostrophes included; empty when it stands on none. */
  wordAtCursor(): string;
  /** Force the direction of the lines the selection touches, or `null` to go back to the content's own. Lives with the editor, not the file. */
  setLineDirection(direction: LineDirection): void;
  /** The forced direction of the line the main cursor is on, or `null`. */
  lineDirection(): LineDirection;
  /** Switch line wrapping without rebuilding the editor. */
  setWordWrap(on: boolean): void;
  /** Switch the whitespace and line-ending markers without rebuilding the editor. */
  setInvisibles(on: boolean): void;
  /** Switch the text direction without rebuilding the editor. */
  setTextDirection(direction: "auto" | "ltr" | "rtl"): void;
  /**
   * Mark one character the file's encoding cannot hold (1-based line and
   * column in the editor's text), or clear the mark. The mark goes away on
   * the next edit either way.
   */
  markProblem(problem: { line: number; column: number; length: number } | null): void;
}

export interface EditorFactory {
  create(parent: HTMLElement, options: EditorOptions): EditorHandle;
}

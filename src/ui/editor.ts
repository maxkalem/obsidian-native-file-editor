import type { Extension } from "@codemirror/state";

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
  /** Opens the regular-expression guide; the panel shows a `?` when present. */
  readonly regexHelp?: () => void;
  readonly tabSize: number;
  readonly tabInsertsSpaces: boolean;
  /** Called after every document change. */
  readonly onChange: () => void;
  /** Called when the search panel opens or closes, so the head can follow. */
  readonly onSearchToggle?: (open: boolean) => void;
}

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

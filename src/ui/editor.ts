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
  readonly tabSize: number;
  readonly tabInsertsSpaces: boolean;
  /** Called after every document change. */
  readonly onChange: () => void;
}

export interface EditorHandle {
  getText(): string;
  /** Replace the whole document, for example after the file changed on disk. */
  setText(text: string): void;
  focus(): void;
  destroy(): void;
}

export interface EditorFactory {
  create(parent: HTMLElement, options: EditorOptions): EditorHandle;
}

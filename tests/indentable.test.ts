import { describe, expect, it } from "vitest";
import { javascript } from "@codemirror/lang-javascript";
import { getIndentation } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { indentable } from "../src/ui/indentable";

/**
 * Whether the Format group appears for a language only indentation can
 * format: the question is asked of the document, not of a table.
 */

const plain = (text: string) => EditorState.create({ doc: text });
const js = (text: string) => EditorState.create({ doc: text, extensions: [javascript()] });

describe("indentable", () => {
  it("is false for plain text, although CodeMirror indents offset 0 even with no language", () => {
    const state = plain("Plain UTF-8 text.\nSecond line.\nThird line.\n");
    // The trap this guards against: the first line alone would say yes.
    expect(getIndentation(state, 0)).toBe(0);
    expect(getIndentation(state, state.doc.line(2).from)).toBeNull();
    expect(indentable(state)).toBe(false);
  });

  it("is true for a language with a grammar, from the second line on", () => {
    expect(indentable(js("function f() {\n  return 1;\n}\n"))).toBe(true);
    // Blank lines are skipped, not counted as evidence either way.
    expect(indentable(js("const a = 1;\n\n\nconst b = 2;\n"))).toBe(true);
  });

  it("is false for a one-line file: there is nothing to reindent", () => {
    expect(indentable(js("const a = 1;"))).toBe(false);
    expect(indentable(plain("one line"))).toBe(false);
  });
});

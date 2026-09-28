import { describe, expect, it } from "vitest";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { IndentContext, ensureSyntaxTree, getIndentation, indentRange, indentUnit } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { bracketDepthIndent } from "../src/ui/bracketDepth";

/**
 * Brackets indent by depth. CodeMirror's own rule aligns the content of a
 * bracket to the bracket when a token follows it on the same line, which put
 * a Rust body one level deep and the outer `}` at column 29.
 */

function state(text: string, lang: Extension, own = true): EditorState {
  const st = EditorState.create({ doc: text, extensions: [lang, indentUnit.of("    "), EditorState.tabSize.of(4), ...(own ? [bracketDepthIndent()] : [])] });
  ensureSyntaxTree(st, st.doc.length, 5000);
  return st;
}

function reindented(text: string, lang: Extension, own = true): string {
  const st = state(text, lang, own);
  return st.update({ changes: indentRange(st, 0, st.doc.length) }).state.doc.toString();
}

const joined = ["impl<'a> Sized2 for Note<'a> {    fn size(&self) -> u64 {", "fs::metadata(self.path).map(|m| m.len()).unwrap_or(0)", "}", "}", ""].join("\n");

describe("bracketDepth", () => {
  it("indents a body two levels deep when its line opens two brackets, and closes each at its depth", () => {
    expect(reindented(joined, rust())).toBe(["impl<'a> Sized2 for Note<'a> {    fn size(&self) -> u64 {", "        fs::metadata(self.path).map(|m| m.len()).unwrap_or(0)", "    }", "}", ""].join("\n"));
  });

  it("is a change from CodeMirror's own rule, which aligns to the bracket's column", () => {
    const theirs = reindented(joined, rust(), false);
    expect(theirs.split("\n")[1]).toBe("    fs::metadata(self.path).map(|m| m.len()).unwrap_or(0)");
    expect(theirs.split("\n")[3]).toBe(" ".repeat(29) + "}");
  });

  it("leaves the ordinary shape, one bracket per line, as it was", () => {
    const text = ["pub fn group() {", "    let mut out = 1;", "    for note in notes {", "        out += 1;", "    }", "    match out {", "        0 => println!(\"none\"),", "        n => println!(\"{n}\"),", "    }", "    out", "}", ""].join("\n");
    expect(reindented(text, rust())).toBe(text);
  });

  it("gives up the aligned argument style: a wrapped argument goes one unit in, not under the first", () => {
    const text = "foo(a,\n         b);\n";
    expect(reindented(text, javascript())).toBe("foo(a,\n    b);\n");
    expect(reindented(text, javascript(), false)).toBe("foo(a,\n    b);\n");
  });

  it("counts every bracket opened on the reference line", () => {
    expect(reindented("a({ b: [1,\n2] });\n", javascript())).toBe("a({ b: [1,\n            2] });\n");
  });

  it("leaves nodes with a strategy of their own to CodeMirror", () => {
    // A continued `if` head is CodeMirror's rule. lang-python gives every
    // bracket a strategy of its own, so Python keeps CodeMirror's alignment
    // throughout: the parameter under the first, the operand under `a`.
    expect(reindented("if (a &&\nb) {\nc;\n}\n", javascript())).toBe("if (a &&\n    b) {\n    c;\n}\n");
    expect(reindented("def f(a,\nb):\nreturn (a +\nb)\n", python())).toBe("def f(a,\n      b):\n    return (a +\n            b)\n");
  });

  it("answers nothing for a tree without brackets, so plain text still says null", () => {
    const st = state("one\ntwo\n", [], true);
    expect(getIndentation(st, st.doc.line(2).from)).toBeNull();
  });

  it("puts a closer typed after Enter at the bracket's depth, and a body between brackets one deeper", () => {
    // What `insertNewlineAndIndent` asks: a simulated break at the cursor.
    const st = state("fn f() {}\n", rust());
    const at = "fn f() {".length;
    expect(getIndentation(new IndentContext(st, { simulateBreak: at, simulateDoubleBreak: true }), at)).toBe(4);
    expect(getIndentation(new IndentContext(st, { simulateBreak: at }), at)).toBe(0);
  });
});

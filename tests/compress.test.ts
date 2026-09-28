import { describe, expect, it } from "vitest";
import { cpp } from "@codemirror/lang-cpp";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { StreamLanguage, type Language, ensureSyntaxTree } from "@codemirror/language";
import { clojure } from "@codemirror/legacy-modes/mode/clojure";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { EditorState } from "@codemirror/state";
import { compress } from "../src/fmt/compress";
import { planCompress } from "../src/fmt/format";
import { whitespaceRuleFor } from "../src/fmt/whitespace";
import { segmentsOf } from "../src/highlight/highlighter";

/**
 * The generic compressor: whitespace and comments go as far as the language
 * allows, strings stay, and two tokens never become one.
 */

function segments(text: string, language: Language) {
  const state = EditorState.create({ doc: text, extensions: [language] });
  const tree = ensureSyntaxTree(state, text.length, 5000);
  if (!tree) throw new Error("parse timed out");
  return segmentsOf(text, tree);
}

function run(text: string, language: Language, name: string) {
  return compress(text, segments(text, language), whitespaceRuleFor(name));
}

const js = javascript().language;
const ts = javascript({ typescript: true }).language;
const rs = rust().language;
const c = cpp().language;
const py = python().language;
const cssLang = css().language;
const sh = StreamLanguage.define(shell);
const rb = StreamLanguage.define(ruby);
const clj = StreamLanguage.define(clojure);

describe("segments", () => {
  it("cuts a document into code, strings and comments, in order and without gaps", () => {
    const text = 'a = "x y"; // c\nb = 1; /* d\n e */ c = `t ${a} u`;\n';
    const out = segments(text, js);
    expect(out.map((s) => s.kind)).toEqual(["code", "string", "code", "comment", "code", "comment", "code", "string", "code", "string", "code"]);
    expect(out[0]!.from).toBe(0);
    expect(out.at(-1)!.to).toBe(text.length);
    for (let i = 1; i < out.length; i++) expect(out[i]!.from).toBe(out[i - 1]!.to);
    // A block comment across lines is one segment.
    expect(text.slice(out[5]!.from, out[5]!.to)).toBe("/* d\n e */");
  });

  it("on a stream mode joins the per-line tokens of a block comment and leaves two line comments apart", () => {
    const text = "x = 1 # one\n# two\ny = 2 =begin\nblock\n=end\nz\n";
    const out = segments(text, rb).filter((s) => s.kind === "comment").map((s) => text.slice(s.from, s.to));
    expect(out.slice(0, 2)).toEqual(["# one", "# two"]);
  });
});

describe("compress, free languages", () => {
  it("drops whitespace, indentation, blank lines and comments, and keeps the strings", () => {
    const text = 'fn main() {\n    // says hello\n    let s = "a  b";\n\n    println!("{}", s);\n}\n';
    expect(run(text, rs, "Rust")).toEqual({ text: 'fn main(){let s="a  b";println!("{}",s);}\n', comments: 1 });
  });

  it("keeps a space where two tokens would become one", () => {
    expect(run("let a = b - -c;\nlet d = e / *f;\nlet g = 1 .toString();\nreturn x;\nelse if (y) {}\n", js, "JSON").text).toBe("let a=b - -c;let d=e/ *f;let g=1 .toString();return x;else if(y){}\n");
  });

  it("keeps a space before a sign after a word: `1px -1px` is two dimensions and `1px-1px` one", () => {
    expect(run("a {\n  margin: 1px -1px;\n  top: -1px;\n}\n", cssLang, "CSS").text).toBe("a{margin:1px -1px;top: -1px;}\n");
  });

  it("keeps one line break per statement where a newline can be the terminator, and joins where it cannot", () => {
    const text = "const a = 1\nconst b = [\n  1,\n  2\n]\nfoo(\n  a,\n  b\n)\nreturn\n";
    expect(run(text, ts, "TypeScript").text).toBe("const a=1\nconst b=[1,2]\nfoo(a,b)\nreturn\n");
  });

  it("reads the line break inside a block comment as a line break, as semicolon insertion does", () => {
    expect(run("a = b /* c\n */ + d\n", js, "JavaScript").text).toBe("a=b\n+d\n");
  });

  it("keeps the line breaks around a preprocessor directive and no others, and one space inside it: `LIMIT (5)` is not `LIMIT(5)`", () => {
    const text = '#include   <stdio.h>\n#define LIMIT (5 * 1024)\nint main(void) {\n    return LIMIT;\n}\n';
    expect(run(text, c, "C/C++").text).toBe("#include <stdio.h>\n#define LIMIT (5 * 1024)\nint main(void){return LIMIT;}\n");
  });

  it("keeps a word and a quote apart, and a word and a sign", () => {
    expect(run('foo "a" if x\nputs -1\n', rb, "Ruby").text).toBe('foo "a" if x\nputs -1\n');
    expect(run('return "x";\n', js, "JavaScript").text).toBe('return "x";\n');
  });

  it("collapses to one space and never to none where whitespace separates every token", () => {
    expect(run("(defn f [a b]\n  (+ a   b))\n", clj, "Clojure").text).toBe("(defn f [a b] (+ a b))\n");
    expect(run('if [ -z "$x" ]; then\n  echo  "a"   b\nfi\n', sh, "Shell").text).toBe('if [ -z "$x" ]; then\necho "a" b\nfi\n');
  });

  it("is idempotent", () => {
    const text = 'fn main() {\n    // c\n    let s = "a  b";\n\n    println!("{}", s);\n}\n';
    const once = run(text, rs, "Rust").text;
    expect(run(once, rs, "Rust").text).toBe(once);
  });

  it("keeps a CRLF file on CRLF", () => {
    expect(run("const a = 1\r\nconst b = 2\r\n", ts, "TypeScript").text).toBe("const a=1\r\nconst b=2\r\n");
  });
});

describe("compress, significant languages", () => {
  it("takes only trailing whitespace, extra blank lines and comments", () => {
    const text = "def f(a):  \n    # says\n    return a  # here\n\n\n\nprint(f(1))\n";
    expect(run(text, py, "Python")).toEqual({ text: "def f(a):\n    return a\n\nprint(f(1))\n", comments: 2 });
  });

  it("keeps what the row keeps: Markdown's hard breaks and comments", () => {
    const rule = whitespaceRuleFor("Markdown");
    const text = "a  \nb\n\n\n<!-- marker -->\n";
    const segs = [
      { from: 0, to: 8, kind: "code" as const },
      { from: 8, to: 23, kind: "comment" as const },
      { from: 23, to: text.length, kind: "code" as const },
    ];
    expect(compress(text, segs, rule).text).toBe("a  \nb\n\n<!-- marker -->\n");
  });
});

describe("the plan", () => {
  it("routes JSON, XML and HTML to the own compressors, code to the generic one, and gives records and the template markup no row", () => {
    expect(planCompress("JSON").kind).toBe("own");
    expect(planCompress("XML").kind).toBe("own");
    expect(planCompress("HTML").kind).toBe("own");
    expect(planCompress("Rust").kind).toBe("tree");
    expect(planCompress("Python").kind).toBe("tree");
    expect(planCompress(null).kind).toBe("tree");
    expect(planCompress("Diff").kind).toBe("none");
    expect(planCompress("PHP").kind).toBe("none");
    expect(planCompress("Svelte").kind).toBe("none");
  });
});

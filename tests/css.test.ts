import { describe, expect, it } from "vitest";
import { css } from "@codemirror/lang-css";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { compressCss, formatCss } from "../src/fmt/css";
import { compressOwn, formatOwn, planCompress, planFormat } from "../src/fmt/format";

/** The own CSS formatter: one declaration per line, the values as their tokens stand. */

const CSS = css().language;

function parse(text: string): Tree {
  const state = EditorState.create({ doc: text, extensions: [CSS] });
  const tree = ensureSyntaxTree(state, text.length, 5000);
  if (!tree) throw new Error("parse timed out");
  return tree;
}

const fmt = (text: string, indent = "  ") => formatCss(text, parse(text), { indent, eol: "\n" });
const min = (text: string) => compressCss(text, parse(text));

const SHEET = [
  '@charset "utf-8";',
  '@import url("a.css")   screen;',
  "",
  ":root{--x: 1px;--y:{a:b}}",
  "/* c */",
  "a>b,.c:hover::after{color:red !important;margin:0 auto;background:url(x y.png) no-repeat;font-family:\"A  B\",serif;width:calc(100% - 2px);c:rgba(0,0,0,.1)}",
  "@media (max-width:600px){a{color:blue}}",
  "",
  "",
  "@font-face{font-family:\"F\";src:url(f.woff)}",
  "@keyframes k{from{top:0}50%{top:1px}to{top:2px}}",
  "h1{}",
  "",
].join("\n");

describe("formatCss", () => {
  it("puts one rule and one declaration per line, joins selectors with a comma and a space, and keeps one blank line between groups", () => {
    expect(fmt(SHEET).text).toBe(
      [
        '@charset "utf-8";',
        '@import url("a.css") screen;',
        "",
        ":root {",
        "  --x: 1px;",
        "  --y: {a:b};",
        "}",
        "/* c */",
        "a>b, .c:hover::after {",
        "  color: red !important;",
        "  margin: 0 auto;",
        "  background: url(x y.png) no-repeat;",
        '  font-family: "A  B", serif;',
        "  width: calc(100% - 2px);",
        "  c: rgba(0,0,0,.1);",
        "}",
        "@media (max-width:600px) {",
        "  a {",
        "    color: blue;",
        "  }",
        "}",
        "",
        "@font-face {",
        '  font-family: "F";',
        "  src: url(f.woff);",
        "}",
        "@keyframes k {",
        "  from {",
        "    top: 0;",
        "  }",
        "  50% {",
        "    top: 1px;",
        "  }",
        "  to {",
        "    top: 2px;",
        "  }",
        "}",
        "h1 {}",
        "",
      ].join("\n")
    );
  });

  it("is idempotent, keeps the file's unit and its final newline, and keeps a comment inside a block on its own line", () => {
    const once = fmt(SHEET).text;
    expect(fmt(once).text).toBe(once);
    expect(fmt("a{\n\tcolor:red;\n\t/* why */\n\tb:c}\n", "\t").text).toBe("a {\n\tcolor: red;\n\t/* why */\n\tb: c;\n}\n");
    expect(fmt("a{b:c}").text.endsWith("\n")).toBe(false);
    // Two tokens the file wrote together stay together: the value is printed from its tokens, not respaced.
    expect(fmt("a{color:red!important;b:red !important}").text).toBe("a {\n  color: red!important;\n  b: red !important;\n}");
  });

  it("refuses a sheet the grammar could not read, naming the line", () => {
    expect(fmt("a{color:red}\nb{color:").problem).toBe("could not read the stylesheet at line 2");
    expect(fmt("a{color:red}\nb{color:").text).toBe("a{color:red}\nb{color:");
  });
});

describe("compressCss", () => {
  it("puts everything on one line, drops the comments, the space after a colon or comma and the last semicolon of a block", () => {
    expect(min(SHEET)).toEqual({
      text: '@charset "utf-8";@import url("a.css") screen;:root{--x:1px;--y:{a:b}}a>b,.c:hover::after{color:red !important;margin:0 auto;background:url(x y.png) no-repeat;font-family:"A  B",serif;width:calc(100% - 2px);c:rgba(0,0,0,.1)}@media (max-width:600px){a{color:blue}}@font-face{font-family:"F";src:url(f.woff)}@keyframes k{from{top:0}50%{top:1px}to{top:2px}}h1{}',
      problem: null,
      comments: 1,
    });
    const once = min(SHEET).text;
    expect(min(once).text).toBe(once);
  });
});

describe("the plan for CSS", () => {
  it("formats with the installed prettier when there is one, otherwise with the own formatter, never with indentation alone", () => {
    expect(planFormat("CSS", true, true).kind).toBe("vault");
    expect(planFormat("CSS", true, false, true).kind).toBe("own");
    expect(planFormat("CSS", true).kind).toBe("own");
    expect(planCompress("CSS").kind).toBe("own");
    expect(formatOwn("CSS", "a{b:c}", { indent: "  ", eol: "\n" }, parse("a{b:c}"))?.text).toBe("a {\n  b: c;\n}");
    expect(compressOwn("CSS", "a {\n  b: c;\n}\n", { indent: "  ", eol: "\n" }, parse("a {\n  b: c;\n}\n"))?.text).toBe("a{b:c}");
    expect(formatOwn("CSS", "a{b:c}", { indent: "  ", eol: "\n" }, null)?.problem).toBe("the file could not be parsed in time");
  });
});

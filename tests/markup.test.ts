import { describe, expect, it } from "vitest";
import { html } from "@codemirror/lang-html";
import { xml } from "@codemirror/lang-xml";
import { type Language, ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import type { Tree } from "@lezer/common";
import { compressOwn, formatOwn, planCompress, planFormat } from "../src/fmt/format";
import { compressMarkup, formatMarkup } from "../src/fmt/markup";

/**
 * The own XML and HTML formatter: one element per line, the data untouched.
 */

const XML = xml().language;
const HTML = html().language;

function parse(text: string, language: Language): Tree {
  const state = EditorState.create({ doc: text, extensions: [language] });
  const tree = ensureSyntaxTree(state, text.length, 5000);
  if (!tree) throw new Error("parse timed out");
  return tree;
}

const fmt = (text: string, language: Language = XML, indent = "  ") => formatMarkup(text, parse(text, language), language === XML ? "xml" : "html", { indent, eol: "\n" });
const min = (text: string, language: Language = XML) => compressMarkup(text, parse(text, language), language === XML ? "xml" : "html");

describe("formatMarkup", () => {
  it("puts one element per line and indents the nesting; whitespace between elements is not content", () => {
    const text = '<?xml version="1.0"?><root><a><b/><c x="1"  y = "2"/></a>\n\n   <d></d></root>\n';
    expect(fmt(text).text).toBe(['<?xml version="1.0"?>', "<root>", "  <a>", "    <b/>", '    <c x="1" y = "2"/>', "  </a>", "  <d></d>", "</root>", ""].join("\n"));
  });

  it("keeps a text leaf on one line with its spaces, and mixed content as it stands", () => {
    const text = "<r><title> T </title><p>Hi <b>x</b>\n  there</p><n>&amp;</n></r>";
    expect(fmt(text).text).toBe(["<r>", "  <title> T </title>", "  <p>Hi <b>x</b>\n  there</p>", "  <n>&amp;</n>", "</r>"].join("\n"));
  });

  it("copies a preserved element whole: xml:space in XML, the pre family and script in HTML", () => {
    expect(fmt('<r><e xml:space="preserve">  k\n  l </e><f> x </f></r>').text).toBe(["<r>", '  <e xml:space="preserve">  k\n  l </e>', "  <f> x </f>", "</r>"].join("\n"));
    // A pre whose children are elements and whitespace would otherwise be restructured; its whitespace is content.
    expect(fmt("<div><pre>\n<b>x</b>\n</pre></div>", HTML).text).toBe(["<div>", "  <pre>\n<b>x</b>\n</pre>", "</div>"].join("\n"));
    const page = "<html><body><pre>\n  x\n</pre><style>a{}\nb{}</style><script>let a = 1;\nlet b = 2;</script></body></html>";
    expect(fmt(page, HTML).text).toBe(["<html>", "  <body>", "    <pre>\n  x\n</pre>", "    <style>a{}\nb{}</style>", "    <script>let a = 1;\nlet b = 2;</script>", "  </body>", "</html>"].join("\n"));
  });

  it("writes an element that holds only whitespace as an empty pair on one line", () => {
    expect(fmt("<r><a>  \n </a><b></b></r>").text).toBe(["<r>", "  <a></a>", "  <b></b>", "</r>"].join("\n"));
  });

  it("gives a comment, a doctype and a CDATA section a line each, and normalises a tag's attribute spacing but not its values", () => {
    const text = '<!DOCTYPE x><!-- c --><a\n   href="a  b"\n class=\'c\'  ><![CDATA[q < r]]></a>';
    expect(fmt(text).text).toBe(["<!DOCTYPE x>", "<!-- c -->", '<a href="a  b" class=\'c\'>', "  <![CDATA[q < r]]>", "</a>"].join("\n"));
  });

  it("closes what HTML leaves open, as the browser does, and keeps a void element", () => {
    const text = "<ul><li>a<li>b</ul><br><img src=x>";
    expect(fmt(text, HTML).text).toBe(["<ul>", "  <li>a", "  <li>b", "</ul>", "<br>", "<img src=x>"].join("\n"));
  });

  it("refuses XML that is not well-formed, naming the line", () => {
    expect(fmt("<a>\n<b>\n</c>\n</a>").problem).toBe("not well-formed: a closing tag that matches no open element at line 3");
    expect(fmt("<a><b></a>").problem).toMatch(/^not well-formed: .* at line 1$/);
    expect(fmt("<a>\n<b>").problem).toMatch(/^not well-formed: .* at line 2$/);
  });

  it("is idempotent, and keeps the file's own indent unit and final newline", () => {
    const text = "<r>\n\t<a>\n\t\t<b/>\n\t</a>\n</r>\n";
    expect(fmt(text, XML, "\t").text).toBe(text);
    const once = fmt('<r><a><b/></a><c>t</c></r>').text;
    expect(fmt(once).text).toBe(once);
    expect(once.endsWith("\n")).toBe(false);
  });
});

describe("compressMarkup", () => {
  it("puts everything on one line, drops comments, and leaves text, preserved elements and mixed content alone", () => {
    const text = '<?xml version="1.0"?>\n<!-- top -->\n<r>\n  <!-- c -->\n  <a x="1"  y="2">\n    <b/>\n  </a>\n  <t> T </t>\n  <p>Hi <b>x</b></p>\n  <e xml:space="preserve"> k </e>\n</r>\n';
    expect(min(text)).toEqual({ text: '<?xml version="1.0"?><r><a x="1" y="2"><b/></a><t> T </t><p>Hi <b>x</b></p><e xml:space="preserve"> k </e></r>', problem: null, comments: 2 });
  });

  it("is a no-op on its own output", () => {
    const once = min("<r>\n <a/>\n</r>\n").text;
    expect(min(once).text).toBe(once);
  });
});

describe("the plans and the own-formatter entry", () => {
  it("routes XML and HTML to the own formatter for Format and for Compress, and asks for the tree", () => {
    expect(planFormat("XML", true).kind).toBe("own");
    expect(planFormat("HTML", true, true).kind).toBe("own");
    expect(planCompress("XML").kind).toBe("own");
    expect(planCompress("HTML").kind).toBe("own");
    const text = "<r><a/></r>";
    expect(formatOwn("XML", text, { indent: "  ", eol: "\n" }, parse(text, XML))).toEqual({ text: "<r>\n  <a/>\n</r>", problem: null, comments: 0 });
    expect(compressOwn("HTML", "<p>\n<b>x</b>\n</p>", { indent: "  ", eol: "\n" }, parse("<p>\n<b>x</b>\n</p>", HTML))).toEqual({ text: "<p><b>x</b></p>", problem: null, comments: 0 });
    // Without a tree the file is left alone and the notice says why.
    expect(formatOwn("XML", text, { indent: "  ", eol: "\n" }, null)).toEqual({ text, problem: "the file could not be parsed in time" });
    // JSON never needed one.
    expect(formatOwn("JSON", "{}", { indent: "  ", eol: "\n" })?.problem).toBeNull();
  });
});

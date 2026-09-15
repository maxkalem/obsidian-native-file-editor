import { StringStream } from "@codemirror/language";
import { describe, expect, it } from "vitest";
import { tokenize } from "../src/highlight/highlighter";
import { PRISMA_KEYWORD } from "../src/highlight/prismaFix";
import { languageFor, resolveLanguage } from "../src/highlight/registry";
import { retag, wholeWords, withFallbackKeywords, withLineComment } from "../src/highlight/streamFixes";

/**
 * Checked in Obsidian on 2026-09-07: languages whose colours read wrong. Each
 * test here is one finding. `classesOf` runs a registry entry through the npm
 * highlighter (tag hierarchy); `rawTokens` runs a raw parser line by line and
 * returns the token NAMES it emits, which is what Obsidian's fork turns into
 * classes on the device.
 */

function classesOf(ext: string, text: string): Map<string, string | null> {
  const entry = languageFor(ext);
  const resolved = entry ? resolveLanguage(entry) : null;
  if (!resolved) throw new Error(`no language for .${ext}`);
  const out = new Map<string, string | null>();
  for (const t of tokenize(text, resolved.language) ?? []) if (t.text.trim()) out.set(t.text.trim(), t.classes);
  return out;
}

function rawTokens(parser: ReturnType<typeof retag>, lines: string[]): Array<[string, string | null]> {
  const state = parser.startState ? parser.startState(4) : {};
  const out: Array<[string, string | null]> = [];
  for (const line of lines) {
    const stream = new StringStream(line, 4, 4);
    while (!stream.eol()) {
      stream.start = stream.pos;
      const tok = parser.token(stream, state);
      if (stream.pos === stream.start) stream.next();
      out.push([stream.current(), tok]);
    }
  }
  return out;
}

describe("stream fixes", () => {
  const fake = {
    token(stream: StringStream) {
      if (stream.match(/^[A-Za-z]+/)) return stream.current() === "auto" || stream.current() === "Auto" ? "atom" : "def";
      if (stream.match(/^\s+/)) return null;
      stream.next();
      return "quote";
    },
  };

  it("retag renames whole names by map or by function, leaving the rest", () => {
    const byMap = retag(fake, { def: "propertyName", quote: "string" });
    expect(rawTokens(byMap, ["a = b"])).toEqual([
      ["a", "propertyName"],
      [" ", null],
      ["=", "string"],
      [" ", null],
      ["b", "propertyName"],
    ]);
    const byFn = retag(fake, (raw, text) => (raw === "quote" && text === "=" ? "operator" : raw));
    expect(rawTokens(byFn, ["a = ;"]).map(([, t]) => t)).toEqual(["def", null, "operator", null, "quote"]);
  });

  it("withLineComment comments a line that starts with the marker, after indentation only", () => {
    const p = withLineComment(fake, "#");
    expect(rawTokens(p, ["# c", "  # d", "a # not"])).toEqual([
      ["# c", "comment"],
      ["  # d", "comment"],
      ["a", "def"],
      [" ", null],
      ["#", "quote"],
      [" ", null],
      ["not", "def"],
    ]);
  });

  it("wholeWords takes the rest of a word the mode stopped inside", () => {
    const prefixy = {
      token(stream: StringStream) {
        if (stream.match(/^auto/i)) return "atom";
        if (stream.match(/^\w+/)) return "def";
        stream.next();
        return null;
      },
    };
    expect(rawTokens(prefixy, ["Autosave auto"]).map(([t, k]) => `${t}:${k}`)).toEqual(["Auto:atom", "save:def", " :null", "auto:atom"]);
    expect(rawTokens(wholeWords(prefixy), ["Autosave auto"]).map(([t, k]) => `${t}:${k}`)).toEqual(["Autosave:variableName", " :null", "auto:atom"]);
  });

  it("withFallbackKeywords colours only what the mode left plain", () => {
    const table = { id: "t", name: "T", extensions: ["t"], caseInsensitive: true, commentLine: null, commentStart: null, commentEnd: null, sets: [["builtin", "Alpha beta"]] as const };
    const p = withFallbackKeywords(fake, table);
    // The fake calls every word `def`; the fallback never overrides that.
    expect(rawTokens(p, ["alpha"]).map(([, t]) => t)).toEqual(["def"]);
    const plain = { token(stream: StringStream) { stream.match(/^\w+/) || stream.next(); return null; } };
    expect(rawTokens(withFallbackKeywords(plain, table), ["alpha BETA gamma"]).map(([t, k]) => `${t}:${k}`)).toEqual(["alpha:variableName.standard", " :null", "BETA:variableName.standard", " :null", "gamma:null"]);
  });


});

describe("registry entries after the 2026-09-07 pass", () => {
  it("Properties/INI: sections keywords, keys properties, values strings", () => {
    const m = classesOf("ini", "; c\n[general]\ninitialMode = preview\n");
    expect(m.get("; c")).toContain("nfe-tok-comment");
    expect(m.get("[general]")).toContain("cm-keyword");
    expect(m.get("initialMode")).toContain("cm-property");
    expect(m.get("preview")).toContain("cm-string");
  });

  it("N-Triples: a # line is a comment, a URI a variable, a literal a string", () => {
    const m = classesOf("nt", "# note\n<http://a/b> <http://a/c> \"x\"@en .\n");
    expect(m.get("# note")).toContain("nfe-tok-comment");
    expect(m.get("<http://a/b>")).toContain("cm-variable");
    expect(m.get('"x"')).toContain("cm-string");
  });

  it("MsGenny: entity names stay whole words", () => {
    const m = classesOf("msgenny", "User, Autosave;\nUser => Autosave : go;\n");
    expect([...m.keys()].some((k) => k === "Auto")).toBe(false);
    expect(m.get("Autosave")).toContain("nfe-tok-variable");
    expect(m.get("=>")).toContain("cm-keyword");
  });

  it("Assembly (one lezer grammar for .s, .asm, .z80): labels, mnemonics, registers, directives, numbers, comments", () => {
    expect(languageFor("s")?.source).toBe("lezer");
    expect(languageFor("asm")?.name).toBe("Assembly");
    expect(languageFor("z80")?.name).toBe("Assembly");
    const gas = classesOf("s", "msg:    .ascii \"hi\"   # c\n        mov     $1, %rax\n");
    expect(gas.get("msg:")).toContain("cm-variable-2");
    expect(gas.get("msg:")).not.toContain("cm-tag");
    expect(gas.get(".ascii")).toContain("cm-meta");
    expect(gas.get("mov")).toContain("cm-keyword");
    expect(gas.get("%rax")).toContain("cm-variable-2");
    expect(gas.get("$1")).toContain("cm-number");
    expect(gas.get("# c")).toContain("nfe-tok-comment");
    const z80 = classesOf("z80", "LIMIT   EQU     $4FF0\nstart:  LD HL, sizes ; c\n        LD B, 3\n");
    expect(z80.get("LIMIT")).toContain("cm-variable-2");
    expect(z80.get("EQU")).toContain("cm-meta");
    expect(z80.get("start:")).toContain("cm-variable-2");
    expect(z80.get("LD")).toContain("cm-keyword");
    expect(z80.get("HL")).toContain("cm-variable-2");
    expect(z80.get("$4FF0")).toContain("cm-number");
    expect(z80.get("; c")).toContain("nfe-tok-comment");
  });

  it("RPM spec: preamble tags keywords, macros builtins; troff: requests keywords; TiddlyWiki: bullets keywords", () => {
    expect(classesOf("spec", "Name: x\nSource0: %{name}.tar\n").get("Name:")).toContain("cm-keyword");
    expect(classesOf("spec", "Source0: %{name}.tar\n").get("%{name}")).toContain("cm-builtin");
    expect(classesOf("troff", '.TH COPY 1\n.B x\n').get(".TH COPY 1")).toContain("cm-keyword");
    const tid = classesOf("tid", "* item\n** sub\n");
    expect(tid.get("*")).toContain("cm-keyword");
    expect(tid.get("**")).toContain("cm-keyword");
  });

  it("Batch: rem in any case and `::` are comments, `:label` a label, `%VAR%` and `!VAR!` variables (converter supplement)", () => {
    const m = classesOf("bat", "@echo off\nrem lower\nREM Upper\nRemark x\n:: colon\nset X=1\n:label\necho %X% %~dp0 !Y!\ngoto :eof\n");
    expect(m.get("rem lower")).toContain("nfe-tok-comment");
    expect(m.get("REM Upper")).toContain("nfe-tok-comment");
    // A word that merely starts with rem is not a comment marker.
    expect(m.get("Remark x")).toBeNull();
    expect(m.get(":: colon")).toContain("nfe-tok-comment");
    expect(m.get(":label")).toContain("cm-variable-2");
    expect(m.get("%X%")).toContain("cm-variable-2");
    expect(m.get("%~dp0")).toContain("cm-variable-2");
    expect(m.get("!Y!")).toContain("cm-variable-2");
    expect(m.get("echo")).toContain("cm-keyword");
    // `:eof` after goto is not at the start of the line: not a label mark.
    expect(m.get(":eof")).toBeNull();
  });

  it("CMake: commands are keywords, not uncoloured definitions; Tcl: Notepad++'s commands fill what the mode leaves plain", () => {
    const cm = classesOf("cmake", "add_executable(app main.c)\nif(WIN32)\nendif()\n");
    expect(cm.get("add_executable")).toContain("cm-keyword");
    expect(cm.get("if")).toContain("cm-keyword");
    const tcl = classesOf("tcl", "set x [dict get $d k]\nputs [clock seconds]\nfoo bar\n");
    expect(tcl.get("set")).toContain("cm-keyword");
    expect(tcl.get("dict")).toContain("cm-keyword");
    expect(tcl.get("clock")).toContain("cm-keyword");
    expect(tcl.get("foo bar")).toBeNull();
  });

  it("PureBasic: `;` comments, Define and Debug keywords (plugin supplement to the Notepad++ table)", () => {
    const m = classesOf("pb", ";PureBasic\nDefine count.i = 3\n  Debug \"big\"\nEndIf\n");
    expect(m.get(";PureBasic")).toContain("nfe-tok-comment");
    expect(m.get("Define")).toContain("cm-keyword");
    expect(m.get("Debug")).toContain("cm-keyword");
    expect(m.get("EndIf")).toContain("cm-keyword");
  });
});

describe("own modes for Notepad++'s hand-written lexers", () => {
  it("Makefile: comments, targets, variables, assignments, references, functions, directives, recipes", () => {
    const m = classesOf("mak", "# Makefile\nCFLAGS := -O2\n.PHONY: all\nall: notes\nnotes: notes.c\n\t$(CC) -o $@ $(wildcard *.c)\nifeq ($(OS),Windows_NT)\nendif\n");
    expect(m.get("# Makefile")).toContain("nfe-tok-comment");
    expect(m.get("CFLAGS")).toContain("cm-def");
    expect(m.get("$(CC)")).toContain("cm-variable-2");
    expect(m.get(":=")).toContain("cm-operator");
    expect(m.get(".PHONY")).toContain("cm-keyword");
    expect(m.get("all")).toContain("cm-type");
    expect(m.get("notes")).toContain("cm-type");
    expect(m.get("$(")).toContain("cm-variable-2");
    expect(m.get("wildcard")).toContain("cm-builtin");
    expect(m.get("$@")).toContain("cm-variable-2");
    expect(m.get("ifeq")).toContain("cm-keyword");
    expect(m.get("endif")).toContain("cm-keyword");
    expect(m.get("-o")).toBeNull();
    expect(languageFor("makefile")?.source).toBe("builtin");
  });

  it("MHTML: headers, boundaries, quoted-printable, and HTML inside the text/html part only", () => {
    const text = 'MIME-Version: 1.0\nContent-Type: multipart/related; boundary="B"\n\n--B\nContent-Type: text/html; charset="utf-8"\nContent-Transfer-Encoding: quoted-printable\n\n<html><body class="x">caf=C3=A9 &amp; <!-- c --></body></html>\n--B\nContent-Type: image/png\n\niVBORw0KGgo=\n--B--\n';
    const m = classesOf("mht", text);
    expect(m.get("MIME-Version")).toContain("cm-property");
    expect(m.get("1.0")).toContain("cm-string");
    expect(m.get("--B")).toContain("cm-meta");
    expect(m.get("--B--")).toContain("cm-meta");
    expect(m.get("<html")).toContain("cm-tag");
    expect(m.get("class")).toContain("cm-attribute");
    expect(m.get('"x"')).toContain("cm-string");
    expect(m.get("=C3=A9")).toContain("cm-string-2");
    expect(m.get("&amp;")).toContain("cm-atom");
    expect(m.get("<!-- c -->")).toContain("nfe-tok-comment");
    expect(m.get("iVBORw0KGgo=")).toBeNull();
    // Chrome's boundary ends in ---- itself: it must open a part, not close the archive (2026-09-09: every part plain).
    const chrome = classesOf(
      "mhtml",
      'From: <Saved by Blink>\nMIME-Version: 1.0\nContent-Type: multipart/related;\n\ttype="text/html";\n\tboundary="----MultipartBoundary--abc----"\n\n------MultipartBoundary--abc----\nContent-Type: text/html\nContent-Location: https://x/\n\n<div id=3D"w">t</div>\n------MultipartBoundary--abc------\n'
    );
    expect(chrome.get("------MultipartBoundary--abc----")).toContain("cm-meta");
    expect(chrome.get("Content-Location")).toContain("cm-property");
    expect(chrome.get("<div")).toContain("cm-tag");
    expect(chrome.get("=3D")).toContain("cm-string-2");
    expect(chrome.get("------MultipartBoundary--abc------")).toContain("cm-meta");
  });

  it("hex records: count, address, type and checksum coloured by position; a broken line is invalid", () => {
    const hex = classesOf("hex", ":10010000214601360121470136007EFE09D2190140\n:00000001FF\n:zz\n");
    expect(hex.get(":")).toContain("cm-punctuation");
    expect(hex.get("10")).toContain("cm-number");
    expect(hex.get("0100")).toContain("cm-variable");
    expect(hex.get("01")).toContain("cm-keyword");
    expect(hex.get("214601360121470136007EFE09D21901")).toBeNull();
    expect(hex.get("40")).toContain("cm-atom");
    expect(hex.get(":zz")).toContain("cm-error");
    const mot = classesOf("mot", "S00600004844521B\nS1130000285F245F2212226A000424290008237C2A\nS9030000FC\n");
    expect(mot.get("S0")).toContain("cm-keyword");
    expect(mot.get("06")).toContain("cm-number");
    expect(mot.get("0000")).toContain("cm-variable");
    expect(mot.get("1B")).toContain("cm-atom");
    expect(mot.get("285F245F2212226A000424290008237C")).toBeNull();
    const tek = classesOf("tek", "%1A6123000000000000\n");
    expect(tek.get("%")).toContain("cm-punctuation");
    expect(tek.get("1A")).toContain("cm-number");
    expect(tek.get("6")).toContain("cm-keyword");
    expect(tek.get("12")).toContain("cm-atom");
    expect(tek.get("3000")).toContain("cm-variable");
  });

  it("Prisma: field names, types, attributes, functions and config keys are tagged at the leaves the grammar leaves bare; the keywords are a line-start regex", () => {
    const m = classesOf("prisma", 'generator client {\n  provider = "prisma-client-js"\n}\nmodel Note {\n  id    Int      @id @default(autoincrement())\n  body  String?\n  tags  Tag[]\n}\nenum Role {\n  ADMIN\n}\n');
    expect(m.get("client")).toContain("cm-type");
    expect(m.get("provider")).toContain("cm-property");
    expect(m.get("id")).toContain("cm-attribute");
    expect(m.get("body")).toContain("cm-property");
    expect(m.get("Int")).toContain("cm-type");
    expect(m.get("String")).toContain("cm-type");
    expect(m.get("?")).toContain("nfe-tok-modifier");
    expect(m.get("default")).toContain("cm-attribute");
    expect(m.get("autoincrement")).toContain("nfe-tok-function");
    expect(m.get("ADMIN")).toContain("nfe-tok-constant");
    // The keywords are anonymous in the grammar: no token class; the view marks them (PRISMA_KEYWORD) at a line's start only.
    expect(m.get("generator") ?? null).toBeNull();
    const kw = (line: string) => (PRISMA_KEYWORD.lastIndex = 0, PRISMA_KEYWORD.test(line));
    expect(kw("model Note {")).toBe(true);
    expect(kw("enum Role {")).toBe(true);
    expect(kw("  type  String")).toBe(false);
    expect(kw("modelling")).toBe(false);
  });

  it("txt2tags: comments, headings, list marks, inline markup, links, separators", () => {
    const m = classesOf("t2t", "% c\n= Heading =\n- item **bold** //it// [link]\n--------------------\n");
    expect(m.get("% c")).toContain("nfe-tok-comment");
    expect(m.get("= Heading =")).toContain("cm-header");
    expect(m.get("-")).toContain("cm-keyword");
    expect(m.get("**bold**")).toContain("cm-strong");
    expect(m.get("//it//")).toContain("cm-em");
    expect(m.get("[link]")).toContain("cm-link");
    expect(m.get("--------------------")).toContain("cm-hr");
  });
});

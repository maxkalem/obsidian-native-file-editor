import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  bracketSpans,
  objectEntries,
  parseCodeMirrorTheme,
  resolveTagName,
  splitTopLevel,
  stringConstants,
  stripComments,
  lastAssignmentBefore,
  tagNamesOf,
  variantOf,
} from "../src/palette/codemirrorTheme";
import { HOST_SELECTOR, renderPalette } from "../src/palette/render";
import { chromeRules, knownTagNames, selectorsForTagName } from "../src/palette/model";
import { isNotepadTheme, notepadColour, parseNotepadTheme, roleForStyleName } from "../src/palette/notepadTheme";
import type { Palette } from "../src/palette/model";

/**
 * The converters against real theme files (tests/fixtures/palettes): a theme
 * downloaded from codemirror.net's community list or copied from Notepad++'s
 * themes folder has to come out as the colours its author chose, and anything
 * the plugin cannot read as data has to be named in the notes rather than
 * silently dropped.
 */

const fixture = (name: string) => readFileSync(fileURLToPath(new URL(`./fixtures/palettes/${name}`, import.meta.url)), "utf8");

/** The declarations of the first rule whose selectors include `selector`. */
function ruleFor(palette: Palette, selector: string): Record<string, string> | null {
  for (const r of palette.rules) if (r.selectors.includes(selector)) return { ...r.declarations };
  return null;
}
/** The LAST rule for a selector: what CSS applies when rules of equal specificity conflict. */
function lastRuleFor(palette: Palette, selector: string): Record<string, string> | null {
  let out: Record<string, string> | null = null;
  for (const r of palette.rules) if (r.selectors.includes(selector)) out = { ...r.declarations };
  return out;
}

describe("the JavaScript scanner", () => {
  it("blanks comments but not strings, keeping every offset", () => {
    const src = 'a = "x // not a comment"; // c\n/* b */ b = \'y /* z */\'';
    const out = stripComments(src);
    expect(out.length).toBe(src.length);
    expect(out).toContain('"x // not a comment"');
    expect(out).toContain("'y /* z */'");
    expect(out).not.toContain("// c");
    expect(out).not.toContain("/* b */");
  });

  it("finds brace and bracket spans with their parents, skipping strings", () => {
    const spans = bracketSpans('x = [ {a: "}"}, {b: 1} ]');
    expect(spans.map((s) => s.open)).toEqual(["[", "{", "{"]);
    expect(spans[1]?.parent).toBe(0);
    expect(spans[2]?.parent).toBe(0);
  });

  it("splits at top-level commas only", () => {
    expect(splitTopLevel('a, f(b, c), [d, e], "g,h"')).toEqual(["a", "f(b, c)", "[d, e]", '"g,h"']);
  });

  it("reads object entries with identifier and quoted keys", () => {
    expect(objectEntries('tag: t.keyword, color: violet, "&": { x: 1 }, fontStyle: "italic"')).toEqual([
      { key: "tag", value: "t.keyword" },
      { key: "color", value: "violet" },
      { key: "&", value: "{ x: 1 }" },
      { key: "fontStyle", value: '"italic"' },
    ]);
  });

  it("collects string constants in const lists, minified assignments and TypeScript declarations", () => {
    const c = stringConstants('const a = "#111", b = \'#222\';\nvar c="#333";\nconst d: string = "#444";\nobj.e = "#555"; f: "#666"');
    expect([...c.entries()]).toEqual([
      ["a", "#111"],
      ["b", "#222"],
      ["c", "#333"],
      ["d", "#444"],
    ]);
  });

  it("strips namespace prefixes from tag expressions and keeps modifier calls", () => {
    expect(tagNamesOf("[tags.name, t.deleted, /*x*/ t.function(t.variableName), n.tags.special(n.tags.string)]".replace("/*x*/", ""))).toEqual([
      "name",
      "deleted",
      "function(variableName)",
      "special(string)",
    ]);
    expect(tagNamesOf("t.keyword")).toEqual(["keyword"]);
    expect(tagNamesOf("someFunction()")).toEqual([]);
  });
});

describe("tag resolution against the token table", () => {
  const known = new Set(knownTagNames());
  it("keeps a known tag, expands a parent to the children the theme does not style itself", () => {
    expect(resolveTagName("keyword", new Set(), known)).toEqual(["keyword"]);
    const expanded = resolveTagName("name", new Set(["typeName", "propertyName"]), known);
    expect(expanded).toContain("variableName");
    expect(expanded).not.toContain("typeName");
    expect(expanded).not.toContain("propertyName");
  });
  it("re-applies a modifier where the table has the row and falls back to the inner tag otherwise", () => {
    expect(resolveTagName("definition(name)", new Set(["typeName"]), known)).toEqual(
      expect.arrayContaining(["definition(variableName)", "definition(propertyName)"])
    );
    expect(resolveTagName("definition(name)", new Set(["typeName"]), known)).not.toContain("typeName");
    expect(resolveTagName("special(brace)", new Set(), known)).toEqual(["bracket"]);
    expect(resolveTagName("special(brace)", new Set(["bracket"]), known)).toEqual([]);
  });
  it("gives the canonical cm-* class only to the first row that uses it", () => {
    expect(selectorsForTagName("function(variableName)")).toEqual([".nfe-tok-function"]);
    expect(selectorsForTagName("variableName")).toEqual([".cm-variable", ".nfe-tok-variable"]);
    // definition(variableName) is the table's first cm-def row, so it owns the cm-* selector and function(variableName) does not.
    expect(selectorsForTagName("definition(variableName)")).toEqual([".cm-def", ".nfe-tok-variable.nfe-tok-definition"]);
    expect(selectorsForTagName("keyword")).toEqual([".cm-keyword", ".nfe-tok-keyword"]);
    expect(selectorsForTagName("nonsense")).toBeNull();
  });
});

describe("a CodeMirror theme module read as data", () => {
  it("one-dark: constants, EditorView.theme block and HighlightStyle rules", () => {
    const p = parseCodeMirrorTheme(fixture("one-dark.js"));
    expect(ruleFor(p, ".cm-keyword")).toEqual({ color: "#c678dd" });
    expect(ruleFor(p, ".cm-editor")).toEqual({ color: "#abb2bf", "background-color": "#282c34" });
    expect(ruleFor(p, ".cm-editor .cm-gutters")).toEqual({ "background-color": "#282c34", color: "#7d8799", border: "none" });
    expect(ruleFor(p, ".cm-editor .cm-content")).toEqual({ "caret-color": "#528bff" });
    // "&.cm-focused > .cm-scroller > ..." becomes a descendant of .cm-editor.
    expect(ruleFor(p, ".cm-editor.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground")).toEqual({ "background-color": "#3E4451" });
    // tags.name expands to the names the theme does not style separately (propertyName is styled: coral, in the same rule).
    expect(ruleFor(p, ".cm-variable")).toEqual({ color: "#e06c75" });
    expect(ruleFor(p, ".cm-property")).toEqual({ color: "#e06c75" });
    // typeName has its own rule later, so it is not swept up by tags.name.
    expect(lastRuleFor(p, ".cm-type")).toEqual({ color: "#e5c07b" });
    expect(ruleFor(p, ".nfe-tok-function")).toEqual({ color: "#61afef" });
    expect(ruleFor(p, ".cm-strong")).toEqual({ "font-weight": "bold" });
    expect(lastRuleFor(p, ".cm-link")).toEqual({ color: "#7d8799", "text-decoration": "underline" });
    expect(ruleFor(p, ".cm-error")).toEqual({ color: "#ffffff" });
    // The nested autocomplete selector is skipped and named.
    expect(p.notes.some((n) => n.includes("cm-tooltip-autocomplete") && n.includes("nested"))).toBe(true);
    expect(p.notes.some((n) => /^\d+ token rules, \d+ editor rules$/.test(n))).toBe(true);
  });

  it("thememirror dracula: createTheme settings and styles", () => {
    const p = parseCodeMirrorTheme(fixture("dracula.js"));
    expect(ruleFor(p, ".cm-editor")).toEqual({ "background-color": "#2d2f3f", color: "#f8f8f2" });
    expect(ruleFor(p, ".cm-cursor")).toEqual({ "border-left-color": "#f8f8f0" });
    expect(ruleFor(p, ".cm-gutters")).toEqual({ "background-color": "#282a36", color: "rgb(144, 145, 148)" });
    expect(ruleFor(p, ".cm-activeLine")).toEqual({ "background-color": "#44475a" });
    expect(ruleFor(p, ".cm-comment")).toEqual({ color: "#6272a4" });
    // t.special(t.brace) lands on brackets; t.keyword and t.operator share a rule.
    expect(ruleFor(p, ".cm-bracket")).toEqual({ color: "#f1fa8c" });
    expect(ruleFor(p, ".cm-operator")).toEqual({ color: "#ff79c6" });
    expect(ruleFor(p, ".cm-keyword")).toEqual({ color: "#ff79c6" });
    // definitionKeyword is a keyword the theme styles explicitly elsewhere, so it does not override.
    expect(lastRuleFor(p, ".cm-keyword")).toEqual({ color: "#ff79c6" });
    expect(ruleFor(p, ".cm-attribute")).toEqual({ color: "#50fa7b" });
  });

  it("uiw github: a light and a dark theme in one module, each under Obsidian's matching body class", () => {
    const p = parseCodeMirrorTheme(fixture("github.js"));
    expect(p.notes).toContain("2 themes in one file, told apart as light and dark; each follows Obsidian's theme");
    const keyword = p.rules.filter((r) => r.selectors.includes(".cm-keyword"));
    expect(keyword.map((r) => [r.variant, r.declarations.color])).toEqual([
      ["light", "#d73a49"],
      ["dark", "#ff7b72"],
    ]);
    const editor = p.rules.filter((r) => r.selectors.includes(".cm-editor"));
    expect(editor.map((r) => [r.variant, r.declarations["background-color"]])).toEqual([
      ["light", "#fff"],
      ["dark", "#0d1117"],
    ]);
    const css = renderPalette(p, {});
    expect(css).toContain(`.theme-light ${HOST_SELECTOR} .cm-keyword`);
    expect(css).toContain(`.theme-dark ${HOST_SELECTOR} .cm-keyword`);
  });

  it("two groups that cannot be told apart: the last wins and the notes say so", () => {
    const p = parseCodeMirrorTheme('const a = [{ tag: t.keyword, color: "#111" }]; const b = [{ tag: t.keyword, color: "#222" }];');
    expect(p.notes).toContain("2 groups of token rules; used the last (1 rules)");
    expect(ruleFor(p, ".cm-keyword")).toEqual({ color: "#222" });
    expect(p.rules.every((r) => r.variant === undefined)).toBe(true);
  });

  it("variants are read from theme, variant and dark keys", () => {
    expect(variantOf([{ key: "theme", value: "'dark'" }])).toBe("dark");
    expect(variantOf([{ key: "variant", value: '"light"' }])).toBe("light");
    expect(variantOf([{ key: "theme", value: "x === void 0 ? 'light' : x" }])).toBe("light");
    expect(variantOf([{ key: "dark", value: "true" }])).toBe("dark");
    expect(variantOf([{ key: "dark", value: "false" }])).toBe("light");
    expect(variantOf([{ key: "settings", value: "{}" }])).toBeNull();
    // An identifier resolves through its last assignment before the call (Babel's default-parameter shape).
    const src = "var theme = a === void 0 ? 'dark' : a; f({ theme: theme }); theme = 'light'; g({ theme: theme });";
    expect(variantOf([{ key: "theme", value: "theme" }], (n) => lastAssignmentBefore(src, n, src.indexOf("f({")))).toBe("dark");
    expect(variantOf([{ key: "theme", value: "theme" }], (n) => lastAssignmentBefore(src, n, src.indexOf("g({")))).toBe("light");
    expect(lastAssignmentBefore(src, "nothing", 999)).toBeNull();
  });

  it("a file with nothing usable yields no rules and a note", () => {
    const p = parseCodeMirrorTheme('export const x = 1; function f() { return { a: 1 }; }');
    expect(p.rules).toEqual([]);
    expect(p.notes).toEqual(["no token rules, settings or EditorView.theme blocks found"]);
  });

  it("skips computed values, forbidden values and unknown properties, and names the skips", () => {
    const p = parseCodeMirrorTheme('const c = "#123456"; HighlightStyle.define([{ tag: t.keyword, color: c, backgroundColor: mix(c), cursor: "pointer", fontStyle: "url(x)" }])');
    expect(ruleFor(p, ".cm-keyword")).toEqual({ color: "#123456" });
    expect(p.notes.some((n) => n.includes("backgroundColor is computed"))).toBe(true);
    expect(p.notes.some((n) => n.includes("fontStyle is computed"))).toBe(true);
  });
});

describe("a Notepad++ theme", () => {
  it("recognises the format and its colours", () => {
    expect(isNotepadTheme("<NotepadPlus><LexerStyles/></NotepadPlus>")).toBe(true);
    expect(isNotepadTheme("<html/>")).toBe(false);
    expect(notepadColour("93C763")).toBe("#93c763");
    expect(notepadColour("")).toBeUndefined();
    expect(notepadColour("#fff")).toBeUndefined();
  });

  it("maps style names to roles by meaning, not by lexer", () => {
    expect(roleForStyleName("INSTRUCTION WORD")).toBe("keyword");
    expect(roleForStyleName("KEYWORDS")).toBe("keyword");
    expect(roleForStyleName("WORD")).toBe("keyword");
    expect(roleForStyleName("COMMENT LINE DOC")).toBe("docComment");
    expect(roleForStyleName("COMMENTLINE")).toBe("comment");
    expect(roleForStyleName("TRIPLEDOUBLE")).toBe("string");
    expect(roleForStyleName("DEFNAME")).toBe("function");
    expect(roleForStyleName("CLASSNAME")).toBe("type");
    expect(roleForStyleName("TAGEND")).toBe("tag");
    expect(roleForStyleName("USER KEYWORDS 1")).toBeNull();
    expect(roleForStyleName("DEFAULT")).toBeNull();
    expect(roleForStyleName("PROPERTYNAME")).toBe("property");
  });

  it("Obsidian.xml: editor colours from GlobalStyles, token colours from the richest lexer first", () => {
    const p = parseNotepadTheme(fixture("Obsidian.xml"));
    expect(ruleFor(p, ".cm-editor")).toEqual({ "background-color": "#293134", color: "#e0e2e4" });
    expect(ruleFor(p, ".cm-cursor")).toEqual({ "border-left-color": "#c1cbd2" });
    expect(ruleFor(p, ".cm-selectionBackground")).toEqual({ "background-color": "#404e51" });
    expect(ruleFor(p, ".cm-activeLine")).toEqual({ "background-color": "#2f393c" });
    expect(ruleFor(p, ".cm-gutters")).toEqual({ "background-color": "#3f4b4e", color: "#81969a" });
    expect(ruleFor(p, ".cm-matchingBracket")).toEqual({ color: "#f3db2e" });
    // cpp lexer: INSTRUCTION WORD is bold green, TYPE WORD blue, COMMENT grey, COMMENT DOC its own grey.
    expect(ruleFor(p, ".cm-keyword")).toEqual({ color: "#93c763", "font-weight": "bold" });
    expect(ruleFor(p, ".cm-type")).toEqual({ color: "#678cb1" });
    expect(ruleFor(p, ".cm-comment")).toEqual({ color: "#66747b" });
    expect(ruleFor(p, ".nfe-tok-doc")).toEqual({ color: "#6c788c" });
    expect(ruleFor(p, ".cm-number")).toEqual({ color: "#ffcd22" });
    expect(ruleFor(p, ".cm-string")).toEqual({ color: "#ec7600" });
    expect(ruleFor(p, ".cm-string-2")).toEqual({ color: "#d39745" });
    expect(ruleFor(p, ".cm-meta")).toEqual({ color: "#a082bd" });
    // Roles cpp lacks come from later lexers: tags from html, functions from python.
    expect(ruleFor(p, ".cm-tag")).not.toBeNull();
    expect(ruleFor(p, ".cm-def")).not.toBeNull();
    // A token background equal to the lexer's own is not a background.
    for (const r of p.rules) if (r.selectors.includes(".cm-keyword")) expect(r.declarations["background-color"]).toBeUndefined();
    expect(p.notes.some((n) => /^\d+ token roles from \d+ lexers$/.test(n))).toBe(true);
  });

  it("an XML file that is not a theme yields nothing and says why", () => {
    const p = parseNotepadTheme("<root><a/></root>");
    expect(p.rules).toEqual([]);
    expect(p.notes[0]).toMatch(/not a Notepad\+\+ theme/);
  });

  it("chrome rules carry only what was set", () => {
    expect(chromeRules({})).toEqual([]);
    expect(chromeRules({ caret: "#fff" })).toEqual([{ selectors: [".cm-cursor", ".cm-dropCursor"], declarations: { "border-left-color": "#fff" } }]);
  });
});

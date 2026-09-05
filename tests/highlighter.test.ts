import { describe, expect, it } from "vitest";
import { ensureSyntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { classesForTags, paintByName, ruleOf, tokenClassNames, tokenize, treeHasRules } from "../src/highlight/highlighter";
import { languageFor, resolveLanguage } from "../src/highlight/registry";

function tokens(ext: string, text: string) {
  const entry = languageFor(ext);
  if (!entry) throw new Error(`no entry for .${ext}`);
  const resolved = resolveLanguage(entry);
  if (!resolved) throw new Error(`no language for .${ext}`);
  return tokenize(text, resolved.language) ?? [];
}

function classesOf(ext: string, text: string, snippet: string): string | null {
  const hit = tokens(ext, text).find((t) => t.text === snippet);
  if (!hit) throw new Error(`no token "${snippet}" in ${JSON.stringify(tokens(ext, text))}`);
  return hit.classes;
}

describe("nfe highlighter", () => {
  it("parses through a parse context, never through parser.parse(): Obsidian's stream parser has no null check for the context", () => {
    const entry = languageFor("sh");
    const resolved = entry ? resolveLanguage(entry) : null;
    if (!resolved) throw new Error("no shell");
    const parser = resolved.language.parser as unknown as { parse: unknown };
    const original = parser.parse;
    parser.parse = () => {
      throw new Error("direct parser.parse() call");
    };
    try {
      const out = tokenize("echo hi # c\n", resolved.language);
      expect(out).not.toBeNull();
      expect(out!.some((t) => (t.classes ?? "").includes("nfe-tok-comment"))).toBe(true);
    } finally {
      parser.parse = original;
    }
  });

  it("returns null instead of hanging when the parse does not finish in the time given", () => {
    const entry = languageFor("py");
    const resolved = entry ? resolveLanguage(entry) : null;
    if (!resolved) throw new Error("no python");
    const big = "x = 1\n".repeat(300_000);
    expect(tokenize(big, resolved.language, 0)).toBeNull();
    expect(tokenize("x = 1\n", resolved.language, 1000)).not.toBeNull();
  });

  it("emits Obsidian's cm-* class beside every nfe-tok-* class", () => {
    for (const t of tokens("ts", "const x = 1; // c")) {
      if (t.classes === null) continue;
      const parts = t.classes.split(" ");
      expect(parts.some((c) => c.startsWith("cm-")), t.classes).toBe(true);
      expect(parts.some((c) => c.startsWith("nfe-tok-")), t.classes).toBe(true);
    }
  });

  it("the by-name walk produces the same tokens as highlightCode, for a lezer grammar and a stream mode", () => {
    for (const [ext, text] of [
      ["ts", 'const x: number = 42; // note\nfunction f(s: string) { return s + "a"; }\n'],
      ["sh", '#!/bin/sh\nif [ -f "$1" ]; then echo ok; fi # done\n'],
      ["log", "2026-09-04 12:00:00 ERROR [main] user=\"x\" failed\n"],
    ] as const) {
      const entry = languageFor(ext);
      const resolved = entry ? resolveLanguage(entry) : null;
      if (!resolved) throw new Error(ext);
      const state = EditorState.create({ doc: text, extensions: [resolved.language] });
      const tree = ensureSyntaxTree(state, text.length, 1000);
      if (!tree) throw new Error("no tree");
      expect(treeHasRules(tree)).toBe(true);
      const viaCode = tokenize(text, resolved.language);
      const viaName = paintByName(text, tree);
      expect(viaName.map((t) => t.text).join("")).toBe(text);
      // Same styled runs, whatever the module copy: compare the (text, classes) pairs of styled tokens.
      const styled = (toks: { text: string; classes: string | null }[]) => toks.filter((t) => t.classes !== null).map((t) => `${t.text}|${t.classes}`);
      expect(styled(viaName)).toEqual(styled(viaCode ?? []));
    }
  });

  it("ruleOf finds a style rule by shape and classesForTags maps tag names", () => {
    const entry = languageFor("log");
    const resolved = entry ? resolveLanguage(entry) : null;
    if (!resolved) throw new Error("no log");
    const state = EditorState.create({ doc: "ERROR x\n", extensions: [resolved.language] });
    const tree = ensureSyntaxTree(state, 8, 1000)!;
    const node = tree.topNode.firstChild!;
    const rule = ruleOf(node.type);
    expect(rule).not.toBeNull();
    expect(classesForTags(rule!.tags)).toContain("nfe-tok-invalid");
    // A tag object from "another copy": only name and set matter.
    const fake = { set: [] as unknown[], toString: () => "keyword" };
    (fake.set as unknown[]).push(fake);
    expect(classesForTags([fake as never])).toBe("cm-keyword nfe-tok-keyword");
    const unknown = { set: [] as unknown[], toString: () => "nope" };
    (unknown.set as unknown[]).push(unknown);
    expect(classesForTags([unknown as never])).toBeNull();
  });

  it("emits only nfe-tok-* classes", () => {
    for (const c of tokenClassNames()) expect(c).toMatch(/^nfe-tok-[a-z-]+$/);
  });

  it("a lezer grammar (TypeScript) produces keyword, string, comment, number and function classes", () => {
    const src = 'const x: number = 42; // note\nfunction f(s: string) { return s + "a"; }';
    expect(classesOf("ts", src, "const")).toContain("nfe-tok-keyword");
    expect(classesOf("ts", src, "42")).toContain("nfe-tok-number");
    expect(classesOf("ts", src, "// note")).toContain("nfe-tok-comment");
    expect(classesOf("ts", src, '"a"')).toContain("nfe-tok-string");
    expect(classesOf("ts", src, "f")).toContain("nfe-tok-function");
    expect(classesOf("ts", src, "number")).toContain("nfe-tok-type");
  });

  it("a legacy stream mode (shell) produces keyword, string and comment classes", () => {
    const src = '#!/bin/sh\nif [ -f "$1" ]; then echo ok; fi # done';
    const all = tokens("sh", src);
    const cls = new Set(all.flatMap((t) => (t.classes ?? "").split(" ").filter(Boolean)));
    expect(cls.has("nfe-tok-keyword")).toBe(true);
    expect(cls.has("nfe-tok-string")).toBe(true);
    expect(cls.has("nfe-tok-comment")).toBe(true);
  });

  it("round-trips the text exactly, line breaks included", () => {
    const src = "a = 1\n\nb = 'x'\n";
    const joined = tokens("py", src).map((t) => t.text).join("");
    expect(joined).toBe(src);
  });

  it("plain text between tokens carries no class", () => {
    const all = tokens("json", '{"k": 1}');
    expect(all.some((t) => t.classes === null && t.text.trim() === "")).toBe(true);
    expect(classesOf("json", '{"k": 1}', '"k"')).toContain("nfe-tok-property");
  });
});

import { describe, expect, it } from "vitest";
import { tokenClassNames, tokenizeForPreview } from "../src/highlight/highlighter";
import { languageFor, resolveLanguage } from "../src/highlight/registry";

function tokens(ext: string, text: string) {
  const entry = languageFor(ext);
  if (!entry) throw new Error(`no entry for .${ext}`);
  const resolved = resolveLanguage(entry);
  if (!resolved) throw new Error(`no language for .${ext}`);
  return tokenizeForPreview(text, resolved.language) ?? [];
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
      const out = tokenizeForPreview("echo hi # c\n", resolved.language);
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
    expect(tokenizeForPreview(big, resolved.language, 0)).toBeNull();
    expect(tokenizeForPreview("x = 1\n", resolved.language, 1000)).not.toBeNull();
  });

  it("emits Obsidian's cm-* class beside every nfe-tok-* class", () => {
    for (const t of tokens("ts", "const x = 1; // c")) {
      if (t.classes === null) continue;
      const parts = t.classes.split(" ");
      expect(parts.some((c) => c.startsWith("cm-")), t.classes).toBe(true);
      expect(parts.some((c) => c.startsWith("nfe-tok-")), t.classes).toBe(true);
    }
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

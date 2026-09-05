import { describe, expect, it } from "vitest";
import { tokenize } from "../src/highlight/highlighter";
import { languageFor, resolveLanguage } from "../src/highlight/registry";

function classesByText(text: string): Map<string, string | null> {
  const entry = languageFor("log");
  const resolved = entry ? resolveLanguage(entry) : null;
  if (!resolved) throw new Error("log entry missing");
  const out = new Map<string, string | null>();
  for (const t of tokenize(text, resolved.language) ?? []) if (t.text.trim()) out.set(t.text.trim(), t.classes);
  return out;
}

describe("log mode", () => {
  it("is registered for .log, .out and .err as a builtin", () => {
    expect(languageFor("log")?.source).toBe("builtin");
    expect(languageFor("out")?.name).toBe("Log");
    expect(languageFor("err")?.name).toBe("Log");
  });

  it("colours levels, timestamps, keys, strings and brackets", () => {
    const m = classesByText('2026-09-04 12:00:01.234 ERROR [main] user="max" size=42 failed\n');
    expect(m.get("2026-09-04 12:00:01.234")).toContain("nfe-tok-number");
    expect(m.get("ERROR")).toContain("nfe-tok-invalid");
    expect(m.get("[main]")).toContain("nfe-tok-namespace");
    expect(m.get('"max"')).toContain("nfe-tok-string");
    expect(m.get("user")).toContain("nfe-tok-property");
    expect(m.get("42")).toContain("nfe-tok-number");
    expect(m.get("failed")).toBeNull();
  });

  it("maps WARN to changed, INFO to a constant, DEBUG and stack frames to comment", () => {
    const m = classesByText("12:00:00 WARN slow\n12:00:01 INFO ok\n12:00:02 DEBUG x\n    at foo (a.js:1:2)\nTraceback (most recent call last):\n");
    expect(m.get("WARN")).toContain("nfe-tok-changed");
    expect(m.get("INFO")).toContain("nfe-tok-constant");
    expect(m.get("DEBUG")).toContain("nfe-tok-comment");
    expect(m.get("at foo (a.js:1:2)")).toContain("nfe-tok-comment");
    expect(m.get("Traceback (most recent call last):")).toContain("nfe-tok-comment");
  });

  it("round-trips the text", () => {
    const entry = languageFor("log");
    const resolved = entry ? resolveLanguage(entry) : null;
    const text = "a b\n\nERROR c\n";
    expect((tokenize(text, resolved!.language) ?? []).map((t) => t.text).join("")).toBe(text);
  });
});

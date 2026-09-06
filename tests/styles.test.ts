import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokenClassNames } from "../src/highlight/highlighter";

/**
 * A class the code emits and the stylesheet does not know is invisible to the
 * type checker and to every other test; on a device it shows up as "the panel
 * does not open". So: every `nfe-` class named in src/ has a rule in
 * styles.css, every `nfe-` class in styles.css is emitted by something, the
 * prefix is on every rule, and nothing uses !important.
 */

const ROOT = fileURLToPath(new URL("../", import.meta.url));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

const css = readFileSync(join(ROOT, "styles.css"), "utf8");
const cssWithoutComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
// Only the layers that touch the DOM emit classes, plus the highlighter's
// token table. The transport names its temp files `.nfe-tmp-*`, which is a
// file name, not a class.
const src = [
  ...walk(join(ROOT, "src", "ui")),
  ...walk(join(ROOT, "src", "settings")),
  ...walk(join(ROOT, "src", "highlight")),
  ...walk(join(ROOT, "src", "run")),
  join(ROOT, "src", "main.ts"),
]
  .map((f) => readFileSync(f, "utf8"))
  .join("\n");

// Only quoted string literals count: a comment that names the nfe-tok family in
// backticks is a pattern, not an emitted class. Classes are never built in
// template literals; if one ever is, this scan misses it and the device finds it.
const literals = [...src.matchAll(/["']([^"'\n]*)["']/g)].map((m) => m[1] ?? "").join(" ");
// `data-nfe-*` are the attributes a palette scopes on (palette/render.ts), not classes.
const emitted = new Set([...literals.matchAll(/(?<!data-)\bnfe-[a-z0-9-]*[a-z0-9]/g)].map((m) => m[0]));
const styled = new Set([...cssWithoutComments.matchAll(/\.(nfe-[a-z0-9-]+)/g)].map((m) => m[1] ?? ""));

describe("styles.css agrees with the classes the code emits", () => {
  it("emits at least one class, or the check went dead", () => {
    expect(emitted.size).toBeGreaterThan(0);
  });

  it("every emitted class has a rule, except the nfe-tok-* vocabulary, which Obsidian's cm-* rules colour", () => {
    expect([...emitted].filter((c) => !styled.has(c) && !c.startsWith("nfe-tok-")).sort()).toEqual([]);
  });

  it("every nfe-tok-* class the stylesheet names is one the highlighter emits", () => {
    const vocabulary = new Set(tokenClassNames());
    expect([...styled].filter((c) => c.startsWith("nfe-tok-") && !vocabulary.has(c)).sort()).toEqual([]);
  });

  it("every styled class is emitted", () => {
    expect([...styled].filter((c) => !emitted.has(c)).sort()).toEqual([]);
  });

  it("uses no !important", () => {
    expect(cssWithoutComments).not.toMatch(/!important/);
  });

  it("scopes every selector under an nfe- class", () => {
    const selectors = [...cssWithoutComments.matchAll(/(^|\})\s*([^{}]+)\{/g)].map((m) => (m[2] ?? "").trim()).filter(Boolean);
    expect(selectors.length).toBeGreaterThan(0);
    for (const sel of selectors) {
      for (const part of sel.split(",")) expect(part, sel).toMatch(/\.nfe-/);
    }
  });
});

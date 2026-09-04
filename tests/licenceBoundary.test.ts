import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The licence split is only as true as the dependency graph. src/format and
 * src/model are offered under MIT in addition to GPL, so nothing in them may
 * import from anywhere else in src/ (src/highlight holds GPL-derived tables),
 * from Obsidian, or from any DOM API by way of an import. Relative imports
 * within the two directories are fine, and so are the two importing each other.
 */

const SRC = fileURLToPath(new URL("../src/", import.meta.url));
const MIT_DIRS = ["format", "model"];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

function importsOf(file: string): string[] {
  const text = readFileSync(file, "utf8");
  const out: string[] = [];
  for (const m of text.matchAll(/(?:^|\n)\s*import\s[^;]*?from\s+["']([^"']+)["']/g)) if (m[1] !== undefined) out.push(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*import\s+["']([^"']+)["']/g)) if (m[1] !== undefined) out.push(m[1]);
  for (const m of text.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g)) if (m[1] !== undefined) out.push(m[1]);
  for (const m of text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)) if (m[1] !== undefined) out.push(m[1]);
  return out;
}

function isInsideMit(fromFile: string, spec: string): boolean {
  if (!spec.startsWith(".")) return false;
  const target = join(fromFile, "..", spec);
  const rel = relative(SRC, target).split(sep);
  return MIT_DIRS.includes(rel[0] ?? "");
}

describe("src/format and src/model stay free of GPL-derived and platform code", () => {
  const files = MIT_DIRS.flatMap((d) => walk(join(SRC, d)));

  it("has files to check", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files.map((f) => [relative(SRC, f).split(sep).join("/"), f]))("%s imports only from within the MIT directories", (_rel, file) => {
    const bad = importsOf(file).filter((spec) => !isInsideMit(file, spec));
    expect(bad).toEqual([]);
  });

  it("each MIT directory carries its own LICENSE", () => {
    for (const d of MIT_DIRS) {
      const text = readFileSync(join(SRC, d, "LICENSE"), "utf8");
      expect(text).toContain("MIT License");
      expect(text).toContain("GPL-3.0-only");
    }
  });
});

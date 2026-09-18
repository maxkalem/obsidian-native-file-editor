import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { HOTKEY_ACTIONS } from "../src/core/hotkeys";
import { KEYWORD_ROLES } from "../src/ui/AddToDictionaryModal";
import { EN } from "../src/i18n/en";

/**
 * The catalogue against the source: every key a module asks for has to be in
 * the English catalogue, because `t()` answers with the key itself when it is
 * not, and that would reach a user as `settings.foo.name`. The three key
 * families that are built rather than written out (the hotkey actions, their
 * groups, the keyword roles) are checked from their own lists.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory()) sourceFiles(path, out);
    else if (entry.name.endsWith(".ts")) out.push(path);
  }
  return out;
}

/** `t("key"` and `plural(n, "one", "other"` in a file, with the line for the message. */
function keysUsed(): Array<{ key: string; file: string; line: number }> {
  const out: Array<{ key: string; file: string; line: number }> = [];
  for (const file of sourceFiles(SRC)) {
    if (file.endsWith("/i18n/en.ts")) continue;
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      if (/^\s*(\*|\/\/)/.test(line)) continue;
      for (const m of line.matchAll(/\bt\("([^"]+)"/g)) out.push({ key: m[1] as string, file, line: i + 1 });
      for (const m of line.matchAll(/\bplural\([^,]+,\s*"([^"]+)",\s*"([^"]+)"/g)) {
        out.push({ key: m[1] as string, file, line: i + 1 });
        out.push({ key: m[2] as string, file, line: i + 1 });
      }
    }
  }
  return out;
}

describe("the English catalogue covers the source", () => {
  it("every key a module asks for exists", () => {
    const missing = keysUsed()
      .filter((use) => EN[use.key] === undefined)
      .map((use) => `${use.key} (${use.file.slice(SRC.length + 1)}:${use.line})`);
    expect(missing).toEqual([]);
  });

  it("the keys built from a fixed list exist: the hotkey actions, their groups and the keyword roles", () => {
    const missing: string[] = [];
    for (const action of HOTKEY_ACTIONS) {
      for (const key of [`hotkey.${action.id}.name`, `hotkey.${action.id}.meaning`]) {
        if (EN[key] === undefined) missing.push(key);
      }
      const group = `hotkey.group.${action.group.toLowerCase().replace(/ /g, "-")}`;
      if (EN[group] === undefined) missing.push(group);
    }
    for (const role of KEYWORD_ROLES) {
      if (EN[`keywordRole.${role}`] === undefined) missing.push(`keywordRole.${role}`);
    }
    expect([...new Set(missing)]).toEqual([]);
  });

  it("no catalogue key is unused, so a translator never translates something nobody shows", () => {
    const used = new Set(keysUsed().map((u) => u.key));
    for (const action of HOTKEY_ACTIONS) {
      used.add(`hotkey.${action.id}.name`);
      used.add(`hotkey.${action.id}.meaning`);
      used.add(`hotkey.group.${action.group.toLowerCase().replace(/ /g, "-")}`);
    }
    for (const role of KEYWORD_ROLES) used.add(`keywordRole.${role}`);
    expect(Object.keys(EN).filter((key) => !used.has(key))).toEqual([]);
  });
});

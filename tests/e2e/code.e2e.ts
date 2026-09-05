import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { tokenize } from "../../src/highlight/highlighter";
import { __allEntries, languageFor, resolveLanguage } from "../../src/highlight/registry";
import { decodeText } from "../../src/model/text/encoding";

/**
 * One real sample per registry language under fixtures/code, named
 * sample.<first extension>. Every entry with a language must parse its sample
 * and produce highlighted tokens; a mode that emits nothing on a plausible
 * file is either misregistered or broken, and this is where that shows up.
 * The same files are what the user opens on the device.
 */

const CODE = fileURLToPath(new URL("./fixtures/code/", import.meta.url));

describe("code samples", () => {
  const entries = __allEntries();

  it("has one sample file for every registry entry", () => {
    const missing = entries.map((e) => e.extensions[0] ?? "").filter((ext) => !fs.existsSync(path.join(CODE, `sample.${ext}`)));
    expect(missing).toEqual([]);
  });

  it("has no sample for an extension the registry does not know", () => {
    const orphans = fs
      .readdirSync(CODE)
      .map((f) => f.replace(/^sample\./, ""))
      .filter((ext) => languageFor(ext) === null);
    expect(orphans).toEqual([]);
  });

  describe.each(entries.map((e) => [e.name, e.extensions[0] ?? ""] as const))("%s (.%s)", (_name, ext) => {
    const entry = languageFor(ext);
    if (!entry) throw new Error(`no entry for .${ext}`);
    const bytes = new Uint8Array(fs.readFileSync(path.join(CODE, `sample.${ext}`)));

    it("is valid UTF-8 text with LF line endings", () => {
      const d = decodeText(bytes);
      expect(d.info.lossy).toBe(false);
      expect(d.info.eol).toBe("\n");
      expect(d.text.length).toBeGreaterThan(0);
    });

    it(entry.source === null ? "has no language and no tokens" : "parses and yields highlighted tokens that round-trip the text", () => {
      const text = decodeText(bytes).text;
      const resolved = resolveLanguage(entry);
      if (entry.source === null) {
        expect(resolved).toBeNull();
        return;
      }
      if (!resolved) throw new Error(`unresolved ${entry.name}`);
      const tokens = tokenize(text, resolved.language);
      if (tokens === null) throw new Error(`${entry.name}: parse timed out`);
      expect(tokens.map((t) => t.text).join("")).toBe(text);
      const classes = new Set(tokens.flatMap((t) => (t.classes ?? "").split(" ").filter(Boolean)));
      expect(classes.size, `${entry.name} produced no token classes`).toBeGreaterThan(0);
      for (const c of classes) expect(c).toMatch(/^(nfe-tok-|cm-)/);
      expect([...classes].some((c) => c.startsWith("cm-")), `${entry.name} produced no Obsidian cm-* class`).toBe(true);
    });
  });
});

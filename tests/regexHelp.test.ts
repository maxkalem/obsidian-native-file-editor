import { describe, expect, it } from "vitest";
import { __findAllByClass, __fire, __notices, __textOf } from "./mocks/obsidian";
import { RegexHelpModal } from "../src/ui/RegexHelpModal";

type Cell = { children: Array<{ textContent: string; hasClass: (c: string) => boolean }>; textContent: string };
type Table = { children: Array<{ children: Cell[] }> };

describe("RegexHelpModal", () => {
  it("renders the syntax table, the common searches with their Replace fields, and the keys of the editor", () => {
    const modal = new RegexHelpModal({} as never);
    modal.onOpen();
    expect(modal.titleEl.textContent).toBe("Regular expressions in search");
    const text = __textOf(modal.contentEl);
    expect(text).toContain("\\d{4}-\\d{2}-\\d{2}");
    expect(text).toContain("$3-$2-$1");
    expect(text).toContain("Alt+Enter");
    expect(text).toContain("Ctrl+Alt+↑  Ctrl+Alt+↓");
    expect(text).toContain("Shift+Alt+↑  Shift+Alt+↓");
    expect(text).toContain("Alt+drag");
    expect(text).toContain("Ctrl+Space");
    // Two pattern tables, then one table per key group.
    const tables = __findAllByClass(modal.contentEl, "nfe-regex-table") as Table[];
    expect(tables.length).toBe(6);
    // Every example (the second table) is a valid JavaScript regular expression.
    const examples = tables[1]!.children.map((tr) => tr.children[0]?.children[0]?.textContent ?? "");
    expect(examples.length).toBeGreaterThan(10);
    for (const code of examples) expect(() => new RegExp(code), code).not.toThrow();
    // Every pattern in the two pattern tables is clickable (a click copies); the key rows are not.
    expect(__findAllByClass(modal.contentEl, "nfe-regex-copy")).toHaveLength(tables[0]!.children.length + tables[1]!.children.length);
    expect(text).toContain("Click a pattern to copy it.");
  });

  it("a click on a pattern copies it and says so", async () => {
    const modal = new RegexHelpModal({} as never);
    modal.onOpen();
    const written: string[] = [];
    const g = globalThis as { navigator?: unknown };
    const saved = g.navigator;
    Object.defineProperty(globalThis, "navigator", { value: { clipboard: { writeText: async (t: string) => void written.push(t) } }, configurable: true });
    try {
      __fire(__findAllByClass(modal.contentEl, "nfe-regex-copy")[0], "click");
      await Promise.resolve();
    } finally {
      Object.defineProperty(globalThis, "navigator", { value: saved, configurable: true });
    }
    expect(written).toEqual(["."]);
    expect(__notices.at(-1)).toBe("Copied .");
  });
});

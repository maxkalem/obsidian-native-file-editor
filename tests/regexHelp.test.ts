import { describe, expect, it } from "vitest";
import { __findAllByClass, __textOf } from "./mocks/obsidian";
import { RegexHelpModal } from "../src/ui/RegexHelpModal";

describe("RegexHelpModal", () => {
  it("renders the syntax table, the common searches with their Replace fields, and what Select all does", () => {
    const modal = new RegexHelpModal({} as never);
    modal.onOpen();
    expect(modal.titleEl.textContent).toBe("Regular expressions in search");
    const rows = __findAllByClass(modal.contentEl, "nfe-regex-table").flatMap((t: { children: unknown[] }) => t.children);
    expect(rows.length).toBeGreaterThan(20);
    const text = __textOf(modal.contentEl);
    expect(text).toContain("\\d{4}-\\d{2}-\\d{2}");
    expect(text).toContain("$3-$2-$1");
    expect(text).toContain("Select all (Alt+Enter) turns every match into a cursor");
    // Every example (the second table; the first lists syntax fragments) is a valid JavaScript regular expression.
    const tables = __findAllByClass(modal.contentEl, "nfe-regex-table") as Array<{ children: Array<{ children: Array<{ children: Array<{ textContent: string }> }> }> }>;
    expect(tables).toHaveLength(2);
    const examples = tables[1]!.children.map((tr) => tr.children[0]?.children[0]?.textContent ?? "");
    expect(examples.length).toBeGreaterThan(10);
    for (const code of examples) expect(() => new RegExp(code), code).not.toThrow();
  });
});

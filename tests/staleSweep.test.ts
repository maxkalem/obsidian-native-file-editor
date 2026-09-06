import { describe, expect, it } from "vitest";
import { findStaleFiles } from "../src/core/staleSweep";

const file = (path: string) => ({ path, extension: path.slice(path.lastIndexOf(".") + 1) });

describe("findStaleFiles", () => {
  it("lists each folder once and names the files the disk lacks, in Obsidian's order", async () => {
    const asked: string[] = [];
    const disk: Record<string, string[]> = {
      "": ["root.py"],
      "NFE/test/code": ["NFE/test/code/ts sample.ts", "NFE/test/code/as sample.as"],
    };
    const report = await findStaleFiles(
      [file("NFE/test/code/sample.ts"), file("NFE/test/code/ts sample.ts"), file("NFE/test/code/sample.as"), file("root.py"), file("NFE/test/code/as sample.as")],
      new Set(["ts", "as", "py"]),
      async (folder) => {
        asked.push(folder);
        return { files: disk[folder] ?? [] };
      }
    );
    expect(asked).toEqual(["NFE/test/code", ""]);
    expect(report).toEqual({ checked: 5, missing: ["NFE/test/code/sample.ts", "NFE/test/code/sample.as"], unlisted: [] });
  });

  it("skips files whose extension the plugin does not serve, case-insensitively", async () => {
    const report = await findStaleFiles([file("a.md"), file("b.PY"), file("c.png")], new Set(["py"]), async () => ({ files: [] }));
    expect(report.checked).toBe(1);
    expect(report.missing).toEqual(["b.PY"]);
  });

  it("reports a folder it could not list instead of judging its files", async () => {
    const report = await findStaleFiles([file("gone/x.txt"), file("ok/y.txt")], new Set(["txt"]), async (folder) => {
      if (folder === "gone") throw new Error("EACCES");
      return { files: ["ok/y.txt"] };
    });
    expect(report).toEqual({ checked: 2, missing: [], unlisted: ["gone"] });
  });
});

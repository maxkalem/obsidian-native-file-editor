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
    expect(report).toEqual({ checked: 5, missing: ["NFE/test/code/sample.ts", "NFE/test/code/sample.as"], unindexed: [], unlisted: [] });
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
    expect(report).toEqual({ checked: 2, missing: [], unindexed: [], unlisted: ["gone"] });
  });

  it("names the files on the disk that Obsidian does not list: a batch rename whose create events were lost", async () => {
    // 2026-09-07: 106 samples renamed outside Obsidian; the index kept the old names and never saw the new ones.
    const disk = ["code/016 ceylon sample.ceylon", "code/017 clj sample.clj", "code/015 c sample.c", "code/.015 c sample.c.nfe-tmp-1", "code/notes.md", "code/README", "code/.hidden.ts"];
    const report = await findStaleFiles(
      [file("code/ceylon sample.ceylon"), file("code/clj sample.clj"), file("code/015 c sample.c")],
      new Set(["ceylon", "clj", "c", "ts"]),
      async () => ({ files: disk })
    );
    expect(report.missing).toEqual(["code/ceylon sample.ceylon", "code/clj sample.clj"]);
    // Dot-files (the atomic-write temp file, hidden files) and unregistered extensions are not the plugin's to adopt.
    expect(report.unindexed).toEqual(["code/016 ceylon sample.ceylon", "code/017 clj sample.clj"]);
  });

  it("only judges folders where Obsidian lists at least one of the plugin's files", async () => {
    const asked: string[] = [];
    const report = await findStaleFiles([file("a/x.py")], new Set(["py"]), async (folder) => {
      asked.push(folder);
      return { files: ["a/x.py", "a/y.py"] };
    });
    expect(asked).toEqual(["a"]);
    expect(report.unindexed).toEqual(["a/y.py"]);
  });
});

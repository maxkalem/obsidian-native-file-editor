import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { conflictLines, conflictTints, diffLineKind } from "../src/ui/lineTints";

describe("diff rows", () => {
  it("names a line by its first characters: added, removed, hunk, header, or nothing", () => {
    expect(diffLineKind("+new")).toBe("ins");
    expect(diffLineKind("-old")).toBe("del");
    expect(diffLineKind("+++ b/file.ts")).toBe("header");
    expect(diffLineKind("--- a/file.ts")).toBe("header");
    expect(diffLineKind("@@ -1,3 +1,4 @@")).toBe("hunk");
    expect(diffLineKind("diff --git a/x b/x")).toBe("header");
    expect(diffLineKind("index 3f2a..9b1c 100644")).toBe("header");
    expect(diffLineKind(" context")).toBeNull();
    expect(diffLineKind("")).toBeNull();
  });
});

describe("conflict rows", () => {
  it("tints ours, base and theirs between Git's markers, the markers themselves as heads and separators", () => {
    const lines = ["a", "<<<<<<< HEAD", "ours 1", "ours 2", "||||||| base", "base", "=======", "theirs", ">>>>>>> feature", "b", "<<<<<<<", "open"];
    expect([...conflictLines(lines)]).toEqual([
      [2, "oursHead"],
      [3, "ours"],
      [4, "ours"],
      [5, "sep"],
      [6, "base"],
      [7, "sep"],
      [8, "theirs"],
      [9, "theirsHead"],
      [11, "oursHead"],
      [12, "ours"],
    ]);
    // A ======= outside a conflict, or a marker with more characters, is text.
    expect(conflictLines(["=======", "<<<<<<<<< x", "y"]).size).toBe(0);
  });

  it("is a decoration set over the document, rebuilt on a change and empty when there is no marker", () => {
    let state = EditorState.create({ doc: "x\ny", extensions: [conflictTints] });
    const count = (s: EditorState) => {
      let n = 0;
      (s.field(conflictTints as never) as { between: (a: number, b: number, f: () => void) => void }).between(0, s.doc.length, () => void n++);
      return n;
    };
    expect(count(state)).toBe(0);
    state = state.update({ changes: { from: 0, insert: "<<<<<<< a\nours\n=======\ntheirs\n>>>>>>> b\n" } }).state;
    expect(count(state)).toBe(5);
    state = state.update({ changes: { from: 0, to: state.doc.length, insert: "clean" } }).state;
    expect(count(state)).toBe(0);
  });
});

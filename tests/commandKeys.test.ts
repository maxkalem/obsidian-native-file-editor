import { describe, expect, it } from "vitest";
import { COMMAND_KEYS, defaultCommandChord, defaultObsidianHotkeys, fromObsidianHotkey, sameChords, toObsidianHotkey } from "../src/core/commandKeys";
import { keyOfEvent, parseChord } from "../src/core/hotkeys";

/**
 * The commands' default keys and the two conversions to and from Obsidian's
 * hotkey shape, so the plugin's page and Obsidian's show one binding.
 */
describe("command keys", () => {
  it("every default parses; the unbound ones are the rest of the menus plus Reread and the example palette (his lists, 2026-09-22)", () => {
    const unbound = COMMAND_KEYS.filter((c) => c.key === null).map((c) => c.id);
    expect(unbound).toEqual([
      "unwrap-lines", "wrap-lines", "add-to-dictionary", "insert-date", "insert-date-time", "toggle-word-wrap", "toggle-invisibles",
      "line-direction-auto", "line-direction-ltr", "line-direction-rtl", "search-web", "keys-guide", "reload-palettes", "write-example-palette",
    ]);
    for (const command of COMMAND_KEYS) {
      if (command.key === null) continue;
      expect(defaultCommandChord(command)).not.toBeNull();
      expect(command.key.startsWith("Ctrl+Alt+Shift+")).toBe(true);
    }
    expect(COMMAND_KEYS.find((c) => c.id === "stop-run")?.key).toBe("Ctrl+Alt+Shift+Pause");
    expect(COMMAND_KEYS.filter((c) => c.desktopOnly).map((c) => c.id)).toEqual(["run-file", "stop-run"]);
  });

  it("writes a chord as Obsidian stores it: Mod for the command key, the key as the event names it", () => {
    expect(toObsidianHotkey(parseChord("Ctrl+Alt+Shift+F")!)).toEqual({ modifiers: ["Mod", "Alt", "Shift"], key: "F" });
    expect(toObsidianHotkey(parseChord("Ctrl+Space")!)).toEqual({ modifiers: ["Mod"], key: " " });
    expect(toObsidianHotkey(parseChord("F3")!)).toEqual({ modifiers: [], key: "F3" });
    expect(defaultObsidianHotkeys(COMMAND_KEYS.find((c) => c.id === "stop-run")!)).toEqual([{ modifiers: ["Mod", "Alt", "Shift"], key: "Pause" }]);
    expect(defaultObsidianHotkeys(COMMAND_KEYS.find((c) => c.id === "reload-palettes")!)).toEqual([]);
  });

  it("reads Obsidian's hotkey back, Ctrl and Meta as the command key, a space as Space, a code as its letter", () => {
    expect(fromObsidianHotkey({ modifiers: ["Mod", "Alt", "Shift"], key: "F" })).toEqual({ mod: true, shift: true, alt: true, key: "F" });
    expect(fromObsidianHotkey({ modifiers: ["Ctrl"], key: "k" })).toEqual({ mod: true, shift: false, alt: false, key: "K" });
    expect(fromObsidianHotkey({ modifiers: ["Meta", "Shift"], key: " " })).toEqual({ mod: true, shift: true, alt: false, key: "Space" });
    expect(fromObsidianHotkey({ modifiers: [], code: "KeyG" })).toEqual({ mod: false, shift: false, alt: false, key: "G" });
    expect(fromObsidianHotkey({ modifiers: ["Mod"], key: "" })).toBeNull();
    expect(fromObsidianHotkey("Mod+F")).toBeNull();
    expect(fromObsidianHotkey(null)).toBeNull();
  });

  it("the Pause key and the keypad digits are chords now: his defaults use both", () => {
    expect(parseChord("Ctrl+Alt+Shift+Pause")?.key).toBe("Pause");
    expect(keyOfEvent({ code: "Pause", key: "Pause" })).toBe("Pause");
    // Num1 is 1: Obsidian does not tell the keypad from the digit row, so neither does the recorder.
    expect(keyOfEvent({ code: "Numpad1", key: "1" })).toBe("1");
    expect(keyOfEvent({ code: "Numpad5", key: "End" })).toBe("5");
    expect(sameChords([parseChord("Ctrl+1")!], [parseChord("Ctrl+1")!])).toBe(true);
    expect(sameChords([parseChord("Ctrl+1")!], [parseChord("Ctrl+2")!])).toBe(false);
  });
});

import { describe, expect, it } from "vitest";
import { HOTKEY_ACTIONS, HOTKEY_PLATFORMS, bakedMatches, chordConflicts, chordFor, chordOfEvent, chordText, defaultChord, describeChord, keyOfEvent, matchesEvent, normalizeHotkeys, obsidianModifiers, parseChord, platformOf, toCodeMirrorKey } from "../src/core/hotkeys";

const evt = (code: string, mods: Partial<{ ctrl: boolean; alt: boolean; shift: boolean; meta: boolean }> = {}, key = "") => ({ code, key, ctrlKey: mods.ctrl === true, altKey: mods.alt === true, shiftKey: mods.shift === true, metaKey: mods.meta === true });

describe("chords", () => {
  it("parse in any order, with aliases, and print back canonically", () => {
    expect(parseChord("Ctrl+Alt+ArrowUp")).toEqual({ mod: true, shift: false, alt: true, key: "ArrowUp" });
    expect(parseChord("alt + ctrl + up")).toEqual({ mod: true, shift: false, alt: true, key: "ArrowUp" });
    expect(parseChord("Shift+F3")).toEqual({ mod: false, shift: true, alt: false, key: "F3" });
    expect(parseChord("Cmd+f")).toEqual({ mod: true, shift: false, alt: false, key: "F" });
    expect(parseChord("Ctrl+/")).toEqual({ mod: true, shift: false, alt: false, key: "/" });
    expect(parseChord("Ctrl++")).toEqual({ mod: true, shift: false, alt: false, key: "+" });
    expect(parseChord("Ctrl+Space")).toEqual({ mod: true, shift: false, alt: false, key: "Space" });
    expect(parseChord("Ctrl")).toBeNull();
    expect(parseChord("")).toBeNull();
    expect(parseChord("Ctrl+F+G")).toBeNull();
    expect(parseChord("Ctrl+Bogus")).toBeNull();
    expect(chordText(parseChord("alt+shift+ctrl+↓")!)).toBe("Ctrl+Shift+Alt+ArrowDown");
    expect(describeChord(parseChord("Ctrl+Alt+ArrowUp")!)).toBe("Ctrl+Alt+↑");
    expect(describeChord(parseChord("Ctrl+Alt+ArrowUp")!, true)).toBe("Cmd+Alt+↑");
  });

  it("match a key event by physical key and exact modifiers, on any layout", () => {
    const ctrlF = parseChord("Ctrl+F")!;
    expect(matchesEvent(ctrlF, evt("KeyF", { ctrl: true }, "а"))).toBe(true);
    expect(matchesEvent(ctrlF, evt("KeyF", { ctrl: true, shift: true }))).toBe(false);
    expect(matchesEvent(ctrlF, evt("KeyF", { meta: true }))).toBe(false);
    expect(matchesEvent(ctrlF, evt("KeyF", { meta: true }), true)).toBe(true);
    expect(matchesEvent(parseChord("Alt+Enter")!, evt("NumpadEnter", { alt: true }))).toBe(true);
    expect(matchesEvent(parseChord("Ctrl+/")!, evt("Slash", { ctrl: true }, "."))).toBe(true);
    expect(matchesEvent(parseChord("Ctrl+Shift+L")!, evt("KeyL", { ctrl: true, shift: true }))).toBe(true);
    expect(keyOfEvent(evt("ShiftLeft"))).toBeNull();
    expect(keyOfEvent(evt("Digit3"))).toBe("3");
    expect(chordOfEvent(evt("ArrowDown", { alt: true, shift: true }))).toEqual({ mod: false, shift: true, alt: true, key: "ArrowDown" });
    expect(chordOfEvent(evt("ControlLeft", { ctrl: true }))).toBeNull();
  });

  it("become CodeMirror key names", () => {
    expect(toCodeMirrorKey(parseChord("Ctrl+Alt+ArrowUp")!)).toBe("Mod-Alt-ArrowUp");
    expect(toCodeMirrorKey(parseChord("Shift+Alt+ArrowDown")!)).toBe("Shift-Alt-ArrowDown");
    expect(toCodeMirrorKey(parseChord("Alt+L")!)).toBe("Alt-l");
    expect(toCodeMirrorKey(parseChord("Ctrl+Space")!)).toBe("Mod- ");
  });

  it("resolve an action's chord from the overrides, fall back to the platform's default, and keep only real changes", () => {
    expect(chordText(chordFor("add-cursor-above", {}, "win"))).toBe("Ctrl+Alt+ArrowUp");
    expect(chordText(chordFor("add-cursor-above", { "add-cursor-above": "Shift+Alt+ArrowUp" }, "win"))).toBe("Shift+Alt+ArrowUp");
    expect(chordText(chordFor("add-cursor-above", { "add-cursor-above": "nonsense" }, "win"))).toBe("Ctrl+Alt+ArrowUp");
    // Per platform: a flat map (the 09-09 afternoon shape) is Windows's; the nested shape keeps each platform's own, minus its defaults.
    expect(normalizeHotkeys({ "add-cursor-above": "alt+shift+up", search: "Ctrl+F", bogus: "Ctrl+X", "find-next": 3, replace: "Ctrl" })).toEqual({ win: { "add-cursor-above": "Shift+Alt+ArrowUp" }, mac: {}, linux: {} });
    expect(normalizeHotkeys({ win: { search: "Ctrl+F" }, mac: { search: "Ctrl+F", completion: "Alt+Space", replace: "Ctrl+H" }, linux: { completion: "Alt+Space" } })).toEqual({ win: {}, mac: { replace: "Ctrl+H" }, linux: { completion: "Alt+Space" } });
    expect(normalizeHotkeys(null)).toEqual({ win: {}, mac: {}, linux: {} });
    // Every default parses on every platform and no two defaults collide there.
    for (const platform of HOTKEY_PLATFORMS) {
      for (const a of HOTKEY_ACTIONS) expect(defaultChord(a, platform), `${a.id} on ${platform}`).toBeTruthy();
      expect(chordConflicts({}, platform), platform).toEqual([]);
    }
    // The user's remap onto Copy line up is reported as a conflict of the two.
    expect(chordConflicts({ "add-cursor-above": "Shift+Alt+ArrowUp" }, "win")).toEqual([["add-cursor-above", "copy-line-up"]]);
  });

  it("macOS has its own defaults where the Mac does it differently, and Cmd for Ctrl everywhere else", () => {
    const mac = (id: string) => describeChord(chordFor(id, {}, "mac"), true);
    expect(mac("search")).toBe("Cmd+F");
    expect(mac("replace")).toBe("Cmd+Alt+F");
    expect(mac("find-next")).toBe("Cmd+G");
    expect(mac("find-previous")).toBe("Cmd+Shift+G");
    expect(mac("find-next-alt")).toBe("F3");
    expect(mac("completion")).toBe("Alt+Space");
    expect(mac("toggle-block-comment")).toBe("Cmd+Alt+/");
    expect(mac("add-cursor-above")).toBe("Cmd+Alt+↑");
    expect(describeChord(chordFor("replace", {}, "linux"))).toBe("Ctrl+H");
    expect(platformOf({ isMacOS: true })).toBe("mac");
    expect(platformOf({ isIosApp: true })).toBe("mac");
    expect(platformOf({ isWin: true })).toBe("win");
    expect(platformOf({})).toBe("linux");
  });

  it("match Obsidian's baked hotkeys: modifiers sorted with Mod resolved (Ctrl, or Meta on macOS), the key without case, Space as a space", () => {
    const chord = (t: string) => parseChord(t)!;
    expect(obsidianModifiers(chord("Ctrl+Alt+Enter"))).toBe("Alt,Ctrl");
    expect(obsidianModifiers(chord("Shift+Ctrl+B"), true)).toBe("Meta,Shift");
    expect(obsidianModifiers(chord("F3"))).toBe("");
    // Obsidian's defaults: Ctrl+B is bold ({ modifiers: "Ctrl", key: "b" } once baked), Alt+Enter follows a link.
    expect(bakedMatches({ modifiers: "Ctrl", key: "b" }, chord("Ctrl+B"))).toBe(true);
    expect(bakedMatches({ modifiers: "Ctrl", key: "b" }, chord("Ctrl+Shift+B"))).toBe(false);
    expect(bakedMatches({ modifiers: "Meta", key: "b" }, chord("Ctrl+B"), true)).toBe(true);
    expect(bakedMatches({ modifiers: "Alt", key: "Enter" }, chord("Alt+Enter"))).toBe(true);
    expect(bakedMatches({ modifiers: "Alt,Ctrl", key: "ArrowUp" }, chord("Ctrl+Alt+ArrowUp"))).toBe(true);
    expect(bakedMatches({ modifiers: "Ctrl", key: " " }, chord("Ctrl+Space"))).toBe(true);
    // Not the shape: no match, no throw.
    expect(bakedMatches({ modifiers: 3, key: null } as never, chord("Ctrl+B"))).toBe(false);
  });
});

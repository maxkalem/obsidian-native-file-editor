import { beforeEach, describe, expect, it } from "vitest";
import {
  Events,
  TFile,
  __findAllByClass,
  __findByClass,
  __fire,
  __modalInstances,
  __notices,
  __openedModals,
  __resetObsidianMock,
  __textOf,
  mockView,
} from "./mocks/obsidian";
import type { Timers } from "../src/core/autosave";
import { Logger } from "../src/core/log";
import { type Transport, TransportError } from "../src/platform/transport";
import { DeviceLocalStore } from "../src/settings/DeviceLocalStore";
import { DEFAULT_SETTINGS, type SharedSettings } from "../src/settings/settings";
import { type RunViewDeps, TextView } from "../src/ui/TextView";
import type { ExecuteRequest, ExecuteResult } from "../src/run/execute";
import type { EditorFactory, EditorHandle, EditorOptions } from "../src/ui/editor";

/**
 * The view against a fake editor, a fake transport and fake timers. What this
 * proves: the regions, the mode switches, what gets written and when. What it
 * cannot prove: anything CodeMirror or CSS does; that is the device's job.
 */

class FakeEditor implements EditorHandle {
  text: string;
  destroyed = false;
  focused = false;
  constructor(readonly options: EditorOptions) {
    this.text = options.text;
  }
  getText(): string {
    return this.text;
  }
  setText(t: string): void {
    this.text = t;
  }
  focus(): void {
    this.focused = true;
  }
  destroy(): void {
    this.destroyed = true;
  }
  /** The test types: change the text and tell the view. */
  type(t: string): void {
    this.text = t;
    this.options.onChange();
  }
}

class FakeTransport implements Transport {
  readonly kind = "desktop" as const;
  files = new Map<string, Uint8Array>();
  writes: Array<{ path: string; bytes: Uint8Array }> = [];
  async readBinary(p: string): Promise<Uint8Array> {
    const f = this.files.get(p);
    if (!f) throw new Error(`missing ${p}`);
    return f;
  }
  async writeBinaryAtomic(p: string, bytes: Uint8Array): Promise<void> {
    this.writes.push({ path: p, bytes });
    this.files.set(p, bytes);
  }
  inflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  deflateRaw(d: Uint8Array): Promise<Uint8Array> {
    return Promise.resolve(d);
  }
  listDir(): Promise<{ files: string[]; folders: string[] }> {
    return Promise.resolve({ files: [], folders: [] });
  }
  mkdir(): Promise<void> {
    return Promise.resolve();
  }
}

class FakeTimers implements Timers {
  private next = 1;
  pending = new Map<number, () => void>();
  setTimeout(fn: () => void): number {
    const id = this.next++;
    this.pending.set(id, fn);
    return id;
  }
  clearTimeout(id: number): void {
    this.pending.delete(id);
  }
  fireAll(): void {
    const fns = [...this.pending.values()];
    this.pending.clear();
    for (const fn of fns) fn();
  }
}

const utf8 = (s: string) => new TextEncoder().encode(s);
const tick = () => new Promise<void>((r) => setTimeout(r, 0));

function harness(overrides: Partial<SharedSettings> = {}, run?: RunViewDeps) {
  const vault = new Events();
  const leaf = { app: { vault, workspace: {} } };
  const transport = new FakeTransport();
  const timers = new FakeTimers();
  const device = new DeviceLocalStore("v", null);
  const editors: FakeEditor[] = [];
  const factory: EditorFactory = {
    create: (_parent, options) => {
      const e = new FakeEditor(options);
      editors.push(e);
      return e;
    },
  };
  let now = 100_000;
  let settings: SharedSettings = { ...DEFAULT_SETTINGS, ...overrides };
  const log = new Logger({ sink: null, timers, now: () => now });
  const view = mockView(
    new TextView(leaf as never, {
      settings: () => settings,
      device,
      transport,
      editorFactory: factory,
      timers,
      now: () => now,
      log,
      ...(run ? { run } : {}),
    })
  );
  return {
    view,
    log,
    factory,
    vault,
    transport,
    timers,
    device,
    editors,
    lastEditor: () => editors[editors.length - 1] as FakeEditor,
    advance: (ms: number) => void (now += ms),
    setSettings: (s: Partial<SharedSettings>) => void (settings = { ...settings, ...s }),
    head: () => __findByClass(view.contentEl, "nfe-head"),
    body: () => __findByClass(view.contentEl, "nfe-body"),
    modeButton: () => __findByClass(view.contentEl, "nfe-mode-button"),
  };
}

beforeEach(() => __resetObsidianMock());

describe("TextView", () => {
  it("builds head and body inside the content element and opens in preview by default", async () => {
    const h = harness();
    h.transport.files.set("notes/a.txt", utf8("hello\nworld"));
    await h.view.__load(new TFile("notes/a.txt"));
    expect(h.view.contentEl.hasClass("nfe-text-content")).toBe(true);
    expect(h.head()).not.toBeNull();
    expect(h.body()).not.toBeNull();
    expect(h.view.mode).toBe("preview");
    expect(h.editors).toHaveLength(1);
    expect(h.lastEditor().options).toMatchObject({ text: "hello\nworld", readOnly: true, language: null });
    expect(h.lastEditor().focused).toBe(false);
    const host = __findByClass(h.body(), "nfe-editor");
    expect(host.hasClass("nfe-readonly")).toBe(true);
    expect(host.hasClass("cm-s-obsidian")).toBe(true);
    expect(__textOf(h.head())).toContain("UTF-8");
    expect(__textOf(h.head())).toContain("LF");
    expect(h.modeButton().textContent).toBe("Edit");
  });

  it("the Edit button builds the editor with the current settings; Preview tears it down", async () => {
    const h = harness({ lineNumbers: false, wordWrap: true, tabSize: 2, tabInsertsSpaces: true });
    h.transport.files.set("a.txt", utf8("x"));
    await h.view.__load(new TFile("a.txt"));
    const previewEditor = h.lastEditor();
    __fire(h.modeButton(), "click");
    await tick();
    expect(h.view.mode).toBe("edit");
    expect(previewEditor.destroyed).toBe(true);
    expect(h.editors).toHaveLength(2);
    expect(h.lastEditor().options).toMatchObject({ text: "x", readOnly: false, lineNumbers: false, wordWrap: true, tabSize: 2, tabInsertsSpaces: true });
    expect(h.lastEditor().focused).toBe(true);
    expect(__findByClass(h.body(), "nfe-editor").hasClass("nfe-readonly")).toBe(false);
    expect(h.modeButton().textContent).toBe("Preview");
    __fire(h.modeButton(), "click");
    await tick();
    expect(h.view.mode).toBe("preview");
    expect(h.editors).toHaveLength(3);
    expect(h.lastEditor().options.readOnly).toBe(true);
  });

  it("the header action toggles too", async () => {
    const h = harness();
    h.transport.files.set("a.txt", utf8("x"));
    await h.view.__load(new TFile("a.txt"));
    expect(h.view.actions.map((a) => a.icon)).toEqual(["pencil"]);
    __fire(h.view.actions[0]?.el, "click");
    await tick();
    expect(h.view.mode).toBe("edit");
  });

  it("typing autosaves after the delay, in the file's own encoding and line ending", async () => {
    const h = harness();
    h.transport.files.set("a.txt", new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("one\r\ntwo")]));
    await h.view.__load(new TFile("a.txt"));
    await h.view.setMode("edit");
    h.lastEditor().type("one\ntwo\nthree");
    expect(h.transport.writes).toHaveLength(0);
    h.timers.fireAll();
    await tick();
    expect(h.transport.writes).toHaveLength(1);
    expect(h.transport.writes[0]?.path).toBe("a.txt");
    expect(h.transport.writes[0]?.bytes).toEqual(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8("one\r\ntwo\r\nthree")]));
  });

  it("leaving edit mode or the file flushes pending typing first", async () => {
    const h = harness();
    h.transport.files.set("a.txt", utf8("a"));
    await h.view.__load(new TFile("a.txt"));
    await h.view.setMode("edit");
    h.lastEditor().type("ab");
    await h.view.setMode("preview");
    expect(h.transport.writes).toHaveLength(1);
    expect(h.lastEditor().options.text).toBe("ab");
    await h.view.setMode("edit");
    h.lastEditor().type("abc");
    await h.view.__unload();
    expect(h.transport.writes).toHaveLength(2);
    expect(new TextDecoder().decode(h.transport.writes[1]?.bytes)).toBe("abc");
    expect(h.body().children).toHaveLength(0);
  });

  it("a file that is not valid UTF-8 opens read-only with a warning badge and never writes", async () => {
    const h = harness({ initialMode: "edit" });
    h.transport.files.set("a.txt", new Uint8Array([0xcf, 0xf0, 0xe8, 0xe2, 0xb3, 0xf2]));
    await h.view.__load(new TFile("a.txt"));
    expect(h.view.mode).toBe("edit");
    expect(h.lastEditor().options.readOnly).toBe(true);
    expect(__findByClass(h.head(), "nfe-badge-warn")).not.toBeNull();
    expect(__textOf(h.head())).toContain("windows-1251 (guess)");
    h.lastEditor().type("changed");
    h.timers.fireAll();
    await tick();
    expect(h.transport.writes).toHaveLength(0);
  });

  it("a read-only preview never schedules a save even if the editor reports a change", async () => {
    const h = harness();
    h.transport.files.set("a.txt", utf8("a"));
    await h.view.__load(new TFile("a.txt"));
    h.lastEditor().type("ab");
    h.timers.fireAll();
    await tick();
    expect(h.transport.writes).toHaveLength(0);
  });

  it("a large file opens in preview with a notice; Edit opens the modal; Edit anyway enters edit", async () => {
    const h = harness({ initialMode: "edit" });
    h.device.update({ largeFileBytes: 10 });
    h.transport.files.set("big.log", utf8("0123456789ABCDEF"));
    await h.view.__load(new TFile("big.log"));
    expect(h.view.mode).toBe("preview");
    expect(__notices.some((n) => n.includes("big.log") && n.includes("preview"))).toBe(true);
    __fire(h.modeButton(), "click");
    await tick();
    expect(h.view.mode).toBe("preview");
    expect(__openedModals).toEqual(["LargeFileModal"]);
    const modal = __modalInstances[0];
    modal.onOpen();
    expect(__textOf(modal.contentEl)).toContain("16 B");
    const buttons = __findAllByClass(modal.contentEl, "mod-cta");
    expect(buttons).toHaveLength(1);
    __fire(buttons[0], "click");
    await tick();
    expect(h.view.mode).toBe("edit");
  });

  it("remember-per-file stores the mode on this device and reopens with it", async () => {
    const h = harness({ initialMode: "remember" });
    h.transport.files.set("a.txt", utf8("x"));
    await h.view.__load(new TFile("a.txt"));
    expect(h.view.mode).toBe("preview");
    await h.view.setMode("edit");
    expect(h.device.get().lastMode).toEqual({ "a.txt": "edit" });
    await h.view.__unload();
    await h.view.__load(new TFile("a.txt"));
    expect(h.view.mode).toBe("edit");
  });

  it("an external change reloads the preview, is ignored right after our own write, and never overrides unsaved typing", async () => {
    const h = harness();
    h.transport.files.set("a.txt", utf8("v1"));
    const file = new TFile("a.txt");
    await h.view.__load(file);
    h.transport.files.set("a.txt", utf8("v2"));
    h.vault.trigger("modify", file);
    await tick();
    expect(h.lastEditor().text).toBe("v2");

    await h.view.setMode("edit");
    h.lastEditor().type("v3");
    h.timers.fireAll();
    await tick();
    expect(h.transport.writes).toHaveLength(1);
    // The echo of our own write arrives within the window: nothing happens.
    h.transport.files.set("a.txt", utf8("external"));
    h.vault.trigger("modify", file);
    await tick();
    expect(h.lastEditor().text).toBe("v3");
    // Later, with the editor clean, an external change is taken.
    h.advance(5000);
    h.vault.trigger("modify", file);
    await tick();
    expect(h.lastEditor().text).toBe("external");
    // With unsaved typing, the editor wins.
    h.lastEditor().type("mine");
    h.transport.files.set("a.txt", utf8("theirs"));
    h.vault.trigger("modify", file);
    await tick();
    expect(h.lastEditor().text).toBe("mine");
  });

  it("a file Obsidian lists but the disk lacks: an error panel that says the list was stale, and the plugin is asked to reconcile", async () => {
    const missing: string[] = [];
    const h = harness();
    (h.view as unknown as { nfeDeps: { onMissing?: (p: string) => void } }).nfeDeps.onMissing = (p) => void missing.push(p);
    h.transport.readBinary = async (p: string) => {
      throw new TransportError("not-found", `File not found: ${p}`, p);
    };
    await h.view.__load(new TFile("gone.txt"));
    expect(__textOf(h.body())).toContain("no longer exists on disk");
    expect(missing).toEqual(["gone.txt"]);
    expect(h.log.recent().join("\n")).toContain("listed by Obsidian but not on disk");
  });

  it("a read failure shows an error in the body and no head", async () => {
    const h = harness();
    await h.view.__load(new TFile("missing.txt"));
    expect(__findByClass(h.body(), "nfe-error")).not.toBeNull();
    expect(__textOf(h.body())).toContain("missing.txt");
    expect(h.head().children).toHaveLength(0);
  });

  it("a code file gets its language in both modes; a plain file gets none", async () => {
    const h = harness();
    h.transport.files.set("a.py", utf8("x = 1 # c"));
    h.transport.files.set("a.txt", utf8("x = 1 # c"));
    await h.view.__load(new TFile("a.py"));
    expect(h.lastEditor().options.language).not.toBeNull();
    expect(h.lastEditor().options.readOnly).toBe(true);
    expect(__textOf(h.head())).toContain("Python");
    await h.view.setMode("edit");
    expect(h.lastEditor().options.language).not.toBeNull();
    await h.view.__unload();
    await h.view.__load(new TFile("a.txt"));
    expect(h.lastEditor().options.language).toBeNull();
    await h.view.setMode("edit");
    expect(h.lastEditor().options.language).toBeNull();
  });

  it("logs every open with size, encoding, language and mode", async () => {
    const h = harness();
    h.transport.files.set("a.py", utf8("x = 1"));
    await h.view.__load(new TFile("a.py"));
    const line = h.log.recent().find((l) => l.includes("open a.py"));
    expect(line).toContain("Python/lezer");
    expect(line).toContain("UTF-8");
    expect(line).toContain("mode preview");
  });

  it("an editor that fails with the language is rebuilt as plain text, with a notice and a log line, never an exception", async () => {
    const h = harness();
    let calls = 0;
    h.factory.create = (_parent, options) => {
      calls++;
      if (options.language !== null) throw new Error("bad grammar");
      const e = new FakeEditor(options);
      h.editors.push(e);
      return e;
    };
    h.transport.files.set("a.py", utf8("x = 1"));
    await h.view.__load(new TFile("a.py"));
    // The preview already failed once and fell back, dropping the language;
    // edit mode then builds without it on the first try.
    expect(calls).toBe(2);
    await h.view.setMode("edit");
    expect(calls).toBe(3);
    expect(h.view.mode).toBe("edit");
    expect(h.lastEditor().options.language).toBeNull();
    expect(__notices.some((n) => n.includes("plain text"))).toBe(true);
    expect(h.log.recent().some((l) => l.includes("ERROR [editor]") && l.includes("bad grammar"))).toBe(true);
  });

  it("a deleted file empties the pane, says so, and is not written back", async () => {
    const h = harness();
    h.transport.files.set("a.txt", utf8("a"));
    const file = new TFile("a.txt");
    await h.view.__load(file);
    await h.view.setMode("edit");
    h.lastEditor().type("ab");
    h.vault.trigger("delete", file);
    await tick();
    expect(__textOf(h.body())).toContain("was deleted");
    h.timers.fireAll();
    await tick();
    expect(h.transport.writes).toHaveLength(0);
  });

  it("accepts only registered extensions", () => {
    const h = harness();
    expect(h.view.canAcceptExtension("txt")).toBe(true);
    expect(h.view.canAcceptExtension("LOG")).toBe(true);
    expect(h.view.canAcceptExtension("docx")).toBe(false);
  });
});

describe("TextView and Run (ADR-004)", () => {
  function runDeps(enabled = true) {
    const requests: ExecuteRequest[] = [];
    const resolvers: Array<(r: ExecuteResult) => void> = [];
    const deps: RunViewDeps = {
      enabled: () => enabled,
      runnersFor: (ext) => (ext === "py" ? [{ language: "Python", name: "Python", argv: ["python", "{file}"] }] : []),
      locate: (path) => ({ file: `/vault/${path}`, dir: "/vault", stem: path.replace(/\.py$/, "") }),
      execute: (req) => {
        requests.push(req);
        return { stop: () => undefined, done: new Promise<ExecuteResult>((r) => resolvers.push(r)) };
      },
      timeoutMs: () => 30000,
      outputCapBytes: () => 1024,
    };
    return { deps, requests, resolvers };
  }

  it("without run deps, or with Run disabled, or for a file with no runner, there is no Run button and runFile does nothing", async () => {
    for (const h of [harness(), harness({}, runDeps(false).deps)]) {
      h.transport.files.set("a.py", utf8("print(1)"));
      await h.view.__load(new TFile("a.py"));
      expect(__findByClass(h.head(), "nfe-run-head-button")).toBeNull();
      expect(h.view.nfeRunAvailable()).toBe(false);
      await h.view.runFile();
      expect(h.view.runPanelOpen).toBe(false);
    }
    const h = harness({}, runDeps().deps);
    h.transport.files.set("a.txt", utf8("x"));
    await h.view.__load(new TFile("a.txt"));
    expect(__findByClass(h.head(), "nfe-run-head-button")).toBeNull();
  });

  it("Run flushes unsaved typing, opens the panel under the editor, runs with the file's location and text, and remembers the panel", async () => {
    const r = runDeps();
    const h = harness({}, r.deps);
    h.transport.files.set("a.py", utf8("print(1)"));
    await h.view.__load(new TFile("a.py"));
    expect(__findByClass(h.head(), "nfe-run-head-button").textContent).toBe("Run");
    await h.view.setMode("edit");
    h.lastEditor().type("print(2)");
    __fire(__findByClass(h.head(), "nfe-run-head-button"), "click");
    await tick();
    // The write happened before the run started.
    expect(h.transport.writes.map((w) => new TextDecoder().decode(w.bytes))).toEqual(["print(2)"]);
    expect(r.requests).toHaveLength(1);
    expect(r.requests[0]).toMatchObject({ file: "/vault/a.py", dir: "/vault", stem: "a", text: "print(2)", timeoutMs: 30000, outputCapBytes: 1024 });
    expect(r.requests[0]?.def.name).toBe("Python");
    const body = h.body();
    expect(body.children.map((c: { className: string }) => c.className.split(" ")[0])).toEqual(["nfe-editor", "nfe-run-panel"]);
    expect(h.view.running).toBe(true);
    expect(h.device.get().runPanelOpen).toEqual({ "a.py": true });
    r.requests[0]?.onOutput({ kind: "stdout", text: "2\n" });
    // A mode switch keeps the panel and its output, below the new editor.
    await h.view.setMode("preview");
    const after = h.body();
    expect(after.children.map((c: { className: string }) => c.className.split(" ")[0])).toEqual(["nfe-editor", "nfe-run-panel"]);
    expect(__textOf(__findByClass(after, "nfe-run-output"))).toBe("2\n");
    r.resolvers[0]?.({ exitCode: 0, timedOut: false, stopped: false, truncated: false, ms: 10, error: null, step: 1, steps: 1 });
    await tick();
    expect(h.view.running).toBe(false);
    // Close forgets the panel; reopening the file with the panel remembered opens it without running.
    h.view.toggleRunPanel();
    expect(h.view.runPanelOpen).toBe(false);
    expect(h.device.get().runPanelOpen).toEqual({});
    h.view.toggleRunPanel();
    expect(h.view.runPanelOpen).toBe(true);
    await h.view.__unload();
    expect(h.device.get().runPanelOpen).toEqual({ "a.py": true });
    await h.view.__load(new TFile("a.py"));
    expect(h.view.runPanelOpen).toBe(true);
    expect(r.requests).toHaveLength(1);
  });

  it("the Run file command is refused while running is impossible, and Stop only while running", async () => {
    const r = runDeps();
    const h = harness({}, r.deps);
    h.transport.files.set("a.py", utf8("print(1)"));
    await h.view.__load(new TFile("a.py"));
    expect(h.view.running).toBe(false);
    void h.view.runFile();
    await tick();
    expect(h.view.running).toBe(true);
    h.view.stopRun();
    // The fake handle's stop does nothing; the view only forwards it.
    r.resolvers[0]?.({ exitCode: null, timedOut: false, stopped: true, truncated: false, ms: 10, error: null, step: 1, steps: 1 });
    await tick();
    expect(h.view.running).toBe(false);
  });
});


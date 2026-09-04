/**
 * Runtime stand-in for the "obsidian" module, used ONLY by vitest through the
 * resolve.alias in vitest.config.ts. The real package is types-only; tsc still
 * typechecks src/ against the real typings and this file never reaches main.js.
 *
 * The element stand-in remembers its TREE (tag, classes, text, children) and
 * its listeners, so a test can say "the Edit button is inside the head bar"
 * and tap it. It is still not a DOM: no layout, no styles, no bubbling, and
 * `querySelector`/`closest` understand class selectors only. Do not write a
 * fancier selector in src/ and assume a test covers it; filter in TypeScript
 * or extend this file deliberately.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

// Obsidian installs `activeWindow` and `activeDocument` as globals so pop-out
// windows work; the plugin reads its timers from the first.
const g = globalThis as Any;
if (g.activeWindow === undefined) g.activeWindow = globalThis;

export const __notices: string[] = [];
export const __openedModals: string[] = [];
export const __modalTitles: string[] = [];
/** Modals opened, so a test can drive onOpen() and tap their buttons. */
export const __modalInstances: Any[] = [];

export function __resetObsidianMock(): void {
  __notices.length = 0;
  __openedModals.length = 0;
  __modalTitles.length = 0;
  __modalInstances.length = 0;
  __setPlatformDesktop(true);
}

function fakeEl(tag = "div", cls = "", text = ""): Any {
  const el: Any = {
    tagName: tag.toUpperCase(),
    className: cls,
    style: { setProperty: () => undefined, removeProperty: () => undefined },
    focus: () => undefined,
    disabled: false,
    hidden: false,
    children: [] as Any[],
    parent: null as Any,
    textContent: text,
    attrs: {} as Record<string, string>,
    listeners: new Map<string, Array<(e: Any) => void>>(),
    addClass: (...c: string[]) => {
      el.className = [...el.className.split(/\s+/), ...c].filter(Boolean).join(" ");
      return el;
    },
    removeClass: (...c: string[]) => {
      el.className = el.className.split(/\s+/).filter((x: string) => x && !c.includes(x)).join(" ");
      return el;
    },
    toggleClass: (c: string, on: boolean) => (on ? el.addClass(c) : el.removeClass(c)),
    hasClass: (c: string) => el.className.split(/\s+/).includes(c),
    closest: (sel: string) => {
      const cls = sel.trim().replace(/^\./, "");
      for (let n: Any = el; n; n = n.parent) if (n.hasClass?.(cls)) return n;
      return null;
    },
    setText: (t: unknown) => {
      el.textContent = String(t ?? "");
      return el;
    },
    appendText: (t: unknown) => {
      adopt(el, fakeEl("#text", "", String(t ?? "")));
      return el;
    },
    setAttr: (k: string, v: unknown) => {
      el.attrs[k] = String(v);
      return el;
    },
    setAttribute: (k: string, v: unknown) => {
      el.attrs[k] = String(v);
      return el;
    },
    getAttribute: (k: string) => el.attrs[k] ?? null,
    empty: () => {
      for (const c of el.children) c.parent = null;
      el.children.length = 0;
      el.textContent = "";
      return el;
    },
    createEl: (t: string, o?: Any) => adopt(el, fakeEl(t, o?.cls ?? "", o?.text ?? "")),
    createDiv: (o?: Any) => adopt(el, fakeEl("div", o?.cls ?? "", o?.text ?? "")),
    createSpan: (o?: Any) => adopt(el, fakeEl("span", o?.cls ?? "", o?.text ?? "")),
    appendChild: (child: Any) => adopt(el, child),
    addEventListener: (type: string, fn: (e: Any) => void) => {
      const cur = el.listeners.get(type) ?? [];
      cur.push(fn);
      el.listeners.set(type, cur);
    },
    removeEventListener: () => undefined,
    getBoundingClientRect: () => ({ top: 0, right: 0, bottom: 0, left: 0, width: 0, height: 0 }),
    remove: () => {
      const sibs = el.parent?.children;
      if (sibs) sibs.splice(sibs.indexOf(el), 1);
    },
    querySelectorAll: (sel: string) => {
      const classes = sel.split(",").map((x) => x.trim().replace(/^\./, ""));
      return classes.flatMap((c) => __findAllByClass(el, c));
    },
    querySelector: (sel: string) => {
      const hits = el.querySelectorAll(sel);
      return hits.length > 0 ? hits[0] : null;
    },
  };
  return el;
}

function adopt(parent: Any, child: Any): Any {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

/** Dispatch a recorded listener. Returns false when nothing was listening. */
export function __fire(el: Any, type: string, event: Any = {}): boolean {
  const fns = el?.listeners?.get(type);
  if (!fns || fns.length === 0) return false;
  const e = { stopPropagation: () => undefined, preventDefault: () => undefined, ...event };
  for (const fn of fns) fn(e);
  return true;
}

export function __findByClass(root: Any, cls: string): Any {
  for (const c of root.children ?? []) {
    if (c.hasClass?.(cls)) return c;
    const hit = __findByClass(c, cls);
    if (hit) return hit;
  }
  return null;
}

export function __findAllByClass(root: Any, cls: string): Any[] {
  const out: Any[] = [];
  for (const c of root.children ?? []) {
    if (c.hasClass?.(cls)) out.push(c);
    out.push(...__findAllByClass(c, cls));
  }
  return out;
}

export function __textOf(root: Any): string {
  const parts = [root.textContent ?? ""];
  for (const c of root.children ?? []) parts.push(__textOf(c));
  return parts.filter(Boolean).join(" ");
}

export { fakeEl as __fakeEl };

export class Notice {
  constructor(message?: unknown) {
    __notices.push(String(message ?? ""));
  }
  hide(): void {}
}

export const Platform = {
  isDesktopApp: true,
  isMobileApp: false,
  isDesktop: true,
  isMobile: false,
  isPhone: false,
  isTablet: false,
  isAndroidApp: false,
  isIosApp: false,
};

export function __setPlatformDesktop(desktop: boolean): void {
  Platform.isDesktopApp = desktop;
  Platform.isDesktop = desktop;
  Platform.isMobileApp = !desktop;
  Platform.isMobile = !desktop;
  Platform.isPhone = !desktop;
  Platform.isAndroidApp = !desktop;
}

/** A file record the way FileView code reads it. */
export class TFile {
  path: string;
  name: string;
  basename: string;
  extension: string;
  constructor(path = "") {
    this.path = path;
    this.name = path.split("/").pop() ?? "";
    const dot = this.name.lastIndexOf(".");
    this.basename = dot > 0 ? this.name.slice(0, dot) : this.name;
    this.extension = dot > 0 ? this.name.slice(dot + 1) : "";
  }
}
export class TFolder {
  path: string;
  constructor(path = "") {
    this.path = path;
  }
}

/** Event hub the way `vault.on` returns refs and `trigger` fires them. */
export class Events {
  private handlers = new Map<string, Array<(...args: Any[]) => void>>();
  on(name: string, fn: (...args: Any[]) => void): { name: string; fn: (...args: Any[]) => void } {
    const list = this.handlers.get(name) ?? [];
    list.push(fn);
    this.handlers.set(name, list);
    return { name, fn };
  }
  trigger(name: string, ...args: Any[]): void {
    for (const fn of this.handlers.get(name) ?? []) fn(...args);
  }
}

export class FileSystemAdapter {
  private basePath: string;
  constructor(basePath = "/vault") {
    this.basePath = basePath;
  }
  getBasePath(): string {
    return this.basePath;
  }
}

/** Menu items are recorded so a test can read titles and click them. */
export class Menu {
  items: Array<{ title: string; icon: string; click: () => void }> = [];
  addItem(cb: (item: Any) => void): Menu {
    const rec: { title: string; icon: string; click: () => void } = { title: "", icon: "", click: () => undefined };
    const item: Any = {
      setTitle: (t: string) => ((rec.title = t), item),
      setIcon: (i: string) => ((rec.icon = i), item),
      onClick: (fn: () => void) => ((rec.click = fn), item),
    };
    cb(item);
    this.items.push(rec);
    return this;
  }
  addSeparator(): Menu {
    return this;
  }
  showAtMouseEvent(): void {}
  showAtPosition(): void {}
}

export function setIcon(): void {}
export function addIcon(): void {}
export function normalizePath(p: string): string {
  return p;
}

export class Component {
  load(): void {}
  unload(): void {}
}

export class Modal {
  app: Any;
  contentEl = fakeEl();
  titleEl = fakeEl();
  modalEl = fakeEl();
  constructor(app: Any) {
    this.app = app;
  }
  open(): void {
    __openedModals.push(this.constructor.name);
    const t = (this as unknown as { title?: unknown }).title;
    if (typeof t === "string") __modalTitles.push(t);
    __modalInstances.push(this);
    // onOpen() is not called: a test that wants the DOM calls it itself.
  }
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class ItemView {
  leaf: Any;
  app: Any;
  containerEl = fakeEl("div", "view-container");
  contentEl: Any;
  navigation = false;
  constructor(leaf: Any) {
    this.leaf = leaf;
    this.app = leaf?.app;
    this.contentEl = adopt(this.containerEl, fakeEl("div", "view-content"));
  }
  registerInterval(id: number): number {
    return id;
  }
  register(): void {}
  registerEvent(): void {}
  registerDomEvent(): void {}
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
  }
  onOpen(): Promise<void> {
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    return Promise.resolve();
  }
  setState(): Promise<void> {
    return Promise.resolve();
  }
  /** Header actions are remembered so a test can tap them. */
  actions: Array<{ icon: string; title: string; el: Any }> = [];
  addAction(icon: string, title: string, cb: () => void): Any {
    const el = fakeEl("a", "clickable-icon view-action");
    el.addEventListener("click", cb);
    this.actions.push({ icon, title, el });
    return el;
  }
}

/**
 * FileView the way Obsidian drives it: `file` is set, then onLoadFile; on a
 * swap, onUnloadFile for the old file first. `__load`/`__unload` are the test's
 * hands on that sequence.
 */
export class FileView extends ItemView {
  file: TFile | null = null;
  allowNoFile = false;
  onLoadFile(_file: TFile): Promise<void> {
    return Promise.resolve();
  }
  onUnloadFile(_file: TFile): Promise<void> {
    return Promise.resolve();
  }
  onRename(_file: TFile): Promise<void> {
    return Promise.resolve();
  }
  canAcceptExtension(_ext: string): boolean {
    return true;
  }
  async __load(file: TFile): Promise<void> {
    if (this.file) await this.onUnloadFile(this.file);
    this.file = file;
    await this.onLoadFile(file);
  }
  async __unload(): Promise<void> {
    if (this.file) {
      await this.onUnloadFile(this.file);
      this.file = null;
    }
  }
}

export class PluginSettingTab {
  app: Any;
  plugin: Any;
  containerEl = fakeEl();
  constructor(app: Any, plugin: Any) {
    this.app = app;
    this.plugin = plugin;
  }
  getSettingDefinitions(): Any[] {
    return [];
  }
  getControlValue(_key: string): unknown {
    return undefined;
  }
  setControlValue(_key: string, _value: unknown): void | Promise<void> {}
  update(): void {}
  display(): void {}
  hide(): void {}
}

export interface Command {
  id: string;
  name: string;
  callback?: () => void;
  checkCallback?: (checking: boolean) => boolean | void;
}

export class Plugin {
  app: Any;
  manifest: Any;
  commands: Command[] = [];
  registeredViews = new Map<string, (leaf: Any) => Any>();
  registeredExtensions: Array<{ extensions: string[]; viewType: string }> = [];
  settingTabs: Any[] = [];
  private __data: unknown = null;
  constructor(app: Any, manifest: Any) {
    this.app = app;
    this.manifest = manifest;
  }
  __setData(d: unknown): void {
    this.__data = d;
  }
  async loadData(): Promise<unknown> {
    return this.__data;
  }
  async saveData(d: unknown): Promise<void> {
    this.__data = d;
  }
  addCommand(cmd: Command): Command {
    this.commands.push(cmd);
    return cmd;
  }
  addRibbonIcon(): Any {
    return fakeEl();
  }
  addSettingTab(tab: Any): void {
    this.settingTabs.push(tab);
  }
  registerView(type: string, creator: (leaf: Any) => Any): void {
    this.registeredViews.set(type, creator);
  }
  registerExtensions(extensions: string[], viewType: string): void {
    this.registeredExtensions.push({ extensions, viewType });
  }
  registerEvent(): void {}
  registerDomEvent(): void {}
  registerInterval(id: number): number {
    return id;
  }
  onload(): void | Promise<void> {}
  onunload(): void {}
}

export class WorkspaceLeaf {}
export class App {}

/**
 * The members only the mock has, as types. tsc checks the tests against the
 * REAL obsidian typings (the alias is vitest-only), so a test reaches them
 * through `mockView(view)` / `mockPlugin(plugin)` rather than by pretending
 * they exist on the production class.
 */
export interface MockFileViewMembers {
  __load(file: TFile): Promise<void>;
  __unload(): Promise<void>;
  actions: Array<{ icon: string; title: string; el: Any }>;
  contentEl: Any;
}
export interface MockPluginMembers {
  __setData(d: unknown): void;
  commands: Command[];
  registeredViews: Map<string, (leaf: Any) => Any>;
  registeredExtensions: Array<{ extensions: string[]; viewType: string }>;
  settingTabs: Any[];
}
export function mockView<T>(v: T): T & MockFileViewMembers {
  return v as T & MockFileViewMembers;
}
export function mockPlugin<T>(p: T): T & MockPluginMembers {
  return p as T & MockPluginMembers;
}

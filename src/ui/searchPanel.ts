import { SearchQuery, closeSearchPanel, findNext, findPrevious, getSearchQuery, replaceAll, replaceNext, selectMatches, setSearchQuery } from "@codemirror/search";
import type { EditorView, Panel, ViewUpdate } from "@codemirror/view";
import { Platform, setIcon } from "obsidian";

/**
 * The plugin's own search panel for CodeMirror's `search` extension, in place
 * of the default one: CodeMirror's panel is styled by its base theme (light
 * gradients, fixed colours) and was unreadable in a dark Obsidian theme
 * (2026-09-07). This one is built with Obsidian's classes and variables,
 * names the shortcut on every button (a tooltip always; the text too while
 * the setting is on), and offers the three query switches as icon toggles.
 * The query itself is CodeMirror's: `getSearchQuery`/`setSearchQuery`, so
 * F3, Shift+F3, Mod+G and the highlighted matches all keep working.
 */

export interface SearchPanelDeps {
  /** Whether the buttons spell out their shortcut ("Next (F3)"). */
  readonly hints: () => boolean;
  /** A read-only view has no replace row. */
  readonly readOnly: boolean;
}

const MOD = Platform.isMacOS ? "Cmd" : "Ctrl";

interface ButtonSpec {
  readonly label: string;
  readonly shortcut: string;
  readonly run: (view: EditorView) => boolean;
}

const NEXT: ButtonSpec = { label: "Next", shortcut: "F3", run: findNext };
const PREVIOUS: ButtonSpec = { label: "Previous", shortcut: "Shift+F3", run: findPrevious };
const ALL: ButtonSpec = { label: "Select all", shortcut: "Alt+Enter", run: selectMatches };
const REPLACE: ButtonSpec = { label: "Replace", shortcut: "Enter", run: replaceNext };
const REPLACE_ALL: ButtonSpec = { label: "Replace all", shortcut: `${MOD}+Alt+Enter`, run: replaceAll };

export function createSearchPanel(view: EditorView, deps: SearchPanelDeps): Panel {
  const dom = view.dom.ownerDocument.createElement("div");
  dom.className = "nfe-search";
  const el = <K extends keyof HTMLElementTagNameMap>(parent: HTMLElement, tag: K, cls: string): HTMLElementTagNameMap[K] => {
    const node = dom.ownerDocument.createElement(tag);
    node.className = cls;
    parent.appendChild(node);
    return node;
  };

  const rows = { find: el(dom, "div", "nfe-search-row"), replace: deps.readOnly ? null : el(dom, "div", "nfe-search-row") };

  const findInput = el(rows.find, "input", "nfe-search-field");
  findInput.type = "text";
  findInput.placeholder = "Find";
  findInput.setAttribute("main-field", "true");
  findInput.setAttribute("aria-label", "Find");

  const buttons: Array<{ el: HTMLButtonElement; spec: ButtonSpec }> = [];
  const button = (parent: HTMLElement, spec: ButtonSpec): HTMLButtonElement => {
    const b = el(parent, "button", "nfe-search-button");
    b.type = "button";
    b.setAttribute("data-tooltip-position", "top");
    b.addEventListener("click", () => {
      spec.run(view);
      view.focus();
      findInput.focus();
    });
    buttons.push({ el: b, spec });
    return b;
  };
  button(rows.find, NEXT);
  button(rows.find, PREVIOUS);
  button(rows.find, ALL);

  const toggles: Array<{ el: HTMLButtonElement; key: "caseSensitive" | "regexp" | "wholeWord" }> = [];
  const toggle = (icon: string, label: string, key: "caseSensitive" | "regexp" | "wholeWord"): void => {
    const b = el(rows.find, "button", "clickable-icon nfe-search-toggle");
    b.type = "button";
    setIcon(b, icon);
    b.setAttribute("aria-label", label);
    b.setAttribute("data-tooltip-position", "top");
    b.addEventListener("click", () => {
      const q = getSearchQuery(view.state);
      commit({ ...queryFields(q), [key]: !q[key] });
      findInput.focus();
    });
    toggles.push({ el: b, key });
  };
  toggle("case-sensitive", "Match case", "caseSensitive");
  toggle("regex", "Regular expression", "regexp");
  toggle("whole-word", "Whole word", "wholeWord");

  const close = el(rows.find, "button", "clickable-icon nfe-search-close");
  close.type = "button";
  setIcon(close, "x");
  close.setAttribute("aria-label", "Close (Escape)");
  close.setAttribute("data-tooltip-position", "top");
  close.addEventListener("click", () => {
    closeSearchPanel(view);
    view.focus();
  });

  let replaceInput: HTMLInputElement | null = null;
  if (rows.replace) {
    replaceInput = el(rows.replace, "input", "nfe-search-field");
    replaceInput.type = "text";
    replaceInput.placeholder = "Replace";
    replaceInput.setAttribute("aria-label", "Replace");
    button(rows.replace, REPLACE);
    button(rows.replace, REPLACE_ALL);
  }

  function queryFields(q: SearchQuery): { search: string; replace: string; caseSensitive: boolean; regexp: boolean; wholeWord: boolean } {
    return { search: q.search, replace: q.replace, caseSensitive: q.caseSensitive, regexp: q.regexp, wholeWord: q.wholeWord };
  }

  function commit(fields: ReturnType<typeof queryFields>): void {
    const query = new SearchQuery(fields);
    if (!query.eq(getSearchQuery(view.state))) view.dispatch({ effects: setSearchQuery.of(query) });
  }

  function fromInputs(): void {
    const q = getSearchQuery(view.state);
    commit({ ...queryFields(q), search: findInput.value, replace: replaceInput?.value ?? q.replace });
  }

  function syncFromState(): void {
    const q = getSearchQuery(view.state);
    if (findInput.value !== q.search) findInput.value = q.search;
    if (replaceInput && replaceInput.value !== q.replace) replaceInput.value = q.replace;
    for (const t of toggles) t.el.classList.toggle("is-active", q[t.key]);
    const hints = deps.hints();
    for (const { el: b, spec } of buttons) {
      b.textContent = hints ? `${spec.label} (${spec.shortcut})` : spec.label;
      b.setAttribute("aria-label", `${spec.label} (${spec.shortcut})`);
    }
  }

  findInput.addEventListener("input", fromInputs);
  replaceInput?.addEventListener("input", fromInputs);
  const keys = (input: HTMLInputElement, onEnter: (evt: KeyboardEvent) => boolean) => {
    input.addEventListener("keydown", (evt) => {
      if (evt.key === "Escape") {
        evt.preventDefault();
        closeSearchPanel(view);
        view.focus();
      } else if (evt.key === "Enter") {
        evt.preventDefault();
        onEnter(evt);
      }
    });
  };
  keys(findInput, (evt) => (evt.altKey ? selectMatches(view) : evt.shiftKey ? findPrevious(view) : findNext(view)));
  if (replaceInput) keys(replaceInput, (evt) => ((evt.ctrlKey || evt.metaKey) && evt.altKey ? replaceAll(view) : replaceNext(view)));

  return {
    dom,
    top: true,
    mount() {
      syncFromState();
      findInput.focus();
      findInput.select();
    },
    update(update: ViewUpdate) {
      // The query is state: F3 from the editor, Mod+F with a selection, or a
      // palette command may change it without touching these inputs.
      if (update.transactions.some((tr) => tr.effects.some((e) => e.is(setSearchQuery)))) syncFromState();
    },
  };
}

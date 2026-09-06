import {
  CHROME_KEYS,
  type ChromeSettings,
  type Palette,
  type PaletteRule,
  TAG_EQUIVALENTS,
  type ThemeVariant,
  chromeRules,
  knownTagNames,
  selectorsForTagName,
} from "./model";

/**
 * A CodeMirror 6 theme, as published on codemirror.net/docs/community, read
 * as DATA. Those themes are JavaScript modules (`@codemirror/theme-one-dark`,
 * `thememirror`, `@uiw/codemirror-theme-*`, and hand-written ones), and the
 * plugin never executes code from the vault. What every one of them has in
 * common is the shape of the literals inside: `{ tag: t.keyword, color:
 * "#c678dd" }` rules for `HighlightStyle.define` or `createTheme({ styles })`,
 * a `settings: { background, foreground, caret, ... }` object, and
 * `EditorView.theme({ "&": {...}, ".cm-gutters": {...} })` blocks, with colours
 * as string literals or as constants defined a few lines up. This module finds
 * those literals with a string-aware bracket scanner and turns them into
 * palette rules; anything computed (a template string, a function call, a
 * colour library) is skipped and named in the notes.
 *
 * A file that defines several themes contributes all of them when each can
 * be told light from dark (a `createTheme({ theme: 'dark', settings, styles })`
 * call, or `variant: 'light'`): the light one is then emitted under Obsidian's
 * `theme-light` body class and the dark one under `theme-dark`, so the file
 * follows the app's theme. When the variants cannot be told apart, the LAST
 * group of rules and the last settings object win, and the notes say so.
 */

/** Blank comments and keep everything else in place, so offsets stay valid. Strings are left alone. */
export function stripComments(src: string): string {
  let out = "";
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? "";
    const n = src[i + 1] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      const end = skipString(src, i);
      out += src.slice(i, end);
      i = end;
    } else if (c === "/" && n === "/") {
      const end = src.indexOf("\n", i);
      const stop = end === -1 ? src.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (c === "/" && n === "*") {
      const end = src.indexOf("*/", i + 2);
      const stop = end === -1 ? src.length : end + 2;
      out += src.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Index just past the string literal that starts at `start`. */
function skipString(src: string, start: number): number {
  const quote = src[start];
  let i = start + 1;
  while (i < src.length) {
    const c = src[i];
    if (c === "\\") i += 2;
    else if (c === quote) return i + 1;
    else if (c === "\n" && quote !== "`") return i;
    else i++;
  }
  return src.length;
}

interface Span {
  readonly open: "{" | "[";
  readonly start: number;
  readonly end: number;
  readonly parent: number;
}

/** Every `{...}` and `[...]` in the text, with its parent, in order of opening. */
export function bracketSpans(src: string): Span[] {
  const spans: Array<{ open: "{" | "["; start: number; end: number; parent: number }> = [];
  const stack: number[] = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(src, i);
      continue;
    }
    if (c === "{" || c === "[") {
      spans.push({ open: c, start: i, end: -1, parent: stack.length > 0 ? (stack[stack.length - 1] ?? -1) : -1 });
      stack.push(spans.length - 1);
    } else if (c === "}" || c === "]") {
      const top = stack.pop();
      if (top !== undefined) {
        const s = spans[top];
        if (s) s.end = i + 1;
      }
    }
    i++;
  }
  return spans.filter((s) => s.end !== -1);
}

/** Split on commas at depth 0, respecting brackets and strings. */
export function splitTopLevel(text: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let last = 0;
  let i = 0;
  while (i < text.length) {
    const c = text[i] ?? "";
    if (c === '"' || c === "'" || c === "`") {
      i = skipString(text, i);
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (c === "," && depth === 0) {
      out.push(text.slice(last, i));
      last = i + 1;
    }
    i++;
  }
  out.push(text.slice(last));
  return out.map((s) => s.trim()).filter((s) => s.length > 0);
}

interface Entry {
  readonly key: string;
  /** The raw value text, trimmed. */
  readonly value: string;
}

/** `key: value` pairs of an object literal's body (the text between its braces). */
export function objectEntries(body: string): Entry[] {
  const out: Entry[] = [];
  for (const part of splitTopLevel(body)) {
    const m = part.match(/^(?:"([^"]*)"|'([^']*)'|([A-Za-z_$][\w$]*))\s*:\s*([\s\S]+)$/);
    if (!m) continue;
    out.push({ key: m[1] ?? m[2] ?? m[3] ?? "", value: (m[4] ?? "").trim() });
  }
  return out;
}

/** `const x = "#fff"`, `x = '#fff'` (minified), `x: string = "#fff"` (TypeScript): name -> literal. */
export function stringConstants(src: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of src.matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)\s*(?::\s*[\w.<>|[\]\s]+?)?=\s*(["'])((?:(?!\2)[^\\\n]|\\.)*)\2/g)) {
    const name = m[1] ?? "";
    if (!out.has(name)) out.set(name, m[3] ?? "");
  }
  return out;
}

const PROPERTY_ALLOWED = /^(color|background(-color)?|font-(style|weight|family|variant)|text-decoration(-[a-z]+)?|opacity|border(-[a-z-]+)?|outline(-[a-z]+)?|caret-color|box-shadow|text-shadow)$/;
const VALUE_FORBIDDEN = /[;{}@\\<>]|url\(|expression\(|!important/i;

export function kebab(camel: string): string {
  return camel.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
}

/** A CSS value from a JS value expression: a string literal, a known constant or a number. Null when computed. */
function cssValue(expr: string, constants: ReadonlyMap<string, string>): string | null {
  const lit = expr.match(/^(["'])((?:(?!\1)[^\\\n]|\\.)*)\1$/);
  let value: string | null = null;
  if (lit) value = lit[2] ?? "";
  else if (/^[A-Za-z_$][\w$]*$/.test(expr)) value = constants.get(expr) ?? null;
  else if (/^-?\d+(\.\d+)?$/.test(expr)) value = expr;
  if (value === null || value.length === 0 || value.length > 200 || VALUE_FORBIDDEN.test(value)) return null;
  return value;
}

/** Declarations from an object's entries; `tag` and nested objects are not declarations. */
function declarationsOf(entries: readonly Entry[], constants: ReadonlyMap<string, string>, notes: string[], where: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of entries) {
    if (e.key === "tag" || e.key === "class") continue;
    const prop = kebab(e.key);
    if (!PROPERTY_ALLOWED.test(prop)) continue;
    const v = cssValue(e.value, constants);
    if (v === null) {
      notes.push(`${where}: ${e.key} is computed (${e.value.slice(0, 40)}); skipped`);
      continue;
    }
    out[prop] = v;
  }
  return out;
}

/** `[tags.a, t.function(t.variableName)]` or `t.keyword` to bare tag names: `a`, `function(variableName)`. */
export function tagNamesOf(expr: string): string[] {
  const inner = expr.trim().replace(/^\[([\s\S]*)\]$/, "$1");
  return splitTopLevel(inner)
    .map((item) => item.replace(/\b[A-Za-z_$][\w$]*\.(?=[A-Za-z_$])/g, "").replace(/\s+/g, ""))
    .filter((name) => /^[A-Za-z]+(\([A-Za-z()]+\))?$/.test(name));
}

/**
 * The token-table tag names a theme's tag stands for. A tag the table knows is
 * itself. `modifier(inner)` resolves `inner` and re-applies the modifier where
 * the table has that row, falling back to the inner tag when the theme has no
 * rule of its own for it. A parent or sibling tag expands through
 * TAG_EQUIVALENTS, again skipping anything the theme styles explicitly.
 */
export function resolveTagName(name: string, explicit: ReadonlySet<string>, known: ReadonlySet<string>): string[] {
  if (known.has(name)) return [name];
  const mod = name.match(/^([A-Za-z]+)\((.+)\)$/);
  if (mod) {
    const out: string[] = [];
    for (const inner of resolveTagName(mod[2] ?? "", explicit, known)) {
      const applied = `${mod[1]}(${inner})`;
      if (known.has(applied)) out.push(applied);
      else if (!explicit.has(inner)) out.push(inner);
    }
    return out;
  }
  const eq = TAG_EQUIVALENTS[name];
  if (eq) return eq.filter((e) => known.has(e) && !explicit.has(e));
  return [];
}

interface TagRule {
  readonly tags: string[];
  readonly declarations: Record<string, string>;
  readonly group: number;
}

interface SettingsObject {
  readonly entries: Entry[];
  readonly start: number;
}

const SELECTOR_ALLOWED = /^[&.\w\s>:*+~\-[\]="']+$/;

/**
 * `'dark'`, `"light"`, `dark: true`, a ternary that mentions one of them, or
 * an identifier whose assignment (`theme = x === void 0 ? 'light' : x`, the
 * shape Babel gives a default parameter) does: the variant a theme call
 * declares, if any. `lookup` returns the expression last assigned to a name.
 */
export function variantOf(entries: readonly Entry[], lookup: (name: string) => string | null = () => null): ThemeVariant | null {
  const fromText = (text: string): ThemeVariant | null => {
    const dark = /['"]dark['"]/.test(text);
    const light = /['"]light['"]/.test(text);
    if (dark && !light) return "dark";
    if (light && !dark) return "light";
    return null;
  };
  for (const e of entries) {
    if (e.key === "dark") return /^true$/.test(e.value) ? "dark" : /^false$/.test(e.value) ? "light" : null;
    if (e.key === "theme" || e.key === "variant") {
      const direct = fromText(e.value);
      if (direct) return direct;
      if (/^[A-Za-z_$][\w$]*$/.test(e.value)) {
        const assigned = lookup(e.value);
        if (assigned !== null) return fromText(assigned);
      }
    }
  }
  return null;
}

/** The expression last assigned to `name` before `before` (`name = <expr>` up to a comma or semicolon), or null. */
export function lastAssignmentBefore(src: string, name: string, before: number): string | null {
  const re = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}\\s*=(?!=)\\s*([^,;\\n]+)`, "g");
  let found: string | null = null;
  for (const m of src.matchAll(re)) {
    if (m.index >= before) break;
    found = m[1] ?? null;
  }
  return found;
}

/** Identifiers in a value expression (`[...a, ...b]`, `_extends({}, a, b)`), minus the ones that are clearly not names of arrays or objects. */
function identifiersIn(expr: string): string[] {
  // A spread (`...name`) is a name too; `.` otherwise marks a property access, which is not.
  return [...expr.replace(/\.\.\./g, " ").matchAll(/(?<![\w$.])([A-Za-z_$][\w$]*)(?![\w$]*\s*[:(])/g)].map((m) => m[1] ?? "").filter((n) => n.length > 0 && n !== "void");
}

export function parseCodeMirrorTheme(source: string): Palette {
  const notes: string[] = [];
  const src = stripComments(source);
  const constants = stringConstants(src);
  const spans = bracketSpans(src);
  const known = new Set(knownTagNames());

  const tagRules: TagRule[] = [];
  const settingsObjects: SettingsObject[] = [];
  const themeRules: PaletteRule[] = [];
  /** `createTheme({...})`-shaped objects: what they say about variant, styles and settings. */
  const themeCalls: Array<{ variant: ThemeVariant | null; stylesValue: string; settingsValue: string; start: number; bodyStart: number }> = [];
  const spanAt = (start: number, open: "{" | "["): number => spans.findIndex((sp) => sp.start === start && sp.open === open);

  for (let idx = 0; idx < spans.length; idx++) {
    const span = spans[idx];
    if (!span || span.open !== "{") continue;
    const body = src.slice(span.start + 1, span.end - 1);
    const entries = objectEntries(body);
    if (entries.length === 0) continue;
    const keys = entries.map((e) => e.key);

    if (keys.includes("tag")) {
      const tagEntry = entries.find((e) => e.key === "tag");
      const tags = tagNamesOf(tagEntry?.value ?? "");
      if (tags.length === 0) {
        notes.push(`a rule's tag expression was not understood: ${(tagEntry?.value ?? "").slice(0, 60)}`);
        continue;
      }
      tagRules.push({ tags, declarations: declarationsOf(entries, constants, notes, tags.join("/")), group: span.parent });
      continue;
    }

    const chromeKeyCount = keys.filter((k) => (CHROME_KEYS as readonly string[]).includes(k)).length;
    if (chromeKeyCount >= 2 && chromeKeyCount === keys.length) {
      settingsObjects.push({ entries, start: span.start });
      continue;
    }

    if (keys.includes("styles")) {
      themeCalls.push({
        variant: variantOf(entries, (name) => lastAssignmentBefore(src, name, span.start)),
        stylesValue: entries.find((e) => e.key === "styles")?.value ?? "",
        settingsValue: entries.find((e) => e.key === "settings")?.value ?? "",
        start: span.start,
        bodyStart: span.start + 1,
      });
      continue;
    }

    if (keys.every((k) => k.startsWith("&") || k.startsWith("."))) {
      for (const e of entries) {
        const inner = e.value.match(/^\{([\s\S]*)\}$/);
        if (!inner) continue;
        const innerEntries = objectEntries(inner[1] ?? "");
        for (const ie of innerEntries) {
          if (/^\{/.test(ie.value)) notes.push(`${e.key}: nested "${ie.key}" skipped`);
        }
        const declarations = declarationsOf(innerEntries, constants, notes, e.key);
        if (Object.keys(declarations).length === 0) continue;
        const selectors: string[] = [];
        for (const raw of e.key.split(",")) {
          const sel = raw.trim();
          if (!SELECTOR_ALLOWED.test(sel)) {
            notes.push(`selector not understood: ${sel}`);
            continue;
          }
          selectors.push(sel.startsWith("&") ? sel.replace(/&/g, ".cm-editor") : `.cm-editor ${sel}`);
        }
        if (selectors.length > 0) themeRules.push({ selectors, declarations });
      }
    }
  }

  // Which group of tag rules and which settings object belong to which
  // variant. A theme call names its styles and settings either inline (the
  // literal starts inside the call) or by identifier (`x = [` / `x = {`
  // somewhere in the file); either way the span's start is the key.
  const variantByGroup = new Map<number, ThemeVariant>();
  const variantBySettings = new Map<number, ThemeVariant>();
  for (const call of themeCalls) {
    if (call.variant === null) continue;
    const body = src.slice(call.bodyStart);
    const resolveTo = (value: string, open: "{" | "[", assign: (idx: number) => void) => {
      if (value.startsWith(open)) {
        // The literal itself, and whatever it spreads (`[...githubDarkStyle, ...styles]`).
        const at = call.bodyStart + body.indexOf(value);
        const idx = spanAt(at, open);
        if (idx !== -1) assign(idx);
      }
      for (const name of identifiersIn(value)) {
        const m = new RegExp(`(?<![\\w$.])${name.replace(/\$/g, "\\$")}\\s*(?::\\s*[\\w.<>|[\\]\\s]+?)?=\\s*\\${open}`).exec(src);
        if (!m) continue;
        const idx = spanAt(m.index + m[0].length - 1, open);
        if (idx !== -1) assign(idx);
      }
    };
    resolveTo(call.stylesValue, "[", (idx) => variantByGroup.set(idx, call.variant as ThemeVariant));
    resolveTo(call.settingsValue, "{", (idx) => variantBySettings.set(spans[idx]?.start ?? -1, call.variant as ThemeVariant));
  }

  const groups = [...new Set(tagRules.map((r) => r.group))];
  const variants = new Set(groups.map((g) => variantByGroup.get(g)));
  const splitByVariant = groups.length > 1 && variants.has("light") && variants.has("dark") && !variants.has(undefined);
  let chosen: Array<{ rule: TagRule; variant?: ThemeVariant }>;
  let chosenSettings: Array<{ settings: SettingsObject; variant?: ThemeVariant }>;
  if (splitByVariant) {
    chosen = tagRules.map((rule) => ({ rule, variant: variantByGroup.get(rule.group) }));
    chosenSettings = settingsObjects.filter((so) => variantBySettings.has(so.start)).map((settings) => ({ settings, variant: variantBySettings.get(settings.start) }));
    notes.push(`${groups.length} themes in one file, told apart as light and dark; each follows Obsidian's theme`);
  } else {
    const last = groups[groups.length - 1];
    chosen = tagRules.filter((r) => r.group === last).map((rule) => ({ rule }));
    const lastSettings = settingsObjects[settingsObjects.length - 1];
    chosenSettings = lastSettings ? [{ settings: lastSettings }] : [];
    if (groups.length > 1) notes.push(`${groups.length} groups of token rules; used the last (${chosen.length} rules)`);
    if (settingsObjects.length > 1) notes.push(`${settingsObjects.length} settings objects; used the last`);
  }

  const rules: PaletteRule[] = [];
  for (const { settings, variant } of chosenSettings) {
    const chrome: ChromeSettings = {};
    for (const e of settings.entries) {
      const v = cssValue(e.value, constants);
      if (v === null) {
        notes.push(`settings.${e.key} is computed; skipped`);
        continue;
      }
      chrome[e.key as keyof ChromeSettings] = v;
    }
    rules.push(...chromeRules(chrome, variant));
  }
  rules.push(...themeRules);

  let tokenRules = 0;
  for (const group of [...new Set(chosen.map((c) => c.rule.group))]) {
    const inGroup = chosen.filter((c) => c.rule.group === group);
    const explicit = new Set(inGroup.flatMap((c) => c.rule.tags));
    for (const { rule: r, variant } of inGroup) {
      if (Object.keys(r.declarations).length === 0) continue;
      const selectors = new Set<string>();
      for (const tag of r.tags) {
        const resolved = resolveTagName(tag, explicit, known);
        if (resolved.length === 0) notes.push(`tag ${tag} has no token here; skipped`);
        for (const name of resolved) for (const s of selectorsForTagName(name) ?? []) selectors.add(s);
      }
      if (selectors.size > 0) {
        rules.push(variant ? { selectors: [...selectors], declarations: r.declarations, variant } : { selectors: [...selectors], declarations: r.declarations });
        tokenRules++;
      }
    }
  }

  if (rules.length === 0) notes.push("no token rules, settings or EditorView.theme blocks found");
  else notes.push(`${tokenRules} token rules, ${rules.length - tokenRules} editor rules`);
  return { rules, notes };
}

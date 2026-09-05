import * as cmLanguage from "@codemirror/language";
import type { StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import type { NodeProp } from "@lezer/common";
import type { Tag } from "@lezer/highlight";
import { TOKEN_CLASSES } from "./tokenTable";

/**
 * Obsidian's `@codemirror/language` is a fork (read from `obsidian.asar`,
 * 2026-09-05). Its `StreamLanguage` is the pre-lezer stream parser: a token's
 * node type carries no highlight tag, only the mode's raw token string in a
 * NodeProp the fork exports as `tokenClassNodeProp` (line styles in
 * `lineClassNodeProp`), and the colouring is done by a separate ViewPlugin the
 * fork exports as `lineHighlighter`, which decorates each token with
 * `cm-<token>` classes, the CodeMirror 5 vocabulary Obsidian's stylesheet
 * knows. `StreamLanguage.define()` does not include that plugin; Obsidian adds
 * it to its own editor. So `syntaxHighlighting` and `highlightTree` see nothing
 * on stream tokens there, and a plugin has to do what Obsidian does.
 *
 * This module is the only place that knows about the fork. Everything is read
 * through guards: against npm's `@codemirror/language` (tests, and any host
 * that ships the real package) the exports are absent and every function here
 * is a no-op.
 */

interface ForkExports {
  readonly tokenClassNodeProp?: NodeProp<string>;
  readonly lineClassNodeProp?: NodeProp<string>;
  readonly lineHighlighter?: Extension;
}

const fork = cmLanguage as unknown as ForkExports;

/** The NodeProp carrying a stream token's raw class string, or null outside the fork. */
export const forkTokenClassProp: NodeProp<string> | null = fork.tokenClassNodeProp ?? null;

/** The fork's stream-token decorator, or null outside the fork. */
export const forkLineHighlighter: Extension | null = fork.lineHighlighter ?? null;

export const isObsidianStreamFork: boolean = forkTokenClassProp !== null && forkLineHighlighter !== null;

interface TagInternals {
  readonly base?: { readonly name?: string } | null;
  readonly modified?: ReadonlyArray<{ readonly name?: string }>;
  readonly name?: string;
}

/** `variableName.standard` for `standard(variableName)`: the dotted form legacy modes return. */
function dottedName(tag: Tag): string {
  const t = tag as unknown as TagInternals;
  const base = t.base?.name ?? t.name ?? "";
  const mods = (t.modified ?? []).map((m) => m.name ?? "").filter(Boolean);
  return [base, ...mods].join(".");
}

/**
 * Modern token names (what `@codemirror/legacy-modes` and this plugin's own
 * modes return, e.g. `string.special`, `variableName.standard`, `invalid`) to
 * the CM5 class Obsidian styles (`string-2`, `builtin`, `error`), derived from
 * the highlighter's table so the two never disagree.
 */
const CM5_BY_MODERN: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const row of TOKEN_CLASSES) {
    const cm = row.class.split(" ").find((c) => /^cm-/.test(c));
    if (!cm) continue;
    const cm5 = cm.slice(3);
    m.set(String(row.tag), cm5);
    m.set(dottedName(row.tag), cm5);
  }
  return m;
})();

/** The reverse: a CM5 class Obsidian's decorator emitted, to this plugin's `nfe-tok-*` classes. */
const NFE_BY_CM5: ReadonlyMap<string, string> = (() => {
  const m = new Map<string, string>();
  for (const row of TOKEN_CLASSES) {
    const parts = row.class.split(" ");
    const cm = parts.find((c) => /^cm-/.test(c));
    if (!cm || m.has(cm.slice(3))) continue;
    m.set(cm.slice(3), parts.filter((c) => /^nfe-tok-/.test(c)).join(" "));
  }
  return m;
})();

/** One raw token string (space-separated names) in CM5 vocabulary. Unknown names pass through. */
export function toCm5Token(raw: string): string {
  return raw
    .split(" ")
    .filter(Boolean)
    .map((name) => CM5_BY_MODERN.get(name) ?? (name.includes(".") ? (CM5_BY_MODERN.get(name.split(".")[0] ?? "") ?? name.split(".")[0] ?? name) : name))
    .join(" ");
}

/**
 * A stream parser whose tokens come out in CM5 vocabulary, for the fork's
 * decorator and stylesheet. Outside the fork the original parser is returned
 * untouched: npm's `StreamLanguage` maps both vocabularies itself.
 */
export function adaptStreamParser<S>(parser: StreamParser<S>): StreamParser<S> {
  if (!isObsidianStreamFork) return parser;
  return {
    ...parser,
    token(stream, state) {
      const raw = parser.token(stream, state);
      return raw ? toCm5Token(raw) : raw;
    },
  };
}

/** Classes for a CM5 token string: the `cm-*` classes Obsidian styles plus this plugin's `nfe-tok-*` names. */
export function cm5Classes(cm5: string): string | null {
  const out: string[] = [];
  for (const name of cm5.split(" ").filter(Boolean)) {
    out.push(`cm-${name}`);
    const nfe = NFE_BY_CM5.get(name);
    if (nfe) out.push(nfe);
  }
  return out.length === 0 ? null : out.join(" ");
}

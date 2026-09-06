import type { Palette, ThemeVariant } from "./model";

/**
 * From a palette to the CSS the plugin injects. Every generated selector
 * starts with the editor host, `.nfe-text-content .nfe-body .nfe-editor`
 * (three classes), so a token rule reaches (0,4,0) and outranks Obsidian's
 * global `.cm-*` rules (0,1,0) and the plugin's own fallbacks in styles.css
 * (0,2,0), and a chrome rule on `.cm-editor` (0,4,0) outranks styles.css's
 * (0,3,0). A scope adds one attribute selector on top, so a palette for one
 * language or one file wins over one for every file, whatever the order.
 */
export const HOST_SELECTOR = ".nfe-text-content .nfe-body .nfe-editor";

/**
 * What a palette applies to, decided by the folder it sits in (loader.ts).
 * Each field is one attribute on the editor host; several fields mean the
 * palette applies when any of them matches.
 */
export interface PaletteScope {
  /** A registry language name as shown in the head bar, e.g. `JavaScript`, `C#`. */
  readonly language?: string;
  /** A lower-case extension without the dot. */
  readonly extension?: string;
  /** A file name with its extension, e.g. `app.js`. */
  readonly fileName?: string;
  /** Only while Obsidian is in this theme (`body.theme-light` / `body.theme-dark`). */
  readonly variant?: ThemeVariant;
}

/** Quote a string for use inside `[attr="..."]`. */
export function cssAttributeValue(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\a ")}"`;
}

/** The host selectors for a scope, or the bare host for the empty scope. Matching is case-insensitive; a variant prefixes the body class. */
export function hostSelectors(scope: PaletteScope): string[] {
  const prefix = scope.variant ? `.theme-${scope.variant} ` : "";
  const attrs: string[] = [];
  if (scope.extension !== undefined) attrs.push(`[data-nfe-ext=${cssAttributeValue(scope.extension)} i]`);
  if (scope.language !== undefined) attrs.push(`[data-nfe-lang=${cssAttributeValue(scope.language)} i]`);
  if (scope.fileName !== undefined) attrs.push(`[data-nfe-name=${cssAttributeValue(scope.fileName)} i]`);
  if (attrs.length === 0) return [`${prefix}${HOST_SELECTOR}`];
  return attrs.map((a) => `${prefix}${HOST_SELECTOR}${a}`);
}

/** Flat CSS for a palette: one rule per palette rule, selectors expanded over the scope's hosts. */
export function renderPalette(palette: Palette, scope: PaletteScope): string {
  const hosts = hostSelectors(scope);
  const out: string[] = [];
  for (const rule of palette.rules) {
    // Obsidian marks the active theme on body as `theme-light` / `theme-dark`;
    // a variant rule is one class more specific, on both sides alike. When the
    // file's NAME fixes the variant, rules of the other variant (a theme module
    // with light and dark) are dropped rather than emitted under the wrong theme.
    if (scope.variant && rule.variant && rule.variant !== scope.variant) continue;
    const selectors: string[] = [];
    const prefix = rule.variant && !scope.variant ? `.theme-${rule.variant} ` : "";
    for (const host of hosts) for (const sel of rule.selectors) selectors.push(`${prefix}${host} ${sel}`);
    const body = Object.entries(rule.declarations)
      .map(([k, v]) => `  ${k}: ${v};`)
      .join("\n");
    out.push(`${selectors.join(",\n")} {\n${body}\n}`);
  }
  return out.join("\n\n");
}

/**
 * A hand-written CSS file is applied as the body of a nested rule on the
 * host: top-level declarations in the file (`--code-keyword: #f00;`) land on
 * the editor host, and nested rules (`.cm-keyword { color: #f00 }`) become
 * descendants of it, at the same specificity as a generated rule. This is
 * CSS nesting (Chromium 120, Safari 17.2); a stray closing brace in the file
 * ends the wrapper early, which is the file's problem, not the plugin's.
 */
export function wrapCss(css: string, scope: PaletteScope): string {
  return `${hostSelectors(scope).join(",\n")} {\n${css.trim()}\n}`;
}

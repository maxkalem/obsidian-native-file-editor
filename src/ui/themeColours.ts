import type { ThemeVariant } from "../palette/model";

/**
 * The colours the active Obsidian theme gives code, read from the live
 * document: the values behind the plugin's default look, which is what the
 * example palette is made of. Reading the OTHER variant swaps the body's
 * `theme-light` / `theme-dark` class for the duration of one
 * `getComputedStyle` pass and puts it back before the browser paints, so the
 * user sees nothing.
 */

export const THEME_VARIABLES: readonly string[] = [
  "--code-keyword",
  "--code-string",
  "--code-comment",
  "--code-function",
  "--code-operator",
  "--code-punctuation",
  "--code-property",
  "--code-tag",
  "--code-value",
  "--code-important",
  "--code-normal",
  "--code-background",
  "--background-primary",
  "--background-secondary",
  "--text-normal",
  "--text-faint",
  "--text-selection",
  "--background-modifier-hover",
  "--background-modifier-border",
];

export function readThemeColours(doc: Document, variant: ThemeVariant): Record<string, string> {
  const body = doc.body;
  const wasDark = body.classList.contains("theme-dark");
  const wantDark = variant === "dark";
  const swap = wasDark !== wantDark;
  if (swap) {
    body.classList.toggle("theme-dark", wantDark);
    body.classList.toggle("theme-light", !wantDark);
  }
  const out: Record<string, string> = {};
  try {
    const style = doc.defaultView?.getComputedStyle(body) ?? null;
    if (style) {
      for (const v of THEME_VARIABLES) {
        const value = style.getPropertyValue(v).trim();
        if (value.length > 0) out[v] = value;
      }
    }
  } finally {
    if (swap) {
      body.classList.toggle("theme-dark", wasDark);
      body.classList.toggle("theme-light", !wasDark);
    }
  }
  return out;
}

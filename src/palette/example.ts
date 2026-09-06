import type { ThemeVariant } from "./model";

/**
 * An example palette for one language and one theme variant, made of the
 * colours the active theme actually uses (read from the document by
 * ui/themeColours.ts): a working palette that reproduces the plugin's default
 * look for that language, ready to be edited. Written as
 * `<Language>_<variant>.css` into the palette folder; the loader scopes it by
 * that name.
 */

const CODE_VARIABLES = ["--code-keyword", "--code-string", "--code-comment", "--code-function", "--code-operator", "--code-punctuation", "--code-property", "--code-tag", "--code-value", "--code-important", "--code-normal"];

export function examplePaletteFileName(language: string, variant: ThemeVariant): string {
  return `${language.replace(/[\\/:*?"<>|]/g, "-")}_${variant}.css`;
}

export function examplePaletteCss(language: string, variant: ThemeVariant, colours: Readonly<Record<string, string>>): string {
  const lines: string[] = [];
  lines.push(`/* Native File Editor palette for ${language}, ${variant} theme.`);
  lines.push(`   Generated from the theme's own colours; every value below is what the`);
  lines.push(`   editor already uses, so this file changes nothing until you edit it.`);
  lines.push(`   It applies to ${language} files while Obsidian is in its ${variant} theme,`);
  lines.push(`   because of its name: <Language>_${variant}.css. Reload palettes after editing. */`);
  lines.push("");
  lines.push("/* Token colours: Obsidian's own code variables, set for these files only. */");
  for (const v of CODE_VARIABLES) {
    const value = colours[v];
    lines.push(value ? `${v}: ${value};` : `/* ${v}: (the theme sets none) */`);
  }
  lines.push("");
  lines.push("/* The editor itself. */");
  const bg = colours["--code-background"] ?? colours["--background-primary"];
  const fg = colours["--code-normal"] ?? colours["--text-normal"];
  lines.push(".cm-editor {");
  if (bg) lines.push(`  background-color: ${bg};`);
  if (fg) lines.push(`  color: ${fg};`);
  lines.push("}");
  lines.push(".cm-gutters {");
  if (bg) lines.push(`  background-color: ${bg};`);
  if (colours["--text-faint"]) lines.push(`  color: ${colours["--text-faint"]};`);
  if (colours["--background-modifier-border"]) lines.push(`  border-right-color: ${colours["--background-modifier-border"]};`);
  lines.push("}");
  if (colours["--background-modifier-hover"]) lines.push(`.cm-activeLine, .cm-activeLineGutter { background-color: ${colours["--background-modifier-hover"]}; }`);
  if (colours["--text-selection"]) lines.push(`.cm-selectionBackground, .cm-content ::selection { background-color: ${colours["--text-selection"]}; }`);
  lines.push("");
  lines.push("/* Finer control: one rule per token class, e.g. */");
  lines.push("/* .cm-keyword { font-weight: bold; }  .cm-comment { font-style: italic; }  .nfe-tok-function { text-decoration: underline; } */");
  return `${lines.join("\n")}\n`;
}

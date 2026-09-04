/**
 * Naming a new file: pure decisions the New file dialog and its command share.
 */

/**
 * Characters no filesystem Obsidian runs on accepts in a name, path
 * separators, and the ones Obsidian itself refuses in a file name (`#`, `^`,
 * `[`, `]`, `|`), plus control characters.
 */
const FORBIDDEN = /[<>:"/\\|?*#^[\]\x00-\x1f]/g;

/**
 * A safe base name: forbidden characters dropped, surrounding whitespace and
 * dots trimmed, the extension stripped when the user typed it. Empty input
 * becomes "Untitled".
 */
export function sanitizeBaseName(input: string, extension: string): string {
  let name = input.replace(FORBIDDEN, "").trim();
  const suffix = `.${extension}`;
  if (name.toLowerCase().endsWith(suffix.toLowerCase())) name = name.slice(0, -suffix.length);
  name = name.replace(/^[.\s]+|[.\s]+$/g, "");
  return name.length === 0 ? "Untitled" : name;
}

/**
 * The vault path for a new file in `folder`, adding " 1", " 2", ... while
 * `exists` says the name is taken. `folder` is "" or "/" for the vault root.
 */
export function newFilePath(folder: string, baseName: string, extension: string, exists: (path: string) => boolean): string {
  const prefix = folder === "" || folder === "/" ? "" : `${folder.replace(/\/+$/, "")}/`;
  const candidate = (n: number) => `${prefix}${baseName}${n === 0 ? "" : ` ${n}`}.${extension}`;
  for (let n = 0; ; n++) {
    const path = candidate(n);
    if (!exists(path)) return path;
  }
}

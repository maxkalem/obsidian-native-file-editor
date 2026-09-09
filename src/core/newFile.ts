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

export interface ExtensionOption {
  readonly extension: string;
  readonly label: string;
}

/**
 * Whether `query`'s characters appear in `text` in that order, not necessarily
 * together: the Unity-style match the user asked for (2026-09-09), where `tt`
 * finds `txt`, `http` and `targets`. Case-insensitive; an empty query matches.
 */
export function isSubsequence(query: string, text: string): boolean {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let i = 0;
  for (let j = 0; j < t.length && i < q.length; j++) if (t[j] === q[i]) i++;
  return i === q.length;
}

/**
 * The extension options that match a query, best first: an exact extension,
 * then extensions starting with the query, then extensions containing its
 * letters in order, then language names containing them in order; ties keep
 * the list's order. A leading dot in the query is ignored.
 */
export function filterExtensions(query: string, options: readonly ExtensionOption[]): ExtensionOption[] {
  const q = query.trim().replace(/^\./, "").toLowerCase();
  if (q.length === 0) return [...options];
  const rank = (o: ExtensionOption): number => {
    const ext = o.extension.toLowerCase();
    if (ext === q) return 0;
    if (ext.startsWith(q)) return 1;
    if (isSubsequence(q, ext)) return 2;
    if (isSubsequence(q, o.label)) return 3;
    return -1;
  };
  return options
    .map((o, index) => ({ o, index, r: rank(o) }))
    .filter((x) => x.r >= 0)
    .sort((a, b) => a.r - b.r || a.index - b.index)
    .map((x) => x.o);
}


/**
 * Obsidian's file index can drift from the disk in both directions. On Windows
 * and macOS it watches the whole vault with one recursive `fs.watch`, and a
 * batch rename made outside Obsidian can lose events on either side: the "old
 * name gone" events (the explorer then lists ghosts) and the "new name here"
 * events (the renamed files stay invisible until Obsidian restarts; 106 of 173
 * samples on 2026-09-07). Obsidian rescans only at start; a plugin that
 * registers hundreds of extensions makes every such gap visible, so this
 * plugin checks its own files against the disk once after load, after a burst
 * of create/delete events and on every Reread, one directory listing per
 * folder, and hands both kinds of gap to the caller, who asks Obsidian to drop
 * the ghost or to index the file.
 */

export interface ListedFile {
  readonly path: string;
  readonly extension: string;
}

export interface StaleSweepReport {
  /** Files with a registered extension that were compared with the disk. */
  readonly checked: number;
  /** Their paths the disk does not have, in Obsidian's order. */
  readonly missing: string[];
  /**
   * Files on the disk, in the folders that were listed, with a registered
   * extension, that Obsidian does not list; in the disk's order. Dot-files are
   * not counted: Obsidian never indexes them.
   */
  readonly unindexed: string[];
  /** Folders whose listing failed; their files were not judged. */
  readonly unlisted: string[];
}

/** The vault-relative folder of a path; "" for the vault root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

/** The lower-cased extension of a path, or null when its name has none. */
function extensionOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? null : name.slice(dot + 1).toLowerCase();
}

export async function findStaleFiles(
  files: Iterable<ListedFile>,
  registered: ReadonlySet<string>,
  listDir: (folder: string) => Promise<{ files: string[] }>
): Promise<StaleSweepReport> {
  const byFolder = new Map<string, string[]>();
  let checked = 0;
  for (const f of files) {
    if (!registered.has(f.extension.toLowerCase())) continue;
    checked++;
    const folder = folderOf(f.path);
    const list = byFolder.get(folder);
    if (list) list.push(f.path);
    else byFolder.set(folder, [f.path]);
  }
  const missing: string[] = [];
  const unindexed: string[] = [];
  const unlisted: string[] = [];
  for (const [folder, paths] of byFolder) {
    let onDisk: string[];
    try {
      onDisk = (await listDir(folder)).files;
    } catch {
      unlisted.push(folder);
      continue;
    }
    const diskSet = new Set(onDisk);
    for (const p of paths) if (!diskSet.has(p)) missing.push(p);
    const indexed = new Set(paths);
    for (const p of onDisk) {
      if (indexed.has(p)) continue;
      const name = p.slice(p.lastIndexOf("/") + 1);
      if (name.startsWith(".")) continue;
      const ext = extensionOf(p);
      if (ext !== null && registered.has(ext)) unindexed.push(p);
    }
  }
  return { checked, missing, unindexed, unlisted };
}

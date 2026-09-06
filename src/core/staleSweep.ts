/**
 * Obsidian's file index can outlive the disk: a batch rename made outside
 * Obsidian while it runs can lose the "old name gone" events, and the explorer
 * then lists files that no longer exist (open item 9, reproduced 2026-09-06
 * with 32 samples). Obsidian rescans only at start; a plugin that registers
 * hundreds of extensions makes every such ghost visible, so this plugin
 * checks its own files against the disk once after load and on every Reread,
 * one directory listing per folder, and hands each ghost to the caller, who
 * asks Obsidian to drop it.
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
  /** Folders whose listing failed; their files were not judged. */
  readonly unlisted: string[];
}

/** The vault-relative folder of a path; "" for the vault root. */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
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
  const unlisted: string[] = [];
  for (const [folder, paths] of byFolder) {
    let onDisk: Set<string>;
    try {
      onDisk = new Set((await listDir(folder)).files);
    } catch {
      unlisted.push(folder);
      continue;
    }
    for (const p of paths) if (!onDisk.has(p)) missing.push(p);
  }
  return { checked, missing, unlisted };
}

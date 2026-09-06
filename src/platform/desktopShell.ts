/**
 * The desktop's native dialogs and "open with the default application",
 * through Electron's `shell` and `remote.dialog`, resolved lazily through
 * `require` like everything else desktop-only, so the one `main.js` still
 * loads on a phone. Every function is null-safe: on a device without Electron
 * the shell is `null` and the settings tab shows paths without buttons.
 *
 * Nothing here runs a program of the plugin's: `openPath` asks the operating
 * system to open a file or folder with whatever the user has associated with
 * it (a browser for `.html`, the file explorer for a folder), which is what
 * double-clicking the file would do.
 */

export interface DesktopShell {
  /** Open a folder in the file explorer, or a file in its default application. Resolves to an error text or null. */
  openPath(absolutePath: string): Promise<string | null>;
  /** A native folder picker; null when cancelled. */
  pickFolder(defaultPath: string): Promise<string | null>;
  /** A native file picker (for an interpreter executable); null when cancelled. */
  pickFile(defaultPath: string): Promise<string | null>;
  /** Vault-relative, forward-slash path for an absolute one inside the vault, or null when it is outside. */
  toVaultPath(absolutePath: string): string | null;
  /** The absolute OS path of a vault-relative one. */
  toAbsolute(vaultPath: string): string;
}

interface ElectronLike {
  shell: { openPath(path: string): Promise<string> };
  remote?: { dialog: { showOpenDialog(options: { defaultPath?: string; properties: string[]; filters?: Array<{ name: string; extensions: string[] }> }): Promise<{ canceled: boolean; filePaths: string[] }> } };
}

interface PathLike {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  isAbsolute(p: string): boolean;
  sep: string;
}

/** Null anywhere Electron's `require` is missing (mobile) or the vault has no filesystem path. */
export function createDesktopShell(basePath: string | null): DesktopShell | null {
  const req = (globalThis as unknown as { require?: (id: string) => unknown }).require;
  if (typeof req !== "function" || basePath === null) return null;
  let electron: ElectronLike;
  let path: PathLike;
  try {
    electron = req("electron") as ElectronLike;
    path = req("path") as PathLike;
  } catch {
    return null;
  }
  if (!electron?.shell) return null;
  const dialog = electron.remote?.dialog ?? null;
  return {
    async openPath(absolutePath) {
      try {
        const err = await electron.shell.openPath(absolutePath);
        return err ? err : null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    async pickFolder(defaultPath) {
      if (!dialog) return null;
      const r = await dialog.showOpenDialog({ defaultPath, properties: ["openDirectory", "createDirectory"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    async pickFile(defaultPath) {
      if (!dialog) return null;
      const r = await dialog.showOpenDialog({ defaultPath, properties: ["openFile"] });
      return r.canceled ? null : (r.filePaths[0] ?? null);
    },
    toVaultPath(absolutePath) {
      const rel = path.relative(basePath, path.resolve(absolutePath));
      if (rel.length === 0) return "";
      if (rel.startsWith("..") || path.isAbsolute(rel)) return null;
      return rel.split(path.sep).join("/");
    },
    toAbsolute(vaultPath) {
      return path.join(basePath, ...vaultPath.split("/").filter((s) => s.length > 0));
    },
  };
}

/**
 * Restart this plugin through Obsidian's plugin manager (`app.plugins`, not in
 * the public typings). The settings tab that called this is torn down by the
 * disable; the user reopens it.
 */
export async function reloadPlugin(app: unknown, pluginId: string): Promise<string | null> {
  const plugins = (app as { plugins?: { disablePlugin?: (id: string) => Promise<void>; enablePlugin?: (id: string) => Promise<void> } }).plugins;
  if (!plugins || typeof plugins.disablePlugin !== "function" || typeof plugins.enablePlugin !== "function") return "this Obsidian build does not expose the plugin manager";
  try {
    await plugins.disablePlugin(pluginId);
    await plugins.enablePlugin(pluginId);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

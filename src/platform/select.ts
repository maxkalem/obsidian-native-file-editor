import { FileSystemAdapter, Platform, type App } from "obsidian";
import { DesktopTransport, loadNodeModules } from "./desktop";
import { MobileTransport, loadStreamCodecs } from "./mobile";
import type { Transport } from "./transport";

/**
 * The one decision about platform, kept as a pure function so a test can ask
 * it directly: Node is used only when this is the desktop app AND the vault
 * sits on a real filesystem. Anything else goes through the adapter.
 */
export function chooseTransportKind(input: { isDesktopApp: boolean; hasFileSystemAdapter: boolean }): "desktop" | "mobile" {
  return input.isDesktopApp && input.hasFileSystemAdapter ? "desktop" : "mobile";
}

export function createTransport(app: App): Transport {
  const adapter = app.vault.adapter;
  const kind = chooseTransportKind({
    isDesktopApp: Platform.isDesktopApp,
    hasFileSystemAdapter: adapter instanceof FileSystemAdapter,
  });
  if (kind === "desktop") {
    return new DesktopTransport((adapter as FileSystemAdapter).getBasePath(), loadNodeModules());
  }
  return new MobileTransport(adapter, loadStreamCodecs());
}

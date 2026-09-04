import type { LogSink } from "../core/log";

/**
 * The slice of Obsidian's DataAdapter the log sink uses. The log lives in the
 * plugin folder inside the vault, so it is written through the adapter on both
 * platforms; the transport is for the user's files, not for ours.
 */
export interface LogAdapterLike {
  exists(normalizedPath: string): Promise<boolean>;
  stat(normalizedPath: string): Promise<{ size: number } | null>;
  append(normalizedPath: string, data: string): Promise<void>;
  rename(normalizedPath: string, normalizedNewPath: string): Promise<void>;
  remove(normalizedPath: string): Promise<void>;
  mkdir(normalizedPath: string): Promise<void>;
}

export class AdapterLogSink implements LogSink {
  private readonly adapter: LogAdapterLike;
  private readonly path: string;
  private readonly folder: string;

  constructor(adapter: LogAdapterLike, path: string) {
    this.adapter = adapter;
    this.path = path;
    this.folder = path.slice(0, path.lastIndexOf("/"));
  }

  async append(text: string): Promise<void> {
    if (!(await this.adapter.exists(this.folder))) await this.adapter.mkdir(this.folder);
    await this.adapter.append(this.path, text);
  }

  async size(): Promise<number> {
    if (!(await this.adapter.exists(this.path))) return 0;
    return (await this.adapter.stat(this.path))?.size ?? 0;
  }

  async rotate(): Promise<void> {
    const old = `${this.path}.1`;
    if (await this.adapter.exists(old)) await this.adapter.remove(old);
    await this.adapter.rename(this.path, old);
  }
}

/**
 * SavedVariables file watcher.
 *
 * WoW writes SavedVariables as one big Lua file, flushing only on
 * /reload, logout, or game crash. The write is not atomic — the file
 * is overwritten in chunks, so fs events can fire before the write
 * settles. We debounce and re-read.
 *
 * Uses chokidar because Node's built-in fs.watch is unreliable on
 * Windows for editors that use atomic-save patterns (WoW does not,
 * but chokidar handles both cases consistently).
 */

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { EventEmitter } from "node:events";

export interface WatcherEvents {
  updated: (absolutePath: string) => void;
  error: (err: Error) => void;
  ready: () => void;
}

export declare interface SavedVariablesWatcher {
  on<U extends keyof WatcherEvents>(event: U, listener: WatcherEvents[U]): this;
  emit<U extends keyof WatcherEvents>(event: U, ...args: Parameters<WatcherEvents[U]>): boolean;
}

export class SavedVariablesWatcher extends EventEmitter {
  private watcher: FSWatcher | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly filePath: string,
    private readonly debounceMs: number = 500,
  ) {
    super();
  }

  start(): void {
    if (this.watcher) return;
    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        // Wait until the file size is stable for this many ms before
        // firing. Important because WoW writes in chunks.
        stabilityThreshold: this.debounceMs,
        pollInterval: 100,
      },
    });

    this.watcher.on("ready", () => this.emit("ready"));
    this.watcher.on("change", (path) => this.debouncedEmit(path));
    this.watcher.on("add", (path) => this.debouncedEmit(path));
    this.watcher.on("error", (err) => this.emit("error", err instanceof Error ? err : new Error(String(err))));
  }

  /**
   * Force a re-fire of the "updated" event regardless of file change.
   * Useful at startup to process any runs the addon queued while the
   * companion was offline.
   */
  triggerManualRead(): void {
    this.emit("updated", this.filePath);
  }

  async stop(): Promise<void> {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private debouncedEmit(path: string): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.emit("updated", path);
    }, this.debounceMs);
  }
}

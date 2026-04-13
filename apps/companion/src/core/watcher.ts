/**
 * SavedVariables file watcher.
 *
 * WoW writes SavedVariables as one big Lua file, flushing only on
 * /reload, logout, or game crash. The write is not atomic — the file
 * is overwritten in chunks, so fs events can fire before the write
 * settles.
 *
 * Uses chokidar for filesystem event detection, PLUS a polling
 * fallback that checks the file's mtime every 30 seconds. The poll
 * catches changes that chokidar misses on Windows (WoW's write
 * pattern doesn't always trigger standard FS notifications).
 */

import chokidar from "chokidar";
import type { FSWatcher } from "chokidar";
import { statSync } from "node:fs";
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
  private pollTimer: NodeJS.Timeout | null = null;
  private lastMtime: number = 0;

  constructor(
    private readonly filePath: string,
    private readonly debounceMs: number = 500,
    private readonly pollIntervalMs: number = 30_000,
  ) {
    super();
  }

  start(): void {
    if (this.watcher) return;

    // Snapshot the current mtime so we don't re-fire on startup
    try {
      this.lastMtime = statSync(this.filePath).mtimeMs;
    } catch {
      this.lastMtime = 0;
    }

    // Chokidar for real-time FS event detection
    this.watcher = chokidar.watch(this.filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: this.debounceMs,
        pollInterval: 100,
      },
    });

    this.watcher.on("ready", () => this.emit("ready"));
    this.watcher.on("change", (path) => this.handleChange(path, "chokidar"));
    this.watcher.on("add", (path) => this.handleChange(path, "chokidar"));
    this.watcher.on("error", (err) =>
      this.emit("error", err instanceof Error ? err : new Error(String(err))),
    );

    // Polling fallback — check mtime every 30 seconds
    this.pollTimer = setInterval(() => this.pollForChanges(), this.pollIntervalMs);
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
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }
  }

  private handleChange(path: string, source: string): void {
    // Update lastMtime so the poll doesn't double-fire
    try {
      this.lastMtime = statSync(this.filePath).mtimeMs;
    } catch {
      // file may be mid-write
    }

    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.emit("updated", path);
    }, this.debounceMs);
  }

  private pollForChanges(): void {
    try {
      const currentMtime = statSync(this.filePath).mtimeMs;
      if (currentMtime > this.lastMtime) {
        this.lastMtime = currentMtime;
        this.emit("updated", this.filePath);
      }
    } catch {
      // File doesn't exist yet or is being written — ignore
    }
  }
}

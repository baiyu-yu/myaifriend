import chokidar, { FSWatcher } from 'chokidar'
import path from 'path'

type FileEventCallback = (eventType: string, filePath: string) => void

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map()
  private pendingEvents: Map<string, { timer: NodeJS.Timeout; eventType: string; filePath: string }> = new Map()
  private readonly debounceMs = 1200

  private normalizeEventKey(filePath: string): string {
    return path.normalize(filePath).toLowerCase()
  }

  private mergeEventType(previous: string, next: string): string {
    if (next === 'unlink') return 'unlink'
    if (previous === 'unlink' && next === 'add') return 'change'
    if (previous === 'add' && next === 'change') return 'add'
    return next
  }

  private scheduleEmit(eventType: string, filePath: string, callback: FileEventCallback) {
    const key = this.normalizeEventKey(filePath)
    const existing = this.pendingEvents.get(key)
    const mergedType = existing ? this.mergeEventType(existing.eventType, eventType) : eventType
    if (existing) {
      clearTimeout(existing.timer)
    }

    const timer = setTimeout(() => {
      this.pendingEvents.delete(key)
      callback(mergedType, filePath)
    }, this.debounceMs)

    this.pendingEvents.set(key, { timer, eventType: mergedType, filePath })
  }

  private clearPendingEventsByFolder(folderPath: string) {
    const normalizedFolder = path.normalize(folderPath).toLowerCase()
    for (const [key, pending] of this.pendingEvents.entries()) {
      if (!key.startsWith(normalizedFolder)) continue
      clearTimeout(pending.timer)
      this.pendingEvents.delete(key)
    }
  }

  watch(folderPath: string, callback: FileEventCallback): void {
    if (this.watchers.has(folderPath)) return

    const watcher = chokidar.watch(folderPath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 600,
        pollInterval: 100,
      },
      ignorePermissionErrors: true,
    })

    watcher
      .on('add', (filePath) => this.scheduleEmit('add', filePath, callback))
      .on('change', (filePath) => this.scheduleEmit('change', filePath, callback))
      .on('unlink', (filePath) => this.scheduleEmit('unlink', filePath, callback))

    this.watchers.set(folderPath, watcher)
  }

  unwatch(folderPath: string): void {
    const watcher = this.watchers.get(folderPath)
    if (!watcher) return
    watcher.close()
    this.watchers.delete(folderPath)
    this.clearPendingEventsByFolder(folderPath)
  }

  stopAll(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
    for (const [, pending] of this.pendingEvents) {
      clearTimeout(pending.timer)
    }
    this.pendingEvents.clear()
  }
}

import chokidar, { FSWatcher } from 'chokidar'

type FileEventCallback = (eventType: string, filePath: string) => void

export class FileWatcher {
  private watchers: Map<string, FSWatcher> = new Map()

  watch(folderPath: string, callback: FileEventCallback): void {
    if (this.watchers.has(folderPath)) {
      return
    }

    const watcher = chokidar.watch(folderPath, {
      persistent: true,
      ignoreInitial: true,
      // 支持的文件类型
      ignored: (path: string) => {
        const ext = path.split('.').pop()?.toLowerCase()
        if (!ext) return false // 不忽略目录
        const allowed = ['txt', 'doc', 'docx', 'xls', 'xlsx', 'html', 'htm', 'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp']
        return !allowed.includes(ext)
      },
      depth: 3,
    })

    watcher
      .on('add', (path) => callback('add', path))
      .on('change', (path) => callback('change', path))
      .on('unlink', (path) => callback('unlink', path))

    this.watchers.set(folderPath, watcher)
  }

  unwatch(folderPath: string): void {
    const watcher = this.watchers.get(folderPath)
    if (watcher) {
      watcher.close()
      this.watchers.delete(folderPath)
    }
  }

  stopAll(): void {
    for (const [, watcher] of this.watchers) {
      watcher.close()
    }
    this.watchers.clear()
  }
}

import path from 'path'

export type ResolveWatchPathResult =
  | { ok: true; path: string; watchFolder: string }
  | { ok: false; reason: string }

function normalizePathForCompare(input: string): string {
  return path.normalize(path.resolve(input)).toLowerCase()
}

function isPathInside(rootPath: string, targetPath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(targetPath))
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

function matchWatchFolderByName(watchFolders: string[], folderName: string): string[] {
  const name = folderName.trim().toLowerCase()
  if (!name) return []
  return watchFolders.filter((folder) => path.basename(folder).toLowerCase() === name)
}

function inferWatchFolderFromRelativePath(rawPath: string, watchFolders: string[]): {
  watchFolder: string | null
  relativePath: string
} {
  const normalized = rawPath.replace(/\\/g, '/').replace(/^\.\//, '')
  const [head, ...rest] = normalized.split('/')
  if (!head) return { watchFolder: null, relativePath: rawPath }

  const byName = matchWatchFolderByName(watchFolders, head)
  if (byName.length === 1) {
    const nextRelativePath = rest.join('/')
    return { watchFolder: byName[0], relativePath: nextRelativePath || path.basename(rawPath) }
  }
  return { watchFolder: null, relativePath: rawPath }
}

function normalizeRelativePathForSelectedFolder(rawPath: string, watchFolder: string): string {
  const inferred = inferWatchFolderFromRelativePath(rawPath, [watchFolder])
  return inferred.watchFolder ? inferred.relativePath : rawPath
}

export function resolvePathInWatchFolders(args: {
  rawPath: string
  watchFolders: string[]
  selectedWatchFolder?: string
  operationName: string
}): ResolveWatchPathResult {
  const rawPath = String(args.rawPath || '').trim()
  if (!rawPath) return { ok: false, reason: 'path is required' }

  const watchFolders = (args.watchFolders || [])
    .map((item) => String(item || '').trim())
    .filter(Boolean)
    .map((folder) => path.resolve(folder))

  if (watchFolders.length === 0) {
    return {
      ok: false,
      reason: `No watch folder configured. ${args.operationName} only allows reading/writing inside watch folders.`,
    }
  }

  const selectedWatchFolder = String(args.selectedWatchFolder || '').trim()
  let baseFolder = ''
  let effectivePath = rawPath
  const looksRootRelativePath =
    /^[\\/]/.test(rawPath) && !/^[a-zA-Z]:[\\/]/.test(rawPath) && !rawPath.startsWith('\\\\')

  if (selectedWatchFolder) {
    const normalizedSelected = normalizePathForCompare(selectedWatchFolder)
    const exact = watchFolders.find((folder) => normalizePathForCompare(folder) === normalizedSelected)
    if (exact) {
      baseFolder = exact
    } else {
      const byName = matchWatchFolderByName(watchFolders, selectedWatchFolder)
      if (byName.length === 1) {
        baseFolder = byName[0]
      } else if (byName.length > 1) {
        return {
          ok: false,
          reason: `watch_folder name is ambiguous: ${selectedWatchFolder}. Candidates: ${byName.join(' | ')}`,
        }
      } else {
        return {
          ok: false,
          reason: `watch_folder is not configured: ${selectedWatchFolder}. Available: ${watchFolders.join(' | ')}`,
        }
      }
    }
  }

  if (looksRootRelativePath) {
    effectivePath = rawPath.replace(/^[\\/]+/, '')
  } else if (path.isAbsolute(rawPath)) {
    const resolvedPath = path.resolve(rawPath)
    if (baseFolder) {
      if (!isPathInside(baseFolder, resolvedPath)) {
        return { ok: false, reason: `Target path is not inside selected watch_folder: ${baseFolder}` }
      }
      return { ok: true, path: resolvedPath, watchFolder: baseFolder }
    }
    const candidates = watchFolders.filter((folder) => isPathInside(folder, resolvedPath))
    if (candidates.length === 0) {
      return {
        ok: false,
        reason: `Target path is outside watch folders: ${resolvedPath}. Watch folders: ${watchFolders.join(' | ')}`,
      }
    }
    return { ok: true, path: resolvedPath, watchFolder: candidates[0] }
  }

  if (!baseFolder) {
    const inferred = inferWatchFolderFromRelativePath(rawPath, watchFolders)
    if (inferred.watchFolder) {
      baseFolder = inferred.watchFolder
      effectivePath = inferred.relativePath
    } else if (watchFolders.length === 1) {
      baseFolder = watchFolders[0]
    }
  } else {
    effectivePath = normalizeRelativePathForSelectedFolder(rawPath, baseFolder)
  }

  if (!baseFolder) {
    return {
      ok: false,
      reason: `Multiple watch folders configured. Please specify watch_folder. Available: ${watchFolders.join(' | ')}`,
    }
  }

  const resolvedPath = path.resolve(baseFolder, effectivePath)
  if (!isPathInside(baseFolder, resolvedPath)) {
    return { ok: false, reason: `Target path escapes selected watch_folder: ${baseFolder}` }
  }

  return { ok: true, path: resolvedPath, watchFolder: baseFolder }
}


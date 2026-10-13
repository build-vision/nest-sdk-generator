/**
 * @file Order project files the way ts-morph's `project.getSourceFiles()` does
 *
 * The order of the source files determines the order controllers are analyzed in, which in turn determines the order
 * of the generated modules and types.
 *
 * ts-morph keeps a tree of the directories containing source files. Directories without a parent in the tree are
 * "roots", kept in the order they were created (i.e. the order files were added: the tsconfig's files, then the files
 * they import). The tree is walked breadth-first by depth: at each depth, the roots at that depth come first, then the
 * children of the previous depth's directories, sorted by name. The files of each directory are sorted by name.
 */

function compareNames(a: string, b: string): number {
  // Same comparison as ts-morph's `LocaleStringComparer`
  const result = a.localeCompare(b, 'en-us-u-kf-upper')
  return result < 0 ? -1 : result === 0 ? 0 : 1
}

function dirname(file: string): string {
  const index = file.lastIndexOf('/')
  return index <= 0 ? '/' : file.substring(0, index)
}

function depth(dir: string): number {
  return dir.split('/').filter((part) => part.length > 0).length
}

function isProjectFile(file: string): boolean {
  // Files ts-morph considers part of the project: anything outside of `node_modules` (and outside of TypeScript's
  // bundled libraries, which tsgo exposes with non-absolute paths)
  return (file.startsWith('/') || /^[a-zA-Z]:\//.test(file)) && file.toLowerCase().lastIndexOf('/node_modules/') === -1
}

/**
 * Get the project's files, in ts-morph's order
 * @param rootFiles The tsconfig's files, in the tsconfig's order (absolute paths, forward slashes)
 * @param programFiles All files of the program (absolute paths, forward slashes)
 */
export function orderProjectFiles(rootFiles: string[], programFiles: string[]): string[] {
  // ts-morph adds the tsconfig's files first, then the files the compiler requested while building the program.
  // The latter only affect the order of directories outside of the tsconfig's ones: sort them for determinism.
  const rootFilesSet = new Set(rootFiles)
  const files = [...new Set([...rootFiles, ...programFiles.filter((file) => !rootFilesSet.has(file)).sort()])].filter(isProjectFile)

  const filesByDir = new Map<string, string[]>()

  for (const file of files) {
    const dir = dirname(file)
    const dirFiles = filesByDir.get(dir)
    if (dirFiles) dirFiles.push(file)
    else filesByDir.set(dir, [file])
  }

  // Directories, in creation order
  const dirs = [...filesByDir.keys()]
  const dirsSet = new Set(dirs)

  const hasAncestorInTree = (dir: string) => {
    for (let parent = dirname(dir); ; parent = dirname(parent)) {
      if (dirsSet.has(parent)) return true
      if (parent === '/' || parent === dirname(parent)) return false
    }
  }

  const roots = dirs.filter((dir) => !hasAncestorInTree(dir))

  // Link every directory to its parent, creating the intermediate directories up to the nearest directory in the tree
  const children = new Map<string, Set<string>>()

  for (const dir of dirs) {
    if (roots.includes(dir)) continue

    for (let current = dir; !roots.includes(current) && !children.get(dirname(current))?.has(current); current = dirname(current)) {
      const parent = dirname(current)
      const siblings = children.get(parent)
      if (siblings) siblings.add(current)
      else children.set(parent, new Set([current]))
    }
  }

  // Breadth-first walk, like ts-morph's `DirectoryCache.getAllByDepth()`
  const levels = new Map<number, string[]>()

  const addToLevel = (dir: string) => {
    const level = levels.get(depth(dir))
    if (level) level.push(dir)
    else levels.set(depth(dir), [dir])
  }

  roots.forEach(addToLevel)

  const ordered: string[] = []

  for (let currentDepth = Math.min(...levels.keys()); levels.size > 0; currentDepth++) {
    for (const dir of levels.get(currentDepth) ?? []) {
      ordered.push(...(filesByDir.get(dir) ?? []).sort((a, b) => compareNames(a.substring(dir.length), b.substring(dir.length))))
      ;[...(children.get(dir) ?? [])].sort((a, b) => compareNames(a.substring(dir.length), b.substring(dir.length))).forEach(addToLevel)
    }

    levels.delete(currentDepth)
  }

  return ordered
}

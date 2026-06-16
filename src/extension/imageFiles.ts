import * as path from 'node:path'
import * as vscode from 'vscode'

const SAFE_IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  '.pdf',
  '.eps',
])

/**
 * Resolves and copies image files for a visual-editor document.
 */
export class ImageFileService {
  constructor(
    private readonly document: vscode.TextDocument,
    private readonly workspaceFolder: vscode.WorkspaceFolder | undefined
  ) {}

  get resourceRoot(): vscode.Uri {
    return (
      this.workspaceFolder?.uri ??
      vscode.Uri.file(path.dirname(this.document.uri.fsPath))
    )
  }

  /**
   * Resolves a LaTeX graphics path to an existing local file.
   */
  async resolve(graphicsPath: string): Promise<vscode.Uri | undefined> {
    const cleanPath = graphicsPath.replace(/^['"]|['"]$/g, '')
    const candidates = this.candidatePaths(cleanPath)
    const root = this.resourceRoot

    for (const candidate of candidates) {
      try {
        const stat = await vscode.workspace.fs.stat(candidate)
        if (
          stat.type === vscode.FileType.File &&
          isUriInsideRoot(candidate, root)
        ) {
          return candidate
        }
      } catch {
        // Continue through extension and search-path candidates.
      }
    }
    return undefined
  }

  /**
   * Copies uploaded image bytes into the configured workspace assets directory.
   */
  async insert(name: string, bytes: Uint8Array): Promise<string> {
    if (!this.workspaceFolder) {
      throw new Error('Insert image requires an open workspace folder.')
    }

    const extension = path.extname(name).toLowerCase()
    if (!SAFE_IMAGE_EXTENSIONS.has(extension)) {
      throw new Error(`Unsupported image type: ${extension || 'unknown'}`)
    }

    const configuration = vscode.workspace.getConfiguration('latexVisualEditor')
    const assetsDirectory = configuration.get<string>('assetsDirectory', 'assets')
    const assetsUri = vscode.Uri.joinPath(this.workspaceFolder.uri, assetsDirectory)
    if (!isUriInsideRoot(assetsUri, this.workspaceFolder.uri)) {
      throw new Error('The configured assets directory is outside the workspace.')
    }

    await vscode.workspace.fs.createDirectory(assetsUri)
    const safeBase = sanitizeImageBaseName(path.basename(name, extension))

    let target = vscode.Uri.joinPath(assetsUri, `${safeBase}${extension}`)
    for (let suffix = 2; await uriExists(target); suffix += 1) {
      target = vscode.Uri.joinPath(assetsUri, `${safeBase}-${suffix}${extension}`)
    }
    await vscode.workspace.fs.writeFile(target, bytes)

    const documentDirectory = path.dirname(this.document.uri.fsPath)
    return path.relative(documentDirectory, target.fsPath).split(path.sep).join('/')
  }

  /**
   * Builds likely graphics paths, including common omitted extensions.
   */
  private candidatePaths(graphicsPath: string): vscode.Uri[] {
    const documentDirectory = vscode.Uri.file(path.dirname(this.document.uri.fsPath))
    const bases = [
      vscode.Uri.joinPath(documentDirectory, graphicsPath),
      ...(this.workspaceFolder
        ? [vscode.Uri.joinPath(this.workspaceFolder.uri, graphicsPath)]
        : []),
    ]
    const candidates = uniqueUris(bases)
    if (!path.extname(graphicsPath)) {
      for (const base of bases) {
        for (const extension of SAFE_IMAGE_EXTENSIONS) {
          candidates.push(vscode.Uri.file(base.fsPath + extension))
        }
      }
    }
    return uniqueUris(candidates)
  }

}

/**
 * Checks that a URI is equal to or contained by a root URI.
 */
export function isUriInsideRoot(uri: vscode.Uri, rootUri: vscode.Uri): boolean {
  const root = path.resolve(rootUri.fsPath)
  const target = path.resolve(uri.fsPath)
  const relative = path.relative(root, target)
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
}

/**
 * Converts an uploaded image filename stem into a portable safe basename.
 */
export function sanitizeImageBaseName(name: string): string {
  return (
    name
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'image'
  )
}

/**
 * Checks whether a workspace URI exists.
 */
async function uriExists(uri: vscode.Uri): Promise<boolean> {
  try {
    await vscode.workspace.fs.stat(uri)
    return true
  } catch {
    return false
  }
}

function uniqueUris(uris: vscode.Uri[]): vscode.Uri[] {
  const seen = new Set<string>()
  return uris.filter(uri => {
    const key = path.resolve(uri.fsPath).toLowerCase()
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

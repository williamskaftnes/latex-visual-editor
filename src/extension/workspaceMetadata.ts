import * as vscode from 'vscode'
import type { WorkspaceMetadata } from '../shared/messages'
import { extractWorkspaceMetadata } from '../shared/workspaceMetadataParser'

const EMPTY_METADATA: WorkspaceMetadata = {
  labels: [],
  citationKeys: [],
  includes: [],
  graphics: [],
  packages: [],
  commands: [],
  environments: [],
}
const MAX_INDEXED_FILES = 2_000
const MAX_INDEXED_FILE_BYTES = 2 * 1024 * 1024

/**
 * Indexes LaTeX and BibTeX symbols used by the visual editor.
 */
export class WorkspaceMetadataIndex implements vscode.Disposable {
  private readonly emitter = new vscode.EventEmitter<WorkspaceMetadata>()
  private readonly watchers: vscode.FileSystemWatcher[] = []
  private metadata: WorkspaceMetadata = EMPTY_METADATA
  private refreshTimer: NodeJS.Timeout | undefined

  readonly onDidChange = this.emitter.event

  constructor(private readonly workspaceFolder: vscode.WorkspaceFolder | undefined) {
    if (!workspaceFolder) return

    for (const glob of ['**/*.tex', '**/*.bib']) {
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceFolder, glob)
      )
      watcher.onDidCreate(() => this.scheduleRefresh())
      watcher.onDidChange(() => this.scheduleRefresh())
      watcher.onDidDelete(() => this.scheduleRefresh())
      this.watchers.push(watcher)
    }
  }

  /**
   * Returns the most recently built workspace metadata.
   */
  get current(): WorkspaceMetadata {
    return this.metadata
  }

  /**
   * Rebuilds the metadata index from workspace LaTeX and BibTeX files.
   */
  async refresh(): Promise<WorkspaceMetadata> {
    if (!this.workspaceFolder) {
      this.metadata = EMPTY_METADATA
      return this.metadata
    }

    const root = this.workspaceFolder.uri
    const [texFiles, bibFiles] = await Promise.all([
      vscode.workspace.findFiles(
        new vscode.RelativePattern(root, '**/*.tex'),
        '**/{node_modules,.git,dist}/**'
      ),
      vscode.workspace.findFiles(
        new vscode.RelativePattern(root, '**/*.bib'),
        '**/{node_modules,.git,dist}/**'
      ),
    ])

    const selectedTexFiles = texFiles.slice(0, MAX_INDEXED_FILES)
    const selectedBibFiles = bibFiles.slice(
      0,
      Math.max(0, MAX_INDEXED_FILES - selectedTexFiles.length)
    )
    const texContents = await readWorkspaceFiles(selectedTexFiles)
    const bibContents = await readWorkspaceFiles(selectedBibFiles)

    this.metadata = extractWorkspaceMetadata(texContents, bibContents)
    this.emitter.fire(this.metadata)
    return this.metadata
  }

  /**
   * Releases file watchers and pending refresh work.
   */
  dispose(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.watchers.forEach(watcher => watcher.dispose())
    this.emitter.dispose()
  }

  /**
   * Coalesces rapid workspace changes into one metadata refresh.
   */
  private scheduleRefresh(): void {
    if (this.refreshTimer) clearTimeout(this.refreshTimer)
    this.refreshTimer = setTimeout(() => {
      this.refreshTimer = undefined
      void this.refresh()
    }, 200)
  }
}

async function readWorkspaceFiles(uris: vscode.Uri[]): Promise<string[]> {
  const contents: string[] = []
  for (const uri of uris) {
    try {
      const stat = await vscode.workspace.fs.stat(uri)
      if (stat.size > MAX_INDEXED_FILE_BYTES) continue
      contents.push(
        new TextDecoder().decode(await vscode.workspace.fs.readFile(uri))
      )
    } catch {
      // Files can disappear while a workspace refresh is in progress.
    }
  }
  return contents
}

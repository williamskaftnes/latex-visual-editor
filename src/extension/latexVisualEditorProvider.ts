import * as crypto from 'node:crypto'
import * as path from 'node:path'
import * as vscode from 'vscode'
import type {
  EditorConfiguration,
  HostToWebviewMessage,
  WebviewToHostMessage,
} from '../shared/messages'
import {
  getActiveVisualEditor,
  getActiveVisualEditorDocument,
  setActiveVisualEditor,
  setVisualEditorFocus,
} from './activeVisualEditor'
import { ImageFileService } from './imageFiles'
import {
  getStoredEditorSelection,
  storeEditorSelection,
} from './editorSelections'
import {
  getStoredViewState,
  storeViewState,
} from './editorViewState'
import { WorkspaceMetadataIndex } from './workspaceMetadata'

export const VISUAL_EDITOR_VIEW_TYPE = 'latexVisualEditor.editor'
const MAX_LISTING_PREVIEW_BYTES = 256 * 1024

/**
 * Hosts the Overleaf-derived editor and synchronizes it with a TextDocument.
 */
export class LatexVisualEditorProvider implements vscode.CustomTextEditorProvider {
  private readonly metadataIndexes = new Map<string, WorkspaceMetadataIndex>()
  private readonly panels = new Set<vscode.WebviewPanel>()
  private readonly pendingStateSnapshots = new Map<string, () => void>()

  constructor(private readonly context: vscode.ExtensionContext) {}

  /**
   * Registers the custom editor provider.
   */
  static register(
    context: vscode.ExtensionContext,
    provider = new LatexVisualEditorProvider(context)
  ): vscode.Disposable {
    const registration = vscode.window.registerCustomEditorProvider(
      VISUAL_EDITOR_VIEW_TYPE,
      provider,
      {
        webviewOptions: { retainContextWhenHidden: false },
        supportsMultipleEditorsPerDocument: true,
      }
    )
    return vscode.Disposable.from(registration, provider)
  }

  /**
   * Configures one visual editor and its document synchronization.
   */
  async resolveCustomTextEditor(
    document: vscode.TextDocument,
    panel: vscode.WebviewPanel
  ): Promise<void> {
    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri)
    const metadataIndex = this.getMetadataIndex(workspaceFolder)
    const imageFiles = new ImageFileService(document, workspaceFolder)

    panel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        this.context.extensionUri,
        imageFiles.resourceRoot,
      ],
    }
    panel.webview.html = this.createWebviewHtml(panel.webview)
    this.panels.add(panel)

    const post = (message: HostToWebviewMessage) => panel.webview.postMessage(message)
    let editQueue = Promise.resolve()
    const initialize = () =>
      post({
        type: 'initialize',
        text: normalizeForWebview(document.getText()),
        version: document.version,
        documentUri: document.uri.toString(),
        metadata: metadataIndex.current,
        configuration: this.configuration,
        selection: mapSelectionToWebview(
          document.getText(),
          getStoredEditorSelection(document.uri)
        ),
        viewState: mapViewStateToWebview(
          document.getText(),
          getStoredViewState(this.context, document.uri)
        ),
      })

    const documentListener = vscode.workspace.onDidChangeTextDocument(event => {
      if (event.document.uri.toString() !== document.uri.toString()) return
      void post({
        type: 'documentChanged',
        text: normalizeForWebview(document.getText()),
        version: document.version,
      })
    })

    const metadataListener = metadataIndex.onDidChange(metadata => {
      void post({ type: 'metadataChanged', metadata })
    })

    void metadataIndex.refresh().catch(error => {
      console.error('Failed to refresh LaTeX visual editor metadata', error)
    })

    const messageListener = panel.webview.onDidReceiveMessage(
      async (message: WebviewToHostMessage) => {
        switch (message.type) {
          case 'ready':
            await initialize()
            break
          case 'focusChanged':
            setVisualEditorFocus(panel, message.focused)
            break
          case 'edit':
            editQueue = editQueue.then(() =>
              this.applyWebviewEdit(document, message, initialize)
            )
            await editQueue
            break
          case 'selectionChanged':
            storeEditorSelection(document.uri, {
              anchor: webviewOffsetToHost(document.getText(), message.anchor),
              head: webviewOffsetToHost(document.getText(), message.head),
            })
            break
          case 'viewStateChanged':
            await storeViewState(
              this.context,
              document.uri,
              {
                anchor: webviewOffsetToHost(document.getText(), message.anchor),
                visualScrollTop: message.visualScrollTop,
                source: message.source,
              }
            )
            break
          case 'stateSnapshot':
            storeEditorSelection(document.uri, {
              anchor: webviewOffsetToHost(
                document.getText(),
                message.selection.anchor
              ),
              head: webviewOffsetToHost(
                document.getText(),
                message.selection.head
              ),
            })
            await storeViewState(this.context, document.uri, {
              ...message.viewState,
              anchor: webviewOffsetToHost(
                document.getText(),
                message.viewState.anchor
              ),
            })
            this.pendingStateSnapshots.get(message.requestId)?.()
            this.pendingStateSnapshots.delete(message.requestId)
            break
          case 'resolveResource':
            await this.resolveResource(panel.webview, imageFiles, message)
            break
          case 'insertImage':
            await this.insertImage(panel.webview, imageFiles, message)
            break
          case 'showError':
            void vscode.window.showErrorMessage(message.message)
            break
        }
      }
    )

    const visibilityListener = panel.onDidChangeViewState(event => {
      if (event.webviewPanel.active) {
        setActiveVisualEditor(panel, document)
      } else if (getActiveVisualEditor() === panel) {
        setActiveVisualEditor(undefined)
      }
    })

    if (panel.active) setActiveVisualEditor(panel, document)
    panel.onDidDispose(() => {
      this.panels.delete(panel)
      documentListener.dispose()
      metadataListener.dispose()
      messageListener.dispose()
      visibilityListener.dispose()
      setVisualEditorFocus(panel, false)
      if (getActiveVisualEditor() === panel) setActiveVisualEditor(undefined)
    })
  }

  /** Flushes selection and viewport state from the active webview. */
  async syncActiveEditorState(uri: vscode.Uri): Promise<void> {
    const panel = getActiveVisualEditor()
    const document = getActiveVisualEditorDocument()
    if (!panel || document?.uri.toString() !== uri.toString()) return

    const requestId = crypto.randomUUID()
    await new Promise<void>(resolve => {
      const timeout = setTimeout(() => {
        this.pendingStateSnapshots.delete(requestId)
        resolve()
      }, 1000)
      this.pendingStateSnapshots.set(requestId, () => {
        clearTimeout(timeout)
        resolve()
      })
      void panel.webview.postMessage({
        type: 'command',
        command: 'syncState',
        requestId,
      } satisfies HostToWebviewMessage)
    })
  }

  /**
   * Reloads open webviews from the current dist/webview.js and dist/webview.css.
   */
  refreshWebviews(): number {
    for (const panel of this.panels) {
      panel.webview.html = this.createWebviewHtml(panel.webview)
    }
    return this.panels.size
  }

  /**
   * Releases cached workspace metadata indexes.
   */
  dispose(): void {
    this.metadataIndexes.forEach(index => index.dispose())
    this.metadataIndexes.clear()
  }

  /**
   * Returns current extension settings sent to the webview.
   */
  private get configuration(): EditorConfiguration {
    const configuration = vscode.workspace.getConfiguration('latexVisualEditor')
    return {
      assetsDirectory: configuration.get<string>('assetsDirectory', 'assets'),
      maxImagePreviewBytes: configuration.get<number>(
        'maxImagePreviewBytes',
        20 * 1024 * 1024
      ),
      syntaxValidation: configuration.get<boolean>('syntaxValidation', true),
    }
  }

  /**
   * Applies a versioned minimal CodeMirror change to the VS Code document.
   */
  private async applyWebviewEdit(
    document: vscode.TextDocument,
    message: Extract<WebviewToHostMessage, { type: 'edit' }>,
    resynchronize: () => Thenable<boolean>
  ): Promise<void> {
    if (message.version !== document.version) {
      await resynchronize()
      return
    }

    const documentLength = document.getText().length
    if (
      message.from < 0 ||
      message.to < message.from ||
      message.to > documentLength
    ) {
      await resynchronize()
      return
    }

    const edit = new vscode.WorkspaceEdit()
    edit.replace(
      document.uri,
      new vscode.Range(
        document.positionAt(webviewOffsetToHost(document.getText(), message.from)),
        document.positionAt(webviewOffsetToHost(document.getText(), message.to))
      ),
      document.eol === vscode.EndOfLine.CRLF
        ? message.insert.replaceAll('\n', '\r\n')
        : message.insert
    )
    if (!(await vscode.workspace.applyEdit(edit))) {
      await resynchronize()
    }
  }

  /**
   * Resolves a workspace image path into a webview-safe URI.
   */
  private async resolveResource(
    webview: vscode.Webview,
    imageFiles: ImageFileService,
    message: Extract<WebviewToHostMessage, { type: 'resolveResource' }>
  ): Promise<void> {
    const uri = await imageFiles.resolve(message.path)
    if (!uri) {
      await webview.postMessage({
        type: 'resourceResolved',
        requestId: message.requestId,
        path: message.path,
        error: 'Image not found',
      } satisfies HostToWebviewMessage)
      return
    }

    const stat = await vscode.workspace.fs.stat(uri)
    if (
      stat.size > this.configuration.maxImagePreviewBytes
    ) {
      await webview.postMessage({
        type: 'resourceResolved',
        requestId: message.requestId,
        path: message.path,
        error: 'Image exceeds the configured preview size',
      } satisfies HostToWebviewMessage)
      return
    }

    let text: string | undefined
    if (stat.size <= MAX_LISTING_PREVIEW_BYTES) {
      const bytes = await vscode.workspace.fs.readFile(uri)
      if (looksLikeText(bytes)) {
        text = new TextDecoder().decode(bytes)
      }
    }

    await webview.postMessage({
      type: 'resourceResolved',
      requestId: message.requestId,
      path: message.path,
      url: webview.asWebviewUri(uri).toString(),
      extension: path.extname(uri.fsPath).slice(1),
      text,
    } satisfies HostToWebviewMessage)
  }

  /**
   * Stores uploaded image bytes and returns a document-relative path.
   */
  private async insertImage(
    webview: vscode.Webview,
    imageFiles: ImageFileService,
    message: Extract<WebviewToHostMessage, { type: 'insertImage' }>
  ): Promise<void> {
    try {
      const relativePath = await imageFiles.insert(
        message.name,
        Uint8Array.from(message.bytes)
      )
      await webview.postMessage({
        type: 'imageInserted',
        requestId: message.requestId,
        path: relativePath,
      } satisfies HostToWebviewMessage)
    } catch (error) {
      await webview.postMessage({
        type: 'imageInserted',
        requestId: message.requestId,
        error: error instanceof Error ? error.message : String(error),
      } satisfies HostToWebviewMessage)
    }
  }

  /**
   * Returns the shared metadata index for a workspace folder.
   */
  private getMetadataIndex(
    workspaceFolder: vscode.WorkspaceFolder | undefined
  ): WorkspaceMetadataIndex {
    const key = workspaceFolder?.uri.toString() ?? 'no-workspace'
    let index = this.metadataIndexes.get(key)
    if (!index) {
      index = new WorkspaceMetadataIndex(workspaceFolder)
      this.metadataIndexes.set(key, index)
    }
    return index
  }

  /**
   * Creates a CSP-restricted webview document.
   */
  private createWebviewHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.js')
    )
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.css')
    )
    const mathJaxUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.context.extensionUri,
        'dist',
        'mathjax',
        'tex-svg.js'
      )
    )
    const pdfWorkerUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'pdf.worker.mjs')
    )
    const nonce = crypto.randomBytes(16).toString('hex')

    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data: blob:; connect-src ${webview.cspSource}; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src ${webview.cspSource} blob: 'nonce-${nonce}'; worker-src blob:; child-src blob:;">
  <link rel="stylesheet" href="${styleUri}">
  <title>LaTeX Visual Editor</title>
</head>
<body>
  <div id="toolbar"></div>
  <div id="editor"></div>
  <meta name="latex-visual-editor-mathjax" content="${escapeHtmlAttribute(mathJaxUri.toString())}">
  <meta name="latex-visual-editor-pdf-worker" content="${escapeHtmlAttribute(pdfWorkerUri.toString())}">
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`
  }
}

function normalizeForWebview(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

function hostOffsetToWebview(text: string, offset: number): number {
  return offset - (text.slice(0, offset).match(/\r(?=\n)/g)?.length ?? 0)
}

function webviewOffsetToHost(text: string, offset: number): number {
  let host = 0
  let webview = 0
  while (host < text.length && webview < offset) {
    if (text[host] === '\r' && text[host + 1] === '\n') host += 1
    host += 1
    webview += 1
  }
  return host
}

function mapSelectionToWebview(
  text: string,
  selection: { anchor: number; head: number } | undefined
): { anchor: number; head: number } | undefined {
  return selection && {
    anchor: hostOffsetToWebview(text, selection.anchor),
    head: hostOffsetToWebview(text, selection.head),
  }
}

function mapViewStateToWebview(
  text: string,
  state: ReturnType<typeof getStoredViewState>
): ReturnType<typeof getStoredViewState> {
  return state && {
    ...state,
    anchor: hostOffsetToWebview(text, state.anchor),
  }
}

function looksLikeText(bytes: Uint8Array): boolean {
  if (bytes.length === 0) return true
  const sampleLength = Math.min(bytes.length, 4096)
  let suspicious = 0

  for (let index = 0; index < sampleLength; index += 1) {
    const byte = bytes[index]
    if (byte === 0) return false
    if (
      byte < 7 ||
      (byte > 13 && byte < 32)
    ) {
      suspicious += 1
    }
  }

  return suspicious / sampleLength < 0.02
}

function escapeHtmlAttribute(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}

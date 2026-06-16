import * as vscode from 'vscode'
import {
  getActiveVisualEditor,
  getActiveVisualEditorDocument,
} from './extension/activeVisualEditor'
import { replaceDocumentEditor } from './extension/editorTabs'
import {
  captureTextEditorSelection,
  getStoredEditorSelection,
  restoreTextEditorSelection,
  storeEditorSelection,
} from './extension/editorSelections'
import {
  captureTextEditorViewState,
  getStoredViewState,
  restoreTextEditorViewState,
  storeViewState,
} from './extension/editorViewState'
import {
  LatexVisualEditorProvider,
  VISUAL_EDITOR_VIEW_TYPE,
} from './extension/latexVisualEditorProvider'

const MODE_KEY_PREFIX = 'latexVisualEditor.mode.'
const CURRENT_MODE_KEY = 'latexVisualEditor.currentMode'

/**
 * Activates commands and the custom text editor.
 */
export function activate(context: vscode.ExtensionContext): void {
  const visualEditorProvider = new LatexVisualEditorProvider(context)
  context.subscriptions.push(
    LatexVisualEditorProvider.register(context, visualEditorProvider)
  )

  const refreshWebviews = () => {
    const count = visualEditorProvider.refreshWebviews()
    void vscode.window.showInformationMessage(
      `Refreshed ${count} LaTeX visual editor webview${count === 1 ? '' : 's'}.`
    )
  }

  const openVisual = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (!target) return
    const sourceEditor = vscode.window.activeTextEditor
    if (sourceEditor?.document.uri.toString() === target.toString()) {
      storeEditorSelection(target, captureTextEditorSelection(sourceEditor))
      await storeViewState(
        context,
        target,
        captureTextEditorViewState(sourceEditor)
      )
    }
    await rememberMode(context, target, 'visual')
    await replaceDocumentEditor(target, VISUAL_EDITOR_VIEW_TYPE)
  }

  const openSource = async (uri?: vscode.Uri) => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri
    if (!target) return
    const selection = getStoredEditorSelection(target)
    const viewState = getStoredViewState(context, target)
    await rememberMode(context, target, 'source')
    await replaceDocumentEditor(target, 'default')
    const sourceEditor = vscode.window.activeTextEditor
    if (
      selection &&
      sourceEditor?.document.uri.toString() === target.toString()
    ) {
      restoreTextEditorSelection(sourceEditor, selection)
    }
    if (
      viewState !== undefined &&
      sourceEditor?.document.uri.toString() === target.toString()
    ) {
      restoreTextEditorViewState(sourceEditor, viewState)
    }
  }

  context.subscriptions.push(
    vscode.commands.registerCommand('latexVisualEditor.openVisual', openVisual),
    vscode.commands.registerCommand('latexVisualEditor.openSource', openSource),
    vscode.commands.registerCommand('latexVisualEditor.toggle', async (uri?: vscode.Uri) => {
      if (getActiveVisualEditor()) {
        await openSource(uri)
      } else {
        await openVisual(uri)
      }
    }),
    vscode.commands.registerCommand('latexVisualEditor.insertFigure', () => {
      void getActiveVisualEditor()?.webview.postMessage({
        type: 'command',
        command: 'insertFigure',
      })
    }),
    vscode.commands.registerCommand('latexVisualEditor.insertTable', () => {
      void getActiveVisualEditor()?.webview.postMessage({
        type: 'command',
        command: 'insertTable',
      })
    }),
    vscode.commands.registerCommand(
      'latexVisualEditor.refreshWebviews',
      refreshWebviews
    ),
    vscode.window.registerUriHandler({
      handleUri(uri) {
        if (uri.path === '/refreshWebviews') {
          refreshWebviews()
        }
      },
    }),
    vscode.commands.registerCommand('latexVisualEditor.selectAll', () => {
      const panel = getActiveVisualEditor()
      const document = getActiveVisualEditorDocument()
      if (!panel || !document) return

      storeEditorSelection(document.uri, {
        anchor: 0,
        head: document.getText().length,
      })
      void panel.webview.postMessage({
        type: 'command',
        command: 'selectAll',
      })
    }),
    vscode.commands.registerCommand('latexVisualEditor.copy', async () => {
      const document = getActiveVisualEditorDocument()
      if (!document) return

      const selection = getStoredEditorSelection(document.uri)
      if (!selection) return
      const from = Math.min(selection.anchor, selection.head)
      const to = Math.max(selection.anchor, selection.head)
      await vscode.env.clipboard.writeText(
        document.getText().slice(from, to)
      )
    })
  )

  const reopening = new Set<string>()
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      if (!editor || editor.document.languageId !== 'latex') return
      const rememberedMode = getRememberedMode(context, editor.document.uri)
      if (rememberedMode !== 'visual') return

      const key = editor.document.uri.toString()
      if (reopening.has(key)) {
        return
      }

      reopening.add(key)
      void Promise.resolve(
        replaceDocumentEditor(editor.document.uri, VISUAL_EDITOR_VIEW_TYPE)
      ).finally(() => reopening.delete(key))
    })
  )
}

/**
 * Persists one file's selected editor mode.
 */
async function rememberMode(
  context: vscode.ExtensionContext,
  uri: vscode.Uri,
  mode: 'source' | 'visual'
): Promise<void> {
  const configuration = vscode.workspace.getConfiguration('latexVisualEditor')
  await Promise.all([
    configuration.get<boolean>('rememberMode', true)
      ? context.workspaceState.update(MODE_KEY_PREFIX + uri.toString(), mode)
      : Promise.resolve(),
    configuration.get<boolean>('persistToggleAcrossTexFiles', true)
      ? context.workspaceState.update(CURRENT_MODE_KEY, mode)
      : Promise.resolve(),
  ])
}

/**
 * Returns the editor mode to restore for a LaTeX file.
 */
function getRememberedMode(
  context: vscode.ExtensionContext,
  uri: vscode.Uri
): 'source' | 'visual' | undefined {
  const configuration = vscode.workspace.getConfiguration('latexVisualEditor')
  if (configuration.get<boolean>('persistToggleAcrossTexFiles', true)) {
    const currentMode =
      context.workspaceState.get<'source' | 'visual'>(CURRENT_MODE_KEY)
    if (currentMode !== undefined) return currentMode
  }
  if (configuration.get<boolean>('rememberMode', true)) {
    return context.workspaceState.get<'source' | 'visual'>(
      MODE_KEY_PREFIX + uri.toString()
    )
  }
  return undefined
}

/**
 * Performs no explicit shutdown work.
 */
export function deactivate(): void {}

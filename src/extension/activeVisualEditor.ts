import * as vscode from 'vscode'

let activePanel: vscode.WebviewPanel | undefined
let activeDocument: vscode.TextDocument | undefined

/**
 * Records the currently visible visual-editor panel.
 */
export function setActiveVisualEditor(
  panel: vscode.WebviewPanel | undefined,
  document?: vscode.TextDocument
): void {
  activePanel = panel
  activeDocument = panel ? document : undefined
  void vscode.commands.executeCommand(
    'setContext',
    'latexVisualEditor.active',
    Boolean(panel)
  )
}

/**
 * Returns the currently visible visual-editor panel.
 */
export function getActiveVisualEditor(): vscode.WebviewPanel | undefined {
  return activePanel
}

/**
 * Returns the document displayed by the active visual editor.
 */
export function getActiveVisualEditorDocument():
  | vscode.TextDocument
  | undefined {
  return activeDocument
}

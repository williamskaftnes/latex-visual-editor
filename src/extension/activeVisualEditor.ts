import * as vscode from 'vscode'

let activePanel: vscode.WebviewPanel | undefined
let activeDocument: vscode.TextDocument | undefined
let focusedPanel: vscode.WebviewPanel | undefined

/**
 * Records the currently visible visual-editor panel.
 */
export function setActiveVisualEditor(
  panel: vscode.WebviewPanel | undefined,
  document?: vscode.TextDocument
): void {
  activePanel = panel
  activeDocument = panel ? document : undefined
  if (!panel && focusedPanel) setVisualEditorFocus(focusedPanel, false)
  void vscode.commands.executeCommand(
    'setContext',
    'latexVisualEditor.active',
    Boolean(panel)
  )
}

/**
 * Tracks keyboard focus separately from the active editor tab. An editor can
 * remain active while focus is in a sidebar such as Copilot Chat.
 */
export function setVisualEditorFocus(
  panel: vscode.WebviewPanel,
  focused: boolean
): void {
  if (!focused && focusedPanel !== panel) return
  focusedPanel = focused ? panel : undefined
  void vscode.commands.executeCommand(
    'setContext',
    'latexVisualEditor.focused',
    focused
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

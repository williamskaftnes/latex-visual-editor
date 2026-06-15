import * as vscode from 'vscode'

/**
 * Returns the URI represented by a text or custom-editor tab.
 */
export function getTabUri(tab: vscode.Tab): vscode.Uri | undefined {
  if (
    tab.input instanceof vscode.TabInputText ||
    tab.input instanceof vscode.TabInputCustom
  ) {
    return tab.input.uri
  }
  return undefined
}

/**
 * Finds the active tab displaying the requested document.
 */
export function findActiveDocumentTab(uri: vscode.Uri): vscode.Tab | undefined {
  const activeGroup = vscode.window.tabGroups.activeTabGroup
  return activeGroup.tabs.find(
    tab => tab.isActive && getTabUri(tab)?.toString() === uri.toString()
  )
}

/**
 * Reopens a document with another editor in place of its current tab.
 */
export async function replaceDocumentEditor(
  uri: vscode.Uri,
  editorId: string
): Promise<void> {
  const previousTab = findActiveDocumentTab(uri)
  const viewColumn =
    previousTab?.group.viewColumn ??
    vscode.window.tabGroups.activeTabGroup.viewColumn

  await vscode.commands.executeCommand(
    'vscode.openWith',
    uri,
    editorId,
    viewColumn
  )

  if (previousTab && previousTab.group.tabs.includes(previousTab)) {
    try {
      await vscode.window.tabGroups.close(previousTab, true)
    } catch {
      // openWith may asynchronously replace the original tab before close runs.
    }
  }
}

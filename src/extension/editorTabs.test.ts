import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('vscode', () => {
  class Uri {
    constructor(private readonly value: string) {}
    static parse(value: string) {
      return new Uri(value)
    }
    toString() {
      return this.value
    }
  }
  class TabInputText {
    constructor(public readonly uri: Uri) {}
  }
  class TabInputCustom {
    constructor(
      public readonly uri: Uri,
      public readonly viewType: string
    ) {}
  }
  return {
    Uri,
    TabInputText,
    TabInputCustom,
    window: {
      tabGroups: {
        activeTabGroup: undefined,
        close: vi.fn(),
      },
    },
    commands: {
      executeCommand: vi.fn(),
    },
    ViewColumn: {
      One: 1,
    },
  }
})

import * as vscode from 'vscode'
import { getTabUri, replaceDocumentEditor } from './editorTabs'

describe('getTabUri', () => {
  it('reads text and custom editor tab URIs', () => {
    const uri = vscode.Uri.parse('file:///document.tex')

    expect(
      getTabUri({ input: new vscode.TabInputText(uri) } as vscode.Tab)
    ).toBe(uri)
    expect(
      getTabUri({
        input: new vscode.TabInputCustom(uri, 'latexVisualEditor.editor'),
      } as vscode.Tab)
    ).toBe(uri)
  })

  it('ignores unrelated tabs', () => {
    expect(getTabUri({ input: {} } as vscode.Tab)).toBeUndefined()
  })
})

describe('replaceDocumentEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens in the same group and closes the original tab', async () => {
    const uri = vscode.Uri.parse('file:///document.tex')
    const group = {
      viewColumn: vscode.ViewColumn.One,
      activeTab: undefined,
      tabs: [],
    } as unknown as vscode.TabGroup
    const oldTab = {
      input: new vscode.TabInputText(uri),
      isActive: true,
      group,
    } as vscode.Tab
    Object.assign(group, { activeTab: oldTab, tabs: [oldTab] })

    Object.assign(vscode.window.tabGroups, { activeTabGroup: group })

    await replaceDocumentEditor(uri, 'latexVisualEditor.editor')

    expect(vscode.commands.executeCommand).toHaveBeenCalledWith(
      'vscode.openWith',
      uri,
      'latexVisualEditor.editor',
      vscode.ViewColumn.One
    )
    expect(vscode.window.tabGroups.close).toHaveBeenCalledWith(oldTab, true)
  })

  it('does not close a tab already replaced by VS Code', async () => {
    const uri = vscode.Uri.parse('file:///document.tex')
    const group = {
      viewColumn: vscode.ViewColumn.One,
      activeTab: undefined,
      tabs: [],
    } as unknown as vscode.TabGroup
    const oldTab = {
      input: new vscode.TabInputText(uri),
      isActive: true,
      group,
    } as vscode.Tab
    Object.assign(group, { activeTab: oldTab, tabs: [oldTab] })
    Object.assign(vscode.window.tabGroups, { activeTabGroup: group })
    vi.mocked(vscode.commands.executeCommand).mockImplementationOnce(
      async () => {
        Object.assign(group, { tabs: [] })
      }
    )

    await replaceDocumentEditor(uri, 'latexVisualEditor.editor')

    expect(vscode.window.tabGroups.close).not.toHaveBeenCalled()
  })

  it('ignores a close race after opening the replacement editor', async () => {
    const uri = vscode.Uri.parse('file:///document.tex')
    const group = {
      viewColumn: vscode.ViewColumn.One,
      activeTab: undefined,
      tabs: [],
    } as unknown as vscode.TabGroup
    const oldTab = {
      input: new vscode.TabInputText(uri),
      isActive: true,
      group,
    } as vscode.Tab
    Object.assign(group, { activeTab: oldTab, tabs: [oldTab] })
    Object.assign(vscode.window.tabGroups, { activeTabGroup: group })
    vi.mocked(vscode.window.tabGroups.close).mockRejectedValueOnce(
      new Error('Invalid tab not found')
    )

    await expect(
      replaceDocumentEditor(uri, 'latexVisualEditor.editor')
    ).resolves.toBeUndefined()
  })
})

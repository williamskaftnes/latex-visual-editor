import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('table generator theme', () => {
  it('uses webview theme colors for light-mode cell selection', () => {
    const source = readFileSync(
      'src/webview/overleaf-editor/extensions/visual/table-generator.ts',
      'utf8'
    )

    expect(source).toContain('var(--vscode-editor-selectionBackground')
    expect(source).toContain('var(--vscode-focusBorder')
    expect(source).not.toContain(
      "'--table-generator-selected-background-color': 'var(--blue-10)'"
    )
  })
})

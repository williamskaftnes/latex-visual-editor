// @vitest-environment jsdom
import { EditorSelection } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { autoPair } from './auto-pair'

describe('auto pair', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  it('removes both untouched brackets with Backspace', () => {
    view = new EditorView({
      doc: '()',
      selection: EditorSelection.cursor(1),
      parent: document.body,
      extensions: [autoPair],
    })

    view.contentDOM.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
    )

    expect(view.state.doc.toString()).toBe('')
    expect(view.state.selection.main.head).toBe(0)
  })
})

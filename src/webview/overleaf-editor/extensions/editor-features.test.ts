// @vitest-environment jsdom
import { EditorSelection, EditorState } from '@codemirror/state'
import { foldable } from '@codemirror/language'
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { LaTeXLanguage } from '../languages/latex/latex-language'
import { bracketSelectionAt } from './bracket-matching'
import { mathContainerAtCursor } from './math-preview'

describe('portable editor features', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  it('selects a matching bracket pair on double-click', () => {
    const source = String.raw`\textbf{hello}`
    view = new EditorView({
      doc: source,
      parent: document.body,
      extensions: [LaTeXLanguage],
    })
    const openBrace = source.indexOf('{')

    const selection = bracketSelectionAt(view, openBrace)

    expect(selection?.from).toBe(openBrace)
    expect(selection?.to).toBe(source.length)
  })

  it('provides fold ranges for LaTeX environments', () => {
    const source = String.raw`\begin{document}
First
Second
\end{document}`
    const state = EditorState.create({ doc: source, extensions: [LaTeXLanguage] })
    const firstLine = state.doc.line(1)
    const range = foldable(state, firstLine.from, firstLine.to)

    expect(range).not.toBeNull()
    expect(state.sliceDoc(range!.from, range!.to)).toContain('First')
  })

  it('finds the editable equation under the cursor for live preview', () => {
    const source = 'Before $x^2 + y^2$ after'
    const state = EditorState.create({
      doc: source,
      selection: EditorSelection.cursor(source.indexOf('x^2') + 1),
      extensions: [LaTeXLanguage],
    })

    expect(mathContainerAtCursor(state)).toMatchObject({
      content: 'x^2 + y^2',
      displayMode: false,
      passToMathJax: true,
    })
  })
})

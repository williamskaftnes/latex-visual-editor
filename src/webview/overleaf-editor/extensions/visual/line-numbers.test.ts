// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { afterEach, describe, expect, it } from 'vitest'
import { LaTeXLanguage } from '../../languages/latex/latex-language'
import { atomicDecorations } from './atomic-decorations'
import {
  selectDocumentLine,
  selectDocumentLines,
  visualLineNumbers,
} from './line-numbers'
import { markDecorations } from './mark-decorations'
import { mousedown } from './selection'

describe('visual line numbers', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  it('shows and selects the source line for an input-listing widget', () => {
    const source = String.raw`before
\lstinputlisting[language=Python]{example.py}
after`
    view = new EditorView({
      doc: source,
      parent: document.body,
      extensions: [
        LaTeXLanguage,
        visualLineNumbers,
        mousedown,
        markDecorations,
        atomicDecorations({
          previewByPath: () => ({
            extension: 'py',
            text: 'print("Hello, World!")',
            url: 'example.py',
          }),
        }),
      ],
    })

    const widget = view.dom.querySelector('.latex-listing-preview')
    const widgetLineNumber = [...view.dom.querySelectorAll('.cm-gutterElement')]
      .find(element => element.textContent === '2')

    expect(widget).not.toBeNull()
    expect(widgetLineNumber).not.toBeUndefined()

    const line = view.state.doc.line(2)
    selectDocumentLine(view, line.from)
    expect(view.state.selection.main.from).toBe(line.from)
    expect(view.state.selection.main.to).toBe(line.to + 1)
    expect(view.dom.querySelector('.latex-listing-preview')).toBeNull()
    expect(view.dom.textContent).toContain('lstinputlisting')
  })

  it('selects an ordinary source line from its line number', () => {
    view = new EditorView({
      doc: 'first\nsecond\nthird',
      parent: document.body,
      extensions: [visualLineNumbers],
    })
    const secondLineNumber = [...view.dom.querySelectorAll('.cm-gutterElement')]
      .find(element => element.textContent === '2')
    const line = view.state.doc.line(2)
    selectDocumentLine(view, line.from)
    expect(view.state.selection.main.from).toBe(line.from)
    expect(view.state.selection.main.to).toBe(line.to + 1)
    expect(secondLineNumber).not.toBeUndefined()
    expect(getComputedStyle(secondLineNumber!).cursor).toBe('default')
  })

  it('extends a gutter drag across complete lines in either direction', () => {
    view = new EditorView({ doc: 'first\nsecond\nthird', parent: document.body })
    const first = view.state.doc.line(1)
    const third = view.state.doc.line(3)

    selectDocumentLines(view, first, third)
    expect(view.state.selection.main.anchor).toBe(first.from)
    expect(view.state.selection.main.head).toBe(third.to)

    selectDocumentLines(view, third, first)
    expect(view.state.selection.main.anchor).toBe(third.to)
    expect(view.state.selection.main.head).toBe(first.from)
  })
})

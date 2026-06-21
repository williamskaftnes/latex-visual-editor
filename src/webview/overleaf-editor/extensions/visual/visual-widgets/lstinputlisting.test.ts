// @vitest-environment jsdom
import { EditorView } from '@codemirror/view'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { afterEach, describe, expect, it } from 'vitest'
import { LstInputListingWidget } from './lstinputlisting'
import { parser } from '../../../lezer-latex/latex.mjs'
import { atomicDecorations } from '../atomic-decorations'
import { LaTeXLanguage } from '../../../languages/latex/latex-language'
import { lstInputListingArgument } from '../utils/lstinputlisting'
import { markDecorations } from '../mark-decorations'

describe('LstInputListingWidget', () => {
  let view: EditorView | undefined

  afterEach(() => view?.destroy())

  it('renders source in the shared filled listing box', () => {
    view = new EditorView({ parent: document.body })
    const widget = new LstInputListingWidget('example.js', () => ({
      extension: 'js',
      text: 'const answer = 42',
      url: 'example.js',
    }))

    const element = widget.toDOM(view)

    expect(element.className).toBe('latex-listing-preview')
    expect(element.querySelector('code')?.textContent).toBe(
      'const answer = 42'
    )
  })

  it('finds a file argument on the following line', () => {
    const source = String.raw`\lstinputlisting[language=Python]
{example.py}`
    const state = EditorState.create({ doc: source })
    let commandNode: SyntaxNode | null = null
    parser.parse(source).iterate({
      enter(node) {
        if (node.type.is('UnknownCommand')) {
          commandNode = node.node
          return false
        }
      },
    })

    expect(commandNode).not.toBeNull()
    expect(lstInputListingArgument(commandNode!, state)).toEqual({
      filePath: 'example.py',
      to: source.length,
    })
  })

  it('replaces both lines of a multiline file argument', () => {
    const source = String.raw`before
\lstinputlisting[language=Python]
{example.py}`
    view = new EditorView({
      doc: source,
      parent: document.body,
      extensions: [
        LaTeXLanguage,
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

    expect(view.dom.querySelectorAll('.latex-listing-preview')).toHaveLength(1)
    expect(view.dom.textContent).not.toContain('lstinputlisting')
    expect(view.dom.textContent).not.toContain('{example.py}')

    view.dispatch({
      selection: { anchor: source.indexOf('\\lstinputlisting') + 1 },
    })

    const rawLines = view.dom.querySelectorAll('.ol-cm-lstinputlisting-line')
    expect(rawLines).toHaveLength(2)
    expect(rawLines[0].classList).toContain(
      'ol-cm-lstinputlisting-first-line'
    )
    expect(rawLines[1].classList).toContain(
      'ol-cm-lstinputlisting-last-line'
    )
  })
})

import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { parser } from './lezer-latex/latex.mjs'
import { wrapRanges } from './commands/ranges'
import { parseColumnSpecifications } from './components/table-generator/utils'
import { parseFigureData } from './utils/tree-operations/environments'

describe('vendored Overleaf core', () => {
  it('parses rich and unknown LaTeX without changing source bytes', () => {
    const source = String.raw`\documentclass{article}
\newcommand{\custom}[1]{#1}
\begin{document}
\section{Hello}
\custom{\textbf{world}}
\begin{figure}
\includegraphics[width=.5\linewidth]{images/a.png}
\end{figure}
\end{document}`
    const tree = parser.parse(source)

    expect(tree.length).toBe(source.length)
    expect(source).toContain(String.raw`\custom{\textbf{world}}`)
    expect(tree.toString()).toContain('FigureEnvironment')
  })

  it('keeps malformed incomplete commands parseable', () => {
    const source = String.raw`\section{unfinished`
    expect(parser.parse(source).length).toBe(source.length)
  })

  it('parses bare linewidth graphics width as full line width', () => {
    const source = String.raw`\begin{figure}
\includegraphics[width=\linewidth]{images/a.png}
\end{figure}`
    const state = EditorState.create({ doc: source })
    const tree = parser.parse(source)
    let figureNode = tree.topNode.getChild('FigureEnvironment')
    tree.iterate({
      enter(node) {
        if (node.type.is('FigureEnvironment')) {
          figureNode = node.node
          return false
        }
      },
    })

    expect(figureNode).not.toBeNull()
    expect(parseFigureData(figureNode!, state)?.width).toBe(1)
  })

  it('parses subfigure environments as editable figure data', () => {
    const source = String.raw`\begin{subfigure}{0.45\linewidth}
\includegraphics[width=\linewidth]{images/a.png}
\caption{Panel A}
\label{fig:panel-a}
\end{subfigure}`
    const state = EditorState.create({ doc: source })
    const tree = parser.parse(source)
    let figureNode = tree.topNode.getChild('FigureEnvironment')
    tree.iterate({
      enter(node) {
        if (node.type.is('FigureEnvironment')) {
          figureNode = node.node
          return false
        }
      },
    })

    const figureData = parseFigureData(figureNode!, state)
    expect(figureData?.file.path).toBe('images/a.png')
    expect(figureData?.width).toBe(1)
    expect(figureData?.caption).toEqual({
      from: source.indexOf(String.raw`\caption`),
      to: source.indexOf(String.raw`\label`) - 1,
    })
    expect(figureData?.label).toEqual({
      from: source.indexOf(String.raw`\label`),
      to: source.indexOf(String.raw`\end{subfigure}`) - 1,
    })
  })

  it('wraps only the selected source range', () => {
    const state = EditorState.create({
      doc: 'before selected after',
      selection: { anchor: 7, head: 15 },
    })
    const command = wrapRanges(String.raw`\textbf{`, '}')
    let next = state
    const view = {
      state,
      dispatch: (spec: TransactionSpec, options?: TransactionSpec) => {
        next = state.update(spec, options ?? {}).state
      },
    }

    command(view as never)
    expect(next.doc.toString()).toBe(String.raw`before \textbf{selected} after`)
  })

  it('parses common tabular column specifications', () => {
    expect(parseColumnSpecifications('|l|c|p{2cm}|')).toHaveLength(3)
    expect(parseColumnSpecifications('@{}XXXXX@{}')).toHaveLength(5)
  })
})

import { EditorState, type TransactionSpec } from '@codemirror/state'
import { describe, expect, it } from 'vitest'
import { parser } from './lezer-latex/latex.mjs'
import { wrapRanges } from './commands/ranges'
import { parseColumnSpecifications } from './components/table-generator/utils'

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

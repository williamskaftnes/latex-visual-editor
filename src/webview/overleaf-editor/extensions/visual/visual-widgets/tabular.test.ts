// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { parser } from '../../../lezer-latex/latex.mjs'
import {
  generateTable,
  validateParsedTable,
} from '../../../components/table-generator/utils'
import { TabularWidget, renderTableCellContent } from './tabular'

describe('renderTableCellContent', () => {
  it('renders rich LaTeX formatting instead of raw commands', () => {
    const element = document.createElement('div')

    renderTableCellContent(
      String.raw`\textbf{Bold} and \textit{italic} with \underline{underline}`,
      element
    )

    expect(element.textContent).toBe('Bold and italic with underline')
    expect(element.querySelector('b')?.textContent).toBe('Bold')
    expect(element.querySelector('i')?.textContent).toBe('italic')
    expect(
      element.querySelector('.ol-cm-command-underline')?.textContent
    ).toBe('underline')
  })
})

describe('TabularWidget', () => {
  afterEach(() => {
    document.body.replaceChildren()
  })

  const createWidget = () => {
    const dispatches: unknown[] = []
    const widget = new TabularWidget(
      {
        table: {
          columns: [{}, {}],
          rows: [
            {
              cells: [
                { content: 'first' },
                { content: 'second' },
              ],
            },
          ],
        },
        cellPositions: [[{ from: 0, to: 5 }, { from: 8, to: 14 }]],
        cellSeparators: [[{ from: 5, to: 8 }]],
        rowPositions: [{ from: 0, to: 17, hlines: [] }],
        specification: { from: 20, to: 22 },
      } as never,
      { from: 0 } as never,
      'first & second',
      null,
      false
    )
    const dom = widget.toDOM({
      dispatch(spec?: unknown) {
        dispatches.push(spec)
      },
      requestMeasure() {},
      state: {
        readOnly: false,
        sliceDoc: () => 'lr',
      },
    } as never)
    document.body.append(dom)
    expect(dom.classList.contains('table-generator')).toBe(true)
    return { dom, cells: dom.querySelectorAll('td'), dispatches }
  }

  it('inserts a caret on a single click', () => {
    const { cells } = createWidget()
    cells[0].dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 10,
      })
    )
    cells[0].dispatchEvent(
      new MouseEvent('mouseup', {
        bubbles: true,
        button: 0,
        clientX: 10,
      })
    )

    const input = cells[0].querySelector('textarea')
    expect(input).not.toBeNull()
    expect(document.activeElement).toBe(input)
    expect(input?.selectionStart).toBe('first'.length)
    expect(cells[0].classList.contains('selected')).toBe(false)
  })

  it('selects cells by dragging without native text selection', () => {
    const { cells } = createWidget()
    cells[0].dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
      })
    )
    cells[1].dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        buttons: 1,
        clientX: 10,
        clientY: 0,
      })
    )
    cells[1].dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    expect(cells[0].classList.contains('selected')).toBe(true)
    expect(cells[1].classList.contains('selected')).toBe(true)
    expect(cells[0].classList.contains('selection-edge-left')).toBe(true)
    expect(cells[1].classList.contains('selection-edge-right')).toBe(true)
    expect(document.getSelection()?.rangeCount).toBe(0)

    document.body.tabIndex = -1
    document.body.focus()
    window.dispatchEvent(
      new KeyboardEvent('keydown', {
        ctrlKey: true,
        key: 'a',
      })
    )
    expect([...cells].every(cell => cell.classList.contains('selected'))).toBe(
      true
    )

    document.body.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, button: 0 })
    )
    expect([...cells].some(cell => cell.classList.contains('selected'))).toBe(
      false
    )
  })

  it('deletes selected cells structurally', () => {
    const { cells, dispatches } = createWidget()
    cells[1].dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 0,
        clientY: 0,
      })
    )
    cells[1].dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        buttons: 1,
        clientX: 10,
        clientY: 0,
      })
    )
    cells[1].dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))

    expect(dispatches.at(-1)).toEqual({
      changes: [
        { from: 5, to: 14, insert: '' },
        { from: 20, to: 22, insert: 'l' },
      ],
      userEvent: 'delete',
    })
  })

  it('deletes a column from the example document and keeps a valid table', () => {
    const source = readFileSync('examples/test-document.tex', 'utf8')
    const state = EditorState.create({ doc: source })
    let tabularNode: SyntaxNode | undefined
    parser.parse(source).iterate({
      enter(node) {
        if (node.type.name === 'TabularEnvironment') {
          tabularNode = node.node
        }
      },
    })
    const parsed = generateTable(tabularNode!, state)
    let transaction: { changes: unknown; userEvent: string } | undefined
    const widget = new TabularWidget(
      parsed,
      tabularNode!,
      source.slice(tabularNode!.from, tabularNode!.to),
      null,
      false
    )
    const dom = widget.toDOM({
      dispatch(spec: typeof transaction) {
        if (spec?.changes) transaction = spec
      },
      requestMeasure() {},
      state,
    } as never)
    document.body.append(dom)
    const secondCell = dom.querySelectorAll('tr')[0].querySelectorAll('td')[1]

    secondCell.dispatchEvent(
      new MouseEvent('mousedown', {
        bubbles: true,
        button: 0,
        clientX: 0,
      })
    )
    secondCell.dispatchEvent(
      new MouseEvent('mousemove', {
        bubbles: true,
        buttons: 1,
        clientX: 10,
      })
    )
    secondCell.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, button: 0 })
    )
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }))

    expect(Array.isArray(transaction!.changes)).toBe(true)
    const nextState = state.update({
      changes: transaction!.changes as never,
    }).state
    const nextSource = nextState.doc.toString()
    let nextTabularNode: SyntaxNode | undefined
    parser.parse(nextSource).iterate({
      enter(node) {
        if (node.type.name === 'TabularEnvironment') {
          nextTabularNode = node.node
        }
      },
    })
    const nextParsed = generateTable(nextTabularNode!, nextState)

    expect(validateParsedTable(nextParsed)).toBe(true)
    expect(nextParsed.table.rows).toHaveLength(4)
    expect(nextParsed.table.columns).toHaveLength(1)
    expect(
      nextState.sliceDoc(
        nextParsed.specification.from,
        nextParsed.specification.to
      )
    ).toBe('l')
    expect(nextParsed.table.rows[1].cells.map(cell => cell.content.trim())).toEqual([
      'Headings',
    ])
  })
})

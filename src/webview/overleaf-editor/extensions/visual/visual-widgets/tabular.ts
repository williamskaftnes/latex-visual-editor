import { EditorView, WidgetType } from '@codemirror/view'
import { redo, undo } from '@codemirror/commands'
import { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import {
  parseColumnSpecifications,
  generateTable,
  validateParsedTable,
  type ParsedTableData,
} from '../../../components/table-generator/utils'
import { parser } from '../../../lezer-latex/latex.mjs'
import { loadMathJax } from '../../../../mathjax/load-mathjax'
import { typesetNodeIntoElement } from '../utils/typeset-content'

/**
 * Renders one table cell with Overleaf's rich LaTeX typesetter.
 */
export function renderTableCellContent(
  source: string,
  element: HTMLElement
): void {
  element.replaceChildren()
  const tree = parser.parse(source)
  const state = EditorState.create({ doc: source })
  let renderedNestedTable = false

  tree.iterate({
    enter(nodeRef) {
      if (renderedNestedTable) return false
      if (nodeRef.type.name !== 'TabularEnvironment') return

      try {
        const parsed = generateTable(nodeRef.node, state)
        if (!validateParsedTable(parsed)) return

        renderStaticTable(parsed, element)
        renderedNestedTable = true
        return false
      } catch {
        return
      }
    },
  })

  if (renderedNestedTable) return

  typesetNodeIntoElement(
    tree.topNode,
    element,
    source.substring.bind(source)
  )
}

function renderStaticTable(
  parsedTableData: ParsedTableData,
  element: HTMLElement
) {
  const table = document.createElement('table')
  table.className = 'latex-visual-table latex-visual-nested-table'

  parsedTableData.table.rows.forEach(row => {
    const tableRow = document.createElement('tr')
    row.cells.forEach(cell => {
      const tableCell = document.createElement('td')
      if (cell.multiColumn) tableCell.colSpan = cell.multiColumn.columnSpan
      renderTableCellContent(cell.content, tableCell)
      tableRow.append(tableCell)
    })
    table.append(tableRow)
  })

  element.append(table)
}

type TableCoordinate = {
  row: number
  column: number
}

const DRAG_THRESHOLD_PX = 4

const generateColumnSpecification = (
  columns: ReturnType<typeof parseColumnSpecifications>
) =>
  columns
    .map(
      column =>
        `${'|'.repeat(column.borderLeft)}${column.cellSpacingLeft}${
          column.customCellDefinition
        }${column.content}${column.cellSpacingRight}${'|'.repeat(
          column.borderRight
        )}`
    )
    .join('')

/**
 * Renders Overleaf's parsed table data as an editable HTML table.
 */
export class TabularWidget extends WidgetType {
  private static cleanup = new WeakMap<HTMLElement, () => void>()
  private static activeTable: HTMLElement | null = null

  constructor(
    private parsedTableData: ParsedTableData,
    private tabularNode: SyntaxNode,
    private content: string,
    private tableNode: SyntaxNode | null,
    private isDirectChildOfTableEnvironment: boolean
  ) {
    super()
  }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'ol-cm-tabular table-generator'
    if (this.tableNode) wrapper.classList.add('ol-cm-environment-table')

    const table = document.createElement('table')
    table.className = 'latex-visual-table'
    const cells: Array<{
      element: HTMLTableCellElement
      row: number
      fromColumn: number
      toColumn: number
    }> = []
    let anchor: TableCoordinate | null = null
    let selectionEnd: TableCoordinate | null = null
    let dragging = false
    let pointerStart:
      | {
          x: number
          y: number
      row: number
      fromColumn: number
      toColumn: number
      cell: HTMLTableCellElement
    }
  | null = null

    const selectTo = (to: TableCoordinate) => {
      if (!anchor) return
      selectionEnd = to
      const minRow = Math.min(anchor.row, to.row)
      const maxRow = Math.max(anchor.row, to.row)
      const minColumn = Math.min(anchor.column, to.column)
      const maxColumn = Math.max(anchor.column, to.column)

      for (const cell of cells) {
        const selected =
          cell.row >= minRow &&
          cell.row <= maxRow &&
          cell.toColumn >= minColumn &&
          cell.fromColumn <= maxColumn
        cell.element.classList.toggle('selected', selected)
        cell.element.classList.toggle(
          'selection-edge-top',
          selected && cell.row === minRow
        )
        cell.element.classList.toggle(
          'selection-edge-bottom',
          selected && cell.row === maxRow
        )
        cell.element.classList.toggle(
          'selection-edge-left',
          selected && cell.fromColumn <= minColumn
        )
        cell.element.classList.toggle(
          'selection-edge-right',
          selected && cell.toColumn >= maxColumn
        )
      }
    }

    const selectionBounds = () => {
      if (!anchor || !selectionEnd) return null
      return {
        minRow: Math.min(anchor.row, selectionEnd.row),
        maxRow: Math.max(anchor.row, selectionEnd.row),
        minColumn: Math.min(anchor.column, selectionEnd.column),
        maxColumn: Math.max(anchor.column, selectionEnd.column),
      }
    }

    const clearSelection = () => {
      anchor = null
      selectionEnd = null
      dragging = false
      for (const cell of cells) {
        cell.element.classList.remove(
          'selected',
          'selection-edge-top',
          'selection-edge-bottom',
          'selection-edge-left',
          'selection-edge-right'
        )
      }
      if (TabularWidget.activeTable === wrapper) {
        TabularWidget.activeTable = null
      }
    }

    const selectionIsActive = () =>
      TabularWidget.activeTable === wrapper && Boolean(selectionBounds())

    const selectedText = () => {
      const bounds = selectionBounds()
      if (!bounds) return ''
      const content: string[] = []
      for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
        const rowContent = cells
          .filter(
            cell =>
              cell.row === row &&
              cell.toColumn >= bounds.minColumn &&
              cell.fromColumn <= bounds.maxColumn
          )
          .map(cell => {
            const rowCells = cells.filter(candidate => candidate.row === row)
            const cellIndex = rowCells.indexOf(cell)
            return (
              this.parsedTableData.table.rows[row]?.cells[cellIndex]?.content ??
              ''
            )
          })
        content.push(rowContent.join('\t'))
      }
      return content.join('\n')
    }

    const pasteText = (data: string) => {
      const bounds = selectionBounds()
      if (!bounds || !data || view.state.readOnly) return
      const pastedRows = data.replace(/\r/g, '').split('\n')
      const changes: Array<{ from: number; to: number; insert: string }> = []

      pastedRows.forEach((pastedRow, rowOffset) => {
        const rowIndex = bounds.minRow + rowOffset
        if (rowIndex >= this.parsedTableData.table.rows.length) return
        const values = pastedRow.split('\t')
        const targetCells = cells.filter(
          cell => cell.row === rowIndex && cell.toColumn >= bounds.minColumn
        )
        values.forEach((value, columnOffset) => {
          const target = targetCells[columnOffset]
          if (!target) return
          const cellIndex = cells
            .filter(cell => cell.row === rowIndex)
            .indexOf(target)
          const position =
            this.parsedTableData.cellPositions[rowIndex]?.[cellIndex]
          if (position) changes.push({ ...position, insert: value })
        })
      })

      if (changes.length) {
        view.dispatch({ changes, userEvent: 'input.paste' })
      }
    }

    const deleteSelectedCells = () => {
      const bounds = selectionBounds()
      if (!bounds || view.state.readOnly) return
      const changes: Array<{ from: number; to: number; insert: string }> = []
      const rowCount = this.parsedTableData.table.rows.length
      const columnCount = this.parsedTableData.table.columns.length
      const removesWholeRows =
        bounds.minColumn === 0 && bounds.maxColumn >= columnCount - 1

      if (removesWholeRows) {
        if (bounds.minRow === 0 && bounds.maxRow >= rowCount - 1) {
          const firstRow = this.parsedTableData.rowPositions[0]
          const lastRow = this.parsedTableData.rowPositions.at(-1)!
          changes.push({ from: firstRow.from, to: lastRow.to, insert: '' })
        } else {
          for (let row = bounds.minRow; row <= bounds.maxRow; row++) {
            changes.push({
              ...this.parsedTableData.rowPositions[row],
              insert: '',
            })
          }
        }
      } else {
        for (let row = 0; row < rowCount; row++) {
          const rowCells = cells.filter(candidate => candidate.row === row)
          const selected = rowCells.filter(
            cell =>
              cell.toColumn >= bounds.minColumn &&
              cell.fromColumn <= bounds.maxColumn
          )
          if (!selected.length) continue
          const firstIndex = rowCells.indexOf(selected[0])
          const lastIndex = rowCells.indexOf(selected.at(-1)!)
          const firstPosition =
            this.parsedTableData.cellPositions[row][firstIndex]
          const lastPosition =
            this.parsedTableData.cellPositions[row][lastIndex]
          const separators = this.parsedTableData.cellSeparators[row]

          if (firstIndex === 0) {
            changes.push({
              from: firstPosition.from,
              to: separators[lastIndex].to,
              insert: '',
            })
          } else {
            changes.push({
              from: separators[firstIndex - 1].from,
              to: lastPosition.to,
              insert: '',
            })
          }
        }

        const specification = view.state.sliceDoc(
          this.parsedTableData.specification.from,
          this.parsedTableData.specification.to
        )
        const columns = parseColumnSpecifications(specification).filter(
          (_, column) =>
            column < bounds.minColumn || column > bounds.maxColumn
        )
        changes.push({
          from: this.parsedTableData.specification.from,
          to: this.parsedTableData.specification.to,
          insert: generateColumnSpecification(columns),
        })
      }

      if (changes.length) {
        clearSelection()
        view.dispatch({ changes, userEvent: 'delete' })
      }
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectionIsActive()) return
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault()
        event.stopPropagation()
        deleteSelectedCells()
        return
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return
      const key = event.key.toLowerCase()

      if (key === 'a') {
        event.preventDefault()
        event.stopPropagation()
        anchor = { row: 0, column: 0 }
        const lastRow = this.parsedTableData.table.rows.length - 1
        const lastColumn =
          cells
            .filter(cell => cell.row === lastRow)
            .at(-1)?.toColumn ?? 0
        selectTo({ row: lastRow, column: lastColumn })
      } else if (key === 'c') {
        event.preventDefault()
        event.stopPropagation()
        void navigator.clipboard.writeText(selectedText())
      } else if (key === 'v' && !view.state.readOnly) {
        event.preventDefault()
        event.stopPropagation()
        void navigator.clipboard.readText().then(pasteText)
      } else if (key === 'z') {
        event.preventDefault()
        event.stopPropagation()
        if (event.shiftKey) {
          redo(view)
        } else {
          undo(view)
        }
      } else if (key === 'y') {
        event.preventDefault()
        event.stopPropagation()
        redo(view)
      }
    }

    const onCopy = (event: ClipboardEvent) => {
      if (!selectionIsActive()) return
      event.preventDefault()
      event.stopPropagation()
      const text = selectedText()
      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', text)
      } else {
        void navigator.clipboard.writeText(text)
      }
    }

    const onPaste = (event: ClipboardEvent) => {
      if (!selectionIsActive()) return
      const data = event.clipboardData?.getData('text/plain')
      if (!data || view.state.readOnly) return
      event.preventDefault()
      event.stopPropagation()
      pasteText(data)
    }

    const onWindowMouseDown = (event: MouseEvent) => {
      if (wrapper.contains(event.target as Node)) {
        TabularWidget.activeTable = wrapper
        view.dispatch()
      } else if (selectionBounds()) {
        clearSelection()
      }
    }

    const onWindowMouseUp = () => {
      pointerStart = null
      dragging = false
    }

    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('copy', onCopy, true)
    window.addEventListener('paste', onPaste, true)
    window.addEventListener('mousedown', onWindowMouseDown)
    window.addEventListener('mouseup', onWindowMouseUp)
    TabularWidget.cleanup.set(wrapper, () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('copy', onCopy, true)
      window.removeEventListener('paste', onPaste, true)
      window.removeEventListener('mousedown', onWindowMouseDown)
      window.removeEventListener('mouseup', onWindowMouseUp)
      if (TabularWidget.activeTable === wrapper) {
        TabularWidget.activeTable = null
      }
    })

    this.parsedTableData.table.rows.forEach((row, rowIndex) => {
      const tr = table.insertRow()
      let logicalColumn = 0
      row.cells.forEach((cell, cellIndex) => {
        const td = tr.insertCell()
        td.className = 'table-generator-cell'
        td.tabIndex = rowIndex * row.cells.length + cellIndex + 1
        const columnSpan = cell.multiColumn?.columnSpan ?? 1
        const fromColumn = logicalColumn
        const toColumn = logicalColumn + columnSpan - 1
        logicalColumn += columnSpan
        cells.push({ element: td, row: rowIndex, fromColumn, toColumn })
        const source = cell.content.trim()
        const renderedContent = document.createElement('div')
        renderedContent.className = 'table-generator-cell-render'
        renderTableCellContent(source, renderedContent)
        td.append(renderedContent)
        td.colSpan = columnSpan

        void loadMathJax()
          .then(async MathJax => {
            if (!renderedContent.isConnected) return
            await MathJax.typesetPromise([renderedContent])
            view.requestMeasure()
            MathJax.typesetClear([renderedContent])
          })
          .catch(() => {})

        const startEditing = () => {
          if (view.state.readOnly) return
          clearSelection()
          const renderedHeight = Math.max(
            renderedContent.getBoundingClientRect().height,
            renderedContent.scrollHeight
          )
          const input = document.createElement('textarea')
          input.className = 'table-generator-cell-input'
          input.value = source
          td.replaceChildren(input)
          input.style.height = `${Math.max(renderedHeight, input.scrollHeight)}px`
          input.setSelectionRange(source.length, source.length)
          input.focus()

          let cancelled = false
          input.addEventListener('keydown', event => {
            if (event.key === 'Escape') {
              cancelled = true
              renderTableCellContent(source, renderedContent)
              td.replaceChildren(renderedContent)
              view.focus()
            }
          })
          input.addEventListener('input', () => {
            input.style.height = '1px'
            input.style.height = `${input.scrollHeight}px`
          })
          input.addEventListener('blur', () => {
            if (cancelled || input.value === source) {
              if (!cancelled) {
                renderTableCellContent(source, renderedContent)
                td.replaceChildren(renderedContent)
              }
              return
            }

            const position =
              this.parsedTableData.cellPositions[rowIndex]?.[cellIndex]
            if (!position) return
            view.dispatch({
              changes: {
                from: position.from,
                to: position.to,
                insert: input.value,
              },
              userEvent: 'input',
            })
          })
        }

        td.addEventListener('mousedown', event => {
          if (event.button !== 0 || event.target instanceof HTMLTextAreaElement) {
            return
          }

          event.preventDefault()
          document.getSelection()?.removeAllRanges()
          TabularWidget.activeTable = wrapper
          pointerStart = {
            x: event.clientX,
            y: event.clientY,
        row: rowIndex,
        fromColumn,
        toColumn,
        cell: td,
      }
        })

        td.addEventListener('mousemove', event => {
          if (!pointerStart || event.buttons !== 1) return
          if (!dragging) {
            const distance = Math.hypot(
              event.clientX - pointerStart.x,
              event.clientY - pointerStart.y
            )
            if (distance < DRAG_THRESHOLD_PX && td === pointerStart.cell) return
            dragging = true
            anchor = {
              row: pointerStart.row,
              column: pointerStart.fromColumn,
            }
            selectTo({
              row: pointerStart.row,
              column: pointerStart.toColumn,
            })
          }
          event.preventDefault()
          document.getSelection()?.removeAllRanges()
          selectTo({ row: rowIndex, column: toColumn })
        })

        td.addEventListener('mouseup', event => {
          if (!pointerStart || event.button !== 0) return
          const wasDragging = dragging
          pointerStart = null
          dragging = false
          if (!wasDragging) {
            startEditing()
          }
        })
      })
    })
    wrapper.append(table)
    return wrapper
  }

  eq(widget: TabularWidget): boolean {
    return (
      this.tabularNode.from === widget.tabularNode.from &&
      this.tableNode?.from === widget.tableNode?.from &&
      this.tableNode?.to === widget.tableNode?.to &&
      this.content === widget.content &&
      this.isDirectChildOfTableEnvironment ===
        widget.isDirectChildOfTableEnvironment
    )
  }

  ignoreEvent(): boolean {
    return true
  }

  destroy(element: HTMLElement): void {
    TabularWidget.cleanup.get(element)?.()
    TabularWidget.cleanup.delete(element)
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect()
  }

  get estimatedHeight(): number {
    return this.parsedTableData.table.rows.length * 44
  }
}

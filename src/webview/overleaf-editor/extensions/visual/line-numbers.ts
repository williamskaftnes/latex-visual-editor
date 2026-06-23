import { EditorSelection } from '@codemirror/state'
import {
  EditorView,
  GutterMarker,
  lineNumberWidgetMarker,
  lineNumbers,
} from '@codemirror/view'
import type { BlockInfo } from '@codemirror/view'
import { LstInputListingWidget } from './visual-widgets/lstinputlisting'

let dragListener: ((event: MouseEvent) => void) | undefined
let dragMouseUpListener: (() => void) | undefined

function stopLineNumberDrag(): void {
  if (dragListener) document.removeEventListener('mousemove', dragListener)
  if (dragMouseUpListener) {
    document.removeEventListener('mouseup', dragMouseUpListener)
  }
  dragListener = undefined
  dragMouseUpListener = undefined
}

class WidgetLineNumberMarker extends GutterMarker {
  constructor(readonly lineNumber: number) {
    super()
  }

  eq(other: WidgetLineNumberMarker): boolean {
    return this.lineNumber === other.lineNumber
  }

  toDOM(): Node {
    return document.createTextNode(String(this.lineNumber))
  }
}

/**
 * Displays source line numbers for visual block widgets and lets a primary
 * gutter click select the corresponding source line.
 */
export const visualLineNumbers = [
  lineNumbers({
    domEventHandlers: {
      mousedown(view, block, event) {
        const mouseEvent = event as MouseEvent
        if (mouseEvent.button !== 0) return false

        event.preventDefault()
        stopLineNumberDrag()
        selectDocumentLines(view, block, block)
        view.contentDOM.focus()

        dragListener = moveEvent => {
          if (moveEvent.buttons !== 1) {
            stopLineNumberDrag()
            return
          }
          const position = view.posAtCoords({
            x: moveEvent.clientX,
            y: moveEvent.clientY,
          })
          if (position !== null) {
            selectDocumentLines(view, block, view.lineBlockAt(position))
          }
        }
        dragMouseUpListener = stopLineNumberDrag
        document.addEventListener('mousemove', dragListener)
        document.addEventListener('mouseup', dragMouseUpListener, { once: true })
        return true
      },
      mouseup() {
        stopLineNumberDrag()
        return false
      },
    },
  }),
  lineNumberWidgetMarker.of((view, widget, block) =>
    widget instanceof LstInputListingWidget
      ? new WidgetLineNumberMarker(view.state.doc.lineAt(block.from).number)
      : null
  ),
  EditorView.baseTheme({
    '.cm-lineNumbers .cm-gutterElement': {
      cursor: 'default',
      userSelect: 'none',
    },
  }),
]

export function selectDocumentLine(view: EditorView, position: number): void {
  const line = view.state.doc.lineAt(position)
  selectDocumentRange(view, line.from, line.to)
}

export function selectDocumentLines(
  view: EditorView,
  start: Pick<BlockInfo, 'from' | 'to'>,
  end: Pick<BlockInfo, 'from' | 'to'>
): void {
  if (start.from === end.from) {
    selectDocumentRange(view, start.to, start.from)
  } else if (end.from < start.from) {
    selectDocumentRange(view, start.to, end.from)
  } else {
    selectDocumentRange(view, start.from, end.to)
  }
}

function selectDocumentRange(
  view: EditorView,
  anchor: number,
  head: number
): void {
  const includeTrailingNewline = (position: number) =>
    Math.min(view.state.doc.length, position + 1)
  const backwards = anchor > head
  view.dispatch({
    selection: EditorSelection.range(
      backwards ? includeTrailingNewline(anchor) : anchor,
      backwards ? head : includeTrailingNewline(head)
    ),
    scrollIntoView: true,
    userEvent: 'select.pointer',
  })
}

import {
  bracketMatching as bracketMatchingExtension,
  matchBrackets,
} from '@codemirror/language'
import { EditorSelection, type Extension, type SelectionRange } from '@codemirror/state'
import { Decoration, EditorView } from '@codemirror/view'

const matchingMark = Decoration.mark({ class: 'cm-matchingBracket' })
const nonmatchingMark = Decoration.mark({ class: 'cm-nonmatchingBracket' })

export const bracketMatching = (): Extension => [
  bracketMatchingExtension({
    renderMatch(match) {
      const mark = match.matched ? matchingMark : nonmatchingMark
      const decorations = [mark.range(match.start.from, match.start.to)]
      if (match.end) decorations.push(mark.range(match.end.from, match.end.to))
      return decorations
    },
  }),
  EditorView.domEventHandlers({
    dblclick(event, view) {
      const position = view.posAtCoords({ x: event.clientX, y: event.clientY })
      if (position === null) return false
      const selection = bracketSelectionAt(view, position)
      if (!selection) return false
      event.preventDefault()
      view.dispatch({ selection, userEvent: 'select.pointer' })
      return true
    },
  }),
  EditorView.baseTheme({
    '.cm-matchingBracket': { pointerEvents: 'none' },
  }),
]

export function bracketSelectionAt(
  view: EditorView,
  position: number
): SelectionRange | null {
  const search = (position: number, direction: 1 | -1) => {
    const match = matchBrackets(view.state, position, direction, {
      maxScanDistance: 0,
    })
    return match?.matched && match.end
      ? EditorSelection.range(
          Math.min(match.start.from, match.end.from),
          Math.max(match.start.to, match.end.to)
        )
      : null
  }

  const forwardsOutside = search(position - 1, 1)
  if (forwardsOutside) {
    return EditorSelection.range(forwardsOutside.from + 1, forwardsOutside.to - 1)
  }
  return (
    search(position, 1) ??
    search(position, -1) ??
    (() => {
      const backwardsOutside = search(position + 1, -1)
      return backwardsOutside
        ? EditorSelection.range(backwardsOutside.from + 1, backwardsOutside.to - 1)
        : null
    })()
  )
}

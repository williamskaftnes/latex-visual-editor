import type { EditorState } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'

export const lstInputListingArgument = (
  commandNode: SyntaxNode,
  state: EditorState
): { filePath: string; to: number } | null => {
  const longArgument = commandNode
    .getChild('TextArgument')
    ?.getChild('LongArg')
  if (longArgument) {
    return {
      filePath: state.sliceDoc(longArgument.from, longArgument.to).trim(),
      to: commandNode.to,
    }
  }

  const commandContainer = commandNode.parent
  let sibling = commandContainer?.nextSibling
  while (commandContainer && sibling) {
    if (!/^\s*$/.test(state.sliceDoc(commandContainer.to, sibling.from))) {
      return null
    }
    if (sibling.type.is('Group')) {
      const openBrace = sibling.getChild('OpenBrace')
      const closeBrace = sibling.getChild('CloseBrace')
      if (openBrace && closeBrace) {
        return {
          filePath: state.sliceDoc(openBrace.to, closeBrace.from).trim(),
          to: sibling.to,
        }
      }
      return null
    }
    if (!/^\s*$/.test(state.sliceDoc(sibling.from, sibling.to))) {
      return null
    }
    sibling = sibling.nextSibling
  }
  return null
}

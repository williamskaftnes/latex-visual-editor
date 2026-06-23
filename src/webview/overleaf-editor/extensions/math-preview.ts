import { EditorState, StateField } from '@codemirror/state'
import { EditorView, showTooltip, type Tooltip } from '@codemirror/view'
import { loadMathJax } from '../../mathjax/load-mathjax'
import { descendantsOfNodeWithType } from '../utils/tree-operations/ancestors'
import {
  mathAncestorNode,
  parseMathContainer,
  type MathContainer,
} from '../utils/tree-operations/math'

export const mathPreview = [
  StateField.define<Tooltip | null>({
    create: buildMathTooltip,
    update(value, transaction) {
      return transaction.docChanged || transaction.selection
        ? buildMathTooltip(transaction.state)
        : value
    },
    provide: field => showTooltip.compute([field], state => state.field(field)),
  }),
  EditorView.baseTheme({
    '.latex-math-preview-container': {
      position: 'relative',
      overflow: 'visible',
      border: '0',
      background: 'transparent',
    },
    '.latex-math-preview': {
      boxSizing: 'border-box',
      maxWidth: 'min(800px, 80vw)',
      maxHeight: '200px',
      overflow: 'auto',
      padding: '10px 14px',
      color: 'var(--vscode-editorHoverWidget-foreground)',
      background: 'var(--vscode-editorHoverWidget-background)',
      border: '1px solid var(--vscode-editorHoverWidget-border)',
      borderRadius: '4px',
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.25)',
    },
    '.latex-math-preview-error': {
      color: 'var(--vscode-errorForeground)',
      fontFamily: 'var(--source-font-family)',
    },
  }),
]

export function mathContainerAtCursor(state: EditorState): MathContainer | null {
  const range = state.selection.main
  if (!range.empty) return null

  const ancestor = mathAncestorNode(state, range.head)
  if (!ancestor) return null
  const math = descendantsOfNodeWithType(ancestor, 'Math', 'Math')[0]
  if (!math) return null

  const container = parseMathContainer(state, math, ancestor)
  return container?.passToMathJax ? container : null
}

function buildMathTooltip(state: EditorState): Tooltip | null {
  const math = mathContainerAtCursor(state)
  if (!math?.content) return null

  return {
    pos: math.pos,
    above: true,
    strictSide: false,
    create(view) {
      const container = document.createElement('div')
      container.className = 'latex-math-preview-container'
      const preview = document.createElement('div')
      preview.className = 'latex-math-preview'
      preview.setAttribute('role', 'status')
      preview.setAttribute('aria-label', 'Math preview')
      preview.textContent = math.content
      container.append(preview)

      void renderMathPreview(math, preview, view)
      return { dom: container, overlap: true, offset: { x: 0, y: 8 } }
    },
  }
}

async function renderMathPreview(
  math: MathContainer,
  preview: HTMLElement,
  view: EditorView
): Promise<void> {
  try {
    const MathJax = await loadMathJax()
    if (!preview.isConnected) return
    MathJax.texReset([0])
    const rendered = await MathJax.tex2svgPromise(math.content, {
      ...MathJax.getMetricsFor(preview, math.displayMode),
      display: math.displayMode,
    })
    if (!preview.isConnected) return
    preview.replaceChildren(rendered)
    view.requestMeasure()
  } catch {
    if (!preview.isConnected) return
    preview.classList.add('latex-math-preview-error')
    preview.textContent = 'Unable to preview this equation.'
  }
}

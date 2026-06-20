import { EditorView, WidgetType } from '@codemirror/view'
import { placeSelectionInsideBlock } from '../selection'
import type { PreviewPath } from '../../../../adapters/previewPath'

const MAX_VISIBLE_LINES = 80

/**
 * Displays the contents referenced by \lstinputlisting.
 */
export class LstInputListingWidget extends WidgetType {
  readonly previewKey: string

  constructor(
    public filePath: string,
    public previewByPath: (path: string) => PreviewPath | null
  ) {
    super()
    const preview = this.previewByPath(this.filePath)
    this.previewKey = preview ? `${preview.extension}:${preview.text ?? ''}` : ''
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement('figure')
    element.className = 'latex-listing-preview'
    element.dataset.filepath = this.filePath

    element.append(this.createBody())
    this.loadTextFallback(element, view)
    element.addEventListener('mouseup', event => {
      event.preventDefault()
      view.dispatch(placeSelectionInsideBlock(view, event))
    })
    return element
  }

  eq(widget: LstInputListingWidget): boolean {
    return (
      widget.filePath === this.filePath &&
      widget.previewKey === this.previewKey
    )
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    if (element.dataset.filepath === this.filePath) {
      element.replaceChild(this.createBody(), element.lastElementChild!)
      this.loadTextFallback(element, view)
      return true
    }
    return false
  }

  ignoreEvent(event: Event): boolean {
    return event.type !== 'mouseup'
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect()
  }

  get estimatedHeight(): number {
    return 220
  }

  private createBody(): HTMLElement {
    const preview = this.previewByPath(this.filePath)
    if (!preview) {
      return this.createMessage('Loading listing preview...')
    }

    if (preview.text === undefined) {
      return this.createMessage('Loading listing preview...')
    }

    return this.createSource(preview.text)
  }

  private createSource(text: string): HTMLElement {
    const source = document.createElement('pre')
    source.className = 'latex-listing-preview-source'
    const code = document.createElement('code')
    const lines = text.replace(/\r\n?/g, '\n').split('\n')
    const visibleLines = lines.slice(0, MAX_VISIBLE_LINES)
    code.textContent = visibleLines.join('\n')
    source.append(code)

    if (lines.length > MAX_VISIBLE_LINES) {
      const overflow = document.createElement('div')
      overflow.className = 'latex-listing-preview-overflow'
      overflow.textContent = `${lines.length - MAX_VISIBLE_LINES} more lines`
      source.append(overflow)
    }

    return source
  }

  private loadTextFallback(element: HTMLElement, view: EditorView): void {
    const preview = this.previewByPath(this.filePath)
    if (!preview || preview.text !== undefined) return

    const requestedPath = this.filePath
    fetch(preview.url)
      .then(response => {
        if (!response.ok) {
          throw new Error(`Failed to fetch ${requestedPath}`)
        }
        return response.text()
      })
      .then(text => {
        if (element.dataset.filepath !== requestedPath) return
        element.replaceChild(this.createSource(text), element.lastElementChild!)
        view.requestMeasure()
      })
      .catch(() => {
        if (element.dataset.filepath !== requestedPath) return
        element.replaceChild(
          this.createMessage(
            view.state.phrase('the_visual_editor_cant_preview_this_listing_file')
          ),
          element.lastElementChild!
        )
        view.requestMeasure()
      })
  }

  private createMessage(message: string): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'latex-listing-preview-message'
    wrapper.textContent = message
    return wrapper
  }
}

import { EditorView, WidgetType } from '@codemirror/view'
import { placeSelectionInsideBlock } from '../selection'
import { isEqual } from 'lodash'
import { FigureData } from '../../figure-modal'
import type { PreviewPath } from '../../../../adapters/previewPath'
import type { PDFDocumentProxy } from '../../../../pdf/pdf-js'

const pendingPdfDestroys = new Set<Promise<unknown>>()

export function schedulePdfDestroy(pdf: PDFDocumentProxy): void {
  const task = pdf.destroy().catch(() => undefined)
  pendingPdfDestroys.add(task)
  task.finally(() => pendingPdfDestroys.delete(task))
}

async function waitForPendingPdfDestroys(): Promise<void> {
  while (pendingPdfDestroys.size > 0) {
    await Promise.all(pendingPdfDestroys)
  }
}

/**
 * Displays a workspace graphics resource resolved by the VS Code host.
 */
export class GraphicsWidget extends WidgetType {
  destroyed = false
  height = 300
  pdfInstance: PDFDocumentProxy | null = null
  readonly previewKey: string

  constructor(
    public filePath: string,
    public previewByPath: (path: string) => PreviewPath | null,
    public centered: boolean,
    public figureData: FigureData | null
  ) {
    super()
    const preview = this.previewByPath(this.filePath)
    this.previewKey = preview ? `${preview.extension}:${preview.url}` : ''
  }

  toDOM(view: EditorView): HTMLElement {
    this.destroyed = false
    const element = document.createElement('div')
    element.classList.add('ol-cm-environment-figure', 'ol-cm-environment-line')
    element.classList.toggle('ol-cm-environment-centered', this.centered)
    this.renderGraphic(element, view)
    element.addEventListener('mouseup', event => {
      event.preventDefault()
      view.dispatch(placeSelectionInsideBlock(view, event))
    })
    return element
  }

  eq(widget: GraphicsWidget): boolean {
    return (
      widget.filePath === this.filePath &&
      widget.centered === this.centered &&
      widget.previewKey === this.previewKey &&
      isEqual(this.figureData, widget.figureData)
    )
  }

  updateDOM(element: HTMLElement, view: EditorView): boolean {
    this.destroyed = false
    element.classList.toggle('ol-cm-environment-centered', this.centered)
    const preview = this.previewByPath(this.filePath)
    if (
      this.filePath === element.dataset.filepath &&
      element.dataset.width === String(this.figureData?.width) &&
      element.dataset.previewUrl === (preview?.url ?? '')
    ) {
      return true
    }
    if (this.pdfInstance) {
      schedulePdfDestroy(this.pdfInstance)
      this.pdfInstance = null
    }
    this.renderGraphic(element, view)
    view.requestMeasure()
    return true
  }

  ignoreEvent(event: Event): boolean {
    return (
      event.type !== 'mouseup' &&
      !(
        event.target instanceof HTMLElement &&
        event.target.closest('.ol-cm-graphics-edit-button')
      )
    )
  }

  destroy(): void {
    this.destroyed = true
    if (this.pdfInstance) {
      schedulePdfDestroy(this.pdfInstance)
      this.pdfInstance = null
    }
  }

  coordsAt(element: HTMLElement): DOMRect {
    return element.getBoundingClientRect()
  }

  get estimatedHeight(): number {
    return this.height
  }

  /**
   * Rebuilds the image preview for the current graphics path.
   */
  renderGraphic(element: HTMLElement, view: EditorView): void {
    element.replaceChildren()
    const preview = this.previewByPath(this.filePath)
    element.dataset.filepath = this.filePath
    element.dataset.width = String(this.figureData?.width)
    element.dataset.previewUrl = preview?.url ?? ''

    if (!preview) {
      element.append(this.createErrorElement(view))
      return
    }

    if (preview.extension.toLowerCase() === 'pdf') {
      const canvas = document.createElement('canvas')
      canvas.className = 'ol-cm-graphics ol-cm-graphics-loading'
      this.renderPDF(view, canvas, preview.url).catch(() => {
        if (!this.destroyed) {
          element.replaceChildren(this.createErrorElement(view))
          view.requestMeasure()
        }
      })
      element.append(canvas)
      return
    }

    const image = document.createElement('img')
    image.className = 'ol-cm-graphics ol-cm-graphics-loading'
    image.src = preview.url
    const width = this.figureData?.width
      ? `min(100%, ${this.figureData.width * 100}%)`
      : ''
    image.style.width = width
    image.style.maxWidth = width
    image.addEventListener('load', () => {
      image.classList.remove('ol-cm-graphics-loading')
      this.height = image.height
      view.requestMeasure()
    })
    image.addEventListener('error', () => {
      element.replaceChildren(this.createErrorElement(view))
      view.requestMeasure()
    })
    element.append(image)
  }

  async renderPDF(
    view: EditorView,
    canvas: HTMLCanvasElement,
    url: string
  ): Promise<void> {
    const { loadPdfDocumentFromUrl } = await import('../../../../pdf/pdf-js')
    if (this.destroyed) return

    await waitForPendingPdfDestroys()
    if (this.destroyed) return

    const pdf = await loadPdfDocumentFromUrl(url)
    this.pdfInstance = pdf
    if (this.destroyed) {
      schedulePdfDestroy(pdf)
      this.pdfInstance = null
      return
    }

    const page = await pdf.getPage(1)
    if (this.destroyed) return

    const viewport = page.getViewport({ scale: 1 })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const width = this.figureData?.width
      ? `min(100%, ${this.figureData.width * 100}%)`
      : ''
    canvas.style.width = width
    canvas.style.maxWidth = width

    await page.render({
      canvasContext: canvas.getContext('2d')!,
      viewport,
    }).promise

    canvas.classList.remove('ol-cm-graphics-loading')
    this.height = canvas.getBoundingClientRect().height || viewport.height
    view.requestMeasure()
  }

  /**
   * Creates a localized preview error.
   */
  createErrorElement(view: EditorView): HTMLElement {
    const wrapper = document.createElement('div')
    wrapper.className = 'ol-cm-graphics-loading-error'
    const title = document.createElement('strong')
    title.textContent = view.state.phrase(
      'the_visual_editor_cant_preview_this_type_of_image_file'
    )
    const path = document.createElement('span')
    path.textContent = this.filePath
    wrapper.append(title, path)
    return wrapper
  }
}

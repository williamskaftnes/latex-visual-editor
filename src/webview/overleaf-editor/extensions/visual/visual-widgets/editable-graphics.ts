import { EditorView } from '@codemirror/view'
import { GraphicsWidget, schedulePdfDestroy } from './graphics'
import { editFigureDataEffect } from '../../figure-modal'
import { materialIcon } from '../../../../adapters/materialIcon'

export class EditableGraphicsWidget extends GraphicsWidget {
  setEditDispatcher(button: HTMLButtonElement, view: EditorView) {
    button.classList.toggle('hidden', !this.figureData)
    if (this.figureData) {
      button.onmousedown = event => {
        event.preventDefault()
        event.stopImmediatePropagation()
        view.dispatch({ effects: editFigureDataEffect.of(this.figureData) })
        window.dispatchEvent(new CustomEvent('figure-modal:open-modal'))
        return false
      }
    } else {
      button.onmousedown = null
    }
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
      // Figure remained the same, so just update the event listener on the button
      const button = element.querySelector<HTMLButtonElement>(
        '.ol-cm-graphics-edit-button'
      )
      if (button) {
        this.setEditDispatcher(button, view)
      }
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

  coordsAt(element: HTMLElement) {
    return element.getBoundingClientRect()
  }

  createEditButton(view: EditorView) {
    const button = document.createElement('button')
    button.setAttribute('aria-label', view.state.phrase('edit_figure'))
    this.setEditDispatcher(button, view)
    button.classList.add(
      'btn',
      'btn-secondary',
      'ol-cm-graphics-edit-button',
      'icon-button',
      'd-inline-grid'
    )

    const buttonContent = button.appendChild(document.createElement('span'))
    buttonContent.className = 'button-content'

    buttonContent.appendChild(materialIcon('edit'))

    return button
  }

  renderGraphic(element: HTMLElement, view: EditorView) {
    super.renderGraphic(element, view)
    if (this.figureData) {
      const button = this.createEditButton(view)
      element.prepend(button)
    }
  }
}

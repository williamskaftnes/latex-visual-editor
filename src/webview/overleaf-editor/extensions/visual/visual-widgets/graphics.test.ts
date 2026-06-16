// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { GraphicsWidget } from './graphics'
import { EditableGraphicsWidget } from './editable-graphics'
import type { PreviewPath } from '../../../../adapters/previewPath'

describe('GraphicsWidget', () => {
  it('rerenders when an unresolved preview path becomes available', () => {
    let preview: PreviewPath | null = null
    const widget = new GraphicsWidget(
      'data-fusion.pdf',
      () => preview,
      true,
      null
    )
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorState.phrases.of({
            the_visual_editor_cant_preview_this_type_of_image_file:
              'The visual editor cannot preview this image.',
          }),
        ],
      }),
      parent: document.body,
    })

    const element = widget.toDOM(view)
    expect(element.querySelector('.ol-cm-graphics-loading-error')).not.toBeNull()

    preview = { url: 'vscode-resource://data-fusion.pdf', extension: 'pdf' }
    expect(widget.updateDOM(element, view)).toBe(true)

    expect(element.querySelector('.ol-cm-graphics-loading-error')).toBeNull()
    expect(element.querySelector('canvas.ol-cm-graphics')).not.toBeNull()
  })

  it('does not treat unresolved and resolved previews as equivalent widgets', () => {
    let preview: PreviewPath | null = null
    const unresolved = new GraphicsWidget(
      'data-fusion.pdf',
      () => preview,
      true,
      null
    )

    preview = { url: 'vscode-resource://data-fusion.pdf', extension: 'pdf' }
    const resolved = new GraphicsWidget(
      'data-fusion.pdf',
      () => preview,
      true,
      null
    )

    expect(unresolved.eq(resolved)).toBe(false)
  })

  it('rerenders editable figures when an unresolved preview path becomes available', () => {
    let preview: PreviewPath | null = null
    const widget = new EditableGraphicsWidget(
      'data-fusion.pdf',
      () => preview,
      true,
      null
    )
    const view = new EditorView({
      state: EditorState.create({
        doc: '',
        extensions: [
          EditorState.phrases.of({
            the_visual_editor_cant_preview_this_type_of_image_file:
              'The visual editor cannot preview this image.',
            edit_figure: 'Edit figure',
          }),
        ],
      }),
      parent: document.body,
    })

    const element = widget.toDOM(view)
    expect(element.querySelector('.ol-cm-graphics-loading-error')).not.toBeNull()

    preview = { url: 'vscode-resource://data-fusion.pdf', extension: 'pdf' }
    expect(widget.updateDOM(element, view)).toBe(true)

    expect(element.querySelector('.ol-cm-graphics-loading-error')).toBeNull()
    expect(element.querySelector('canvas.ol-cm-graphics')).not.toBeNull()
  })
})

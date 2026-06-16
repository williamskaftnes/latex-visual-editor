// @vitest-environment jsdom
import { EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { describe, expect, it } from 'vitest'
import { GraphicsWidget } from './graphics'
import { EditableGraphicsWidget } from './editable-graphics'
import { FigureData } from '../../figure-modal'
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

  it('renders linewidth figures at full editor width', () => {
    const widget = new GraphicsWidget(
      'hero.png',
      () => ({ url: 'vscode-resource://hero.png', extension: 'png' }),
      true,
      new FigureData({
        from: 0,
        to: 44,
        caption: null,
        label: null,
        width: 1,
        graphicsCommandArguments: { from: 17, to: 32 },
        graphicsCommand: { from: 0, to: 44 },
        file: { from: 34, to: 42, path: 'hero.png' },
      })
    )
    const view = new EditorView({
      state: EditorState.create({ doc: '' }),
      parent: document.body,
    })

    const element = widget.toDOM(view)
    const image = element.querySelector<HTMLImageElement>('img.ol-cm-graphics')

    expect(image?.getAttribute('style')).toContain('width: min(100%, 100%)')
    expect(image?.getAttribute('style')).toContain(
      'max-width: min(100%, 100%)'
    )
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

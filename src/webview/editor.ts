import './editor.css'

import { autocompletion, closeBrackets } from '@codemirror/autocomplete'
import {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
  redo,
  redoDepth,
  undo,
  undoDepth,
} from '@codemirror/commands'
import { search, searchKeymap } from '@codemirror/search'
import { Compartment, EditorSelection, EditorState } from '@codemirror/state'
import { EditorView, keymap, lineNumbers } from '@codemirror/view'
import { syntaxTree } from '@codemirror/language'
import type {
  HostToWebviewMessage,
  WebviewToHostMessage,
  WorkspaceMetadata,
} from '../shared/messages'
import { findMinimalTextChange } from '../shared/textChange'
import type { PreviewPath } from './adapters/previewPath'
import { LaTeXLanguage } from './overleaf-editor/languages/latex/latex-language'
import {
  editFigureData,
  figureModal,
} from './overleaf-editor/extensions/figure-modal'
import { toggleRanges, wrapRanges } from './overleaf-editor/commands/ranges'
import {
  toggleListForRanges,
} from './overleaf-editor/extensions/toolbar/lists'
import { setSectionHeadingLevel } from './overleaf-editor/extensions/toolbar/sections'
import { atomicDecorations } from './overleaf-editor/extensions/visual/atomic-decorations'
import { highlightCurrentLineNumber } from './overleaf-editor/extensions/visual/current-line-number'
import { listItemMarker } from './overleaf-editor/extensions/visual/list-item-marker'
import { markDecorations } from './overleaf-editor/extensions/visual/mark-decorations'
import { pasteHtml } from './overleaf-editor/extensions/visual/paste-html'
import { mousedown } from './overleaf-editor/extensions/visual/selection'
import { tableGeneratorTheme } from './overleaf-editor/extensions/visual/table-generator'
import {
  visualHighlightStyle,
  visualTheme,
} from './overleaf-editor/extensions/visual/visual-theme'
import { visualKeymap } from './overleaf-editor/extensions/visual/visual-keymap'
import { showContentWhenParsed } from './showContentWhenParsed'
import { latexAutocomplete } from './latexAutocomplete'
import { findCurrentSectionHeadingLevel } from './overleaf-editor/extensions/toolbar/sections'
import { ancestorListType } from './overleaf-editor/extensions/toolbar/lists'
import { withinFormattingCommand } from './overleaf-editor/utils/tree-operations/formatting'

type VsCodeApi = {
  postMessage: (message: WebviewToHostMessage) => void
  getState: () => unknown
  setState: (state: unknown) => void
}

declare const acquireVsCodeApi: () => VsCodeApi

const vscode = acquireVsCodeApi()
const resourceCache = new Map<string, PreviewPath | null>()
const pendingResources = new Map<string, string>()
const pendingImages = new Map<string, (path: string) => void>()

let view: EditorView | undefined
const colorTheme = new Compartment()
let hostVersion = 0
let applyingHostDocument = false
let viewStateFrame: number | undefined
let restoringViewState = false
let lastMeasuredViewState:
  | Extract<WebviewToHostMessage, { type: 'viewStateChanged' }>
  | undefined
let metadata: WorkspaceMetadata = {
  labels: [],
  citationKeys: [],
  includes: [],
  graphics: [],
  packages: [],
  commands: [],
  environments: [],
}

window.addEventListener('message', event => {
  const message = event.data as HostToWebviewMessage
  switch (message.type) {
    case 'initialize':
      hostVersion = message.version
      metadata = message.metadata
      if (!view) {
        createEditor(message.text, message.selection, message.viewState)
      } else {
        replaceDocumentFromHost(message.text)
      }
      break
    case 'documentChanged':
      // Local edits update CodeMirror immediately and increment hostVersion
      // optimistically. Ignore acknowledgements for earlier queued edits so
      // they cannot temporarily roll back newer input and move the cursor.
      if (message.version < hostVersion) break
      hostVersion = message.version
      if (view?.state.doc.toString() !== message.text) {
        replaceDocumentFromHost(message.text)
      }
      break
    case 'metadataChanged':
      metadata = message.metadata
      break
    case 'resourceResolved': {
      const resourcePath = pendingResources.get(message.requestId)
      if (!resourcePath) break
      pendingResources.delete(message.requestId)
      resourceCache.set(
        resourcePath,
        message.url && message.extension
          ? { url: message.url, extension: message.extension }
          : null
      )
      refreshVisualDecorations()
      break
    }
    case 'imageInserted': {
      const resolve = pendingImages.get(message.requestId)
      if (!resolve) break
      pendingImages.delete(message.requestId)
      if (message.path) resolve(message.path)
      else vscode.postMessage({
        type: 'showError',
        message: message.error ?? 'Could not insert image.',
      })
      break
    }
    case 'command':
      if (message.command === 'insertFigure') openImagePicker()
      else if (message.command === 'insertTable') insertTable(3, 3)
      else if (view) {
        view.dispatch({
          selection: EditorSelection.single(0, view.state.doc.length),
          scrollIntoView: true,
          userEvent: 'select',
        })
        view.focus()
      }
      break
  }
})

/**
 * Creates the CodeMirror editor with Overleaf's parser and visual extensions.
 */
function createEditor(
  text: string,
  selection?: { anchor: number; head: number },
  viewState?: {
    anchor: number
    visualScrollTop?: number
    source: 'source' | 'visual'
  }
): void {
  const documentLength = text.length
  const anchor = Math.min(selection?.anchor ?? 0, documentLength)
  const head = Math.min(selection?.head ?? anchor, documentLength)
  const state = EditorState.create({
    doc: text,
    selection: EditorSelection.single(anchor, head),
    extensions: [
      LaTeXLanguage,
      EditorState.phrases.of(phrases),
      history({ newGroupDelay: 250 }),
      EditorView.lineWrapping,
      lineNumbers(),
      highlightCurrentLineNumber,
      colorTheme.of(EditorView.darkTheme.of(isDarkTheme())),
      EditorView.contentAttributes.of({ 'aria-label': 'Visual Editor editing' }),
      keymap.of([
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
        indentWithTab,
      ]),
      search(),
      autocompletion({
        icons: false,
        optionClass: completion =>
          `latex-completion-${completion.type ?? 'text'}`,
      }),
      latexAutocomplete(() => metadata),
      closeBrackets(),
      visualHighlightStyle,
      visualTheme,
      tableGeneratorTheme,
      mousedown,
      listItemMarker,
      atomicDecorations({ previewByPath }),
      markDecorations,
      visualKeymap,
      pasteHtml,
      figureModal(),
      showContentWhenParsed,
      EditorView.updateListener.of(update => {
        if (update.docChanged && !applyingHostDocument) {
          sendMinimalEdit(update.startState.doc.toString(), update.state.doc.toString())
        }
        if (update.selectionSet) {
          sendSelection(update.state.selection.main)
        }
        if (update.viewportChanged || update.geometryChanged) {
          scheduleViewState()
        }
        updateToolbarState()
      }),
    ],
  })

  view = new EditorView({
    state,
    parent: document.querySelector('#editor') as HTMLElement,
  })
  observeColorTheme()
  createToolbar()
  updateToolbarState()
  installImageDrop()
  window.addEventListener('figure-modal:open-modal', editSelectedFigure)
  sendSelection(view.state.selection.main)
  if (viewState) {
    restoringViewState = true
    requestAnimationFrame(() => {
      if (viewState.source === 'visual') {
        document.querySelector('#editor')?.classList.add('restoring-view')
        restoreVisualReopen(viewState.visualScrollTop)
      } else {
        centerVisualAnchor(viewState.anchor, () => {
          restoringViewState = false
          sendViewState()
        })
      }
    })
  }
  view.focus()
}

function restoreVisualReopen(scrollTop?: number): void {
  waitForStableLayout(() => {
    if (view && scrollTop !== undefined) {
      view.scrollDOM.scrollTop = Math.min(
        scrollTop,
        maximumScrollTop(view)
      )
    }
    requestAnimationFrame(() => {
      restoringViewState = false
      document.querySelector('#editor')?.classList.remove('restoring-view')
      sendViewState()
    })
  })
}

function waitForStableLayout(done: () => void): void {
  let previousHeight = -1
  let stableFrames = 0
  let frames = 0
  const check = () => {
    if (!view) {
      done()
      return
    }
    const height = view.scrollDOM.scrollHeight
    stableFrames = height === previousHeight ? stableFrames + 1 : 0
    previousHeight = height
    frames += 1
    const parsed = syntaxTree(view.state).length >= view.state.doc.length
    if ((parsed && stableFrames >= 3) || frames >= 120) {
      done()
    } else {
      requestAnimationFrame(check)
    }
  }
  requestAnimationFrame(check)
}

/**
 * Reports top visible document position after scrolling settles.
 */
function scheduleViewState(): void {
  if (restoringViewState) return
  if (viewStateFrame !== undefined) cancelAnimationFrame(viewStateFrame)
  viewStateFrame = requestAnimationFrame(sendViewState)
}

function sendViewState(): void {
  if (viewStateFrame !== undefined) cancelAnimationFrame(viewStateFrame)
  viewStateFrame = undefined
  if (!view || restoringViewState) return
  const bounds = view.scrollDOM.getBoundingClientRect()
  const anchor =
    view.posAtCoords({
      x: bounds.left + Math.min(bounds.width / 2, 40),
      y: bounds.top + bounds.height / 2,
    }) ?? view.viewport.from
  lastMeasuredViewState = {
    type: 'viewStateChanged',
    anchor,
    visualScrollTop: view.scrollDOM.scrollTop,
    source: 'visual',
  }
  vscode.postMessage(lastMeasuredViewState)
}

function centerVisualAnchor(anchor: number, done?: () => void): void {
  if (!view) {
    done?.()
    return
  }
  const position = Math.min(Math.max(0, anchor), view.state.doc.length)
  const editor = view
  editor.dispatch({
    effects: EditorView.scrollIntoView(position, { y: 'center' }),
  })
  editor.requestMeasure({
    read: currentView => currentView.coordsAtPos(position),
    write: coords => {
      if (coords) {
        const bounds = editor.scrollDOM.getBoundingClientRect()
        const currentY = (coords.top + coords.bottom) / 2
        const targetY = bounds.top + bounds.height / 2
        editor.scrollDOM.scrollTop += currentY - targetY
      }
      done?.()
    },
  })
}

function maximumScrollTop(editor: EditorView): number {
  return Math.max(0, editor.scrollDOM.scrollHeight - editor.scrollDOM.clientHeight)
}

window.addEventListener('pagehide', () => {
  if (lastMeasuredViewState) vscode.postMessage(lastMeasuredViewState)
})

/**
 * Reports whether VS Code currently uses a dark or high-contrast dark theme.
 */
function isDarkTheme(): boolean {
  return (
    document.body.classList.contains('vscode-dark') ||
    document.body.classList.contains('vscode-high-contrast')
  )
}

/**
 * Keeps CodeMirror's dark-theme facet synchronized with VS Code.
 */
function observeColorTheme(): void {
  let dark = isDarkTheme()
  const observer = new MutationObserver(() => {
    const nextDark = isDarkTheme()
    if (!view || nextDark === dark) return
    dark = nextDark
    view.dispatch({
      effects: colorTheme.reconfigure(EditorView.darkTheme.of(dark)),
    })
  })
  observer.observe(document.body, {
    attributes: true,
    attributeFilter: ['class'],
  })
}

/**
 * Reports the active CodeMirror selection as document offsets.
 */
function sendSelection(selection: { anchor: number; head: number }): void {
  vscode.postMessage({
    type: 'selectionChanged',
    anchor: selection.anchor,
    head: selection.head,
  })
}

/**
 * Applies the smallest host document change without echoing it back.
 */
function replaceDocumentFromHost(text: string): void {
  if (!view) return
  const currentText = view.state.doc.toString()
  if (currentText === text) return

  const change = findMinimalTextChange(currentText, text)
  applyingHostDocument = true
  try {
    view.dispatch({ changes: change })
  } finally {
    applyingHostDocument = false
  }
}

/**
 * Sends one minimal replacement covering the changed source range.
 */
function sendMinimalEdit(before: string, after: string): void {
  const change = findMinimalTextChange(before, after)

  vscode.postMessage({
    type: 'edit',
    version: hostVersion,
    ...change,
  })
  hostVersion += 1
}

/**
 * Resolves graphics paths lazily through the extension host.
 */
function previewByPath(path: string): PreviewPath | null {
  if (resourceCache.has(path)) return resourceCache.get(path) ?? null
  if (![...pendingResources.values()].includes(path)) {
    const requestId = requestIdFor('resource')
    pendingResources.set(requestId, path)
    vscode.postMessage({ type: 'resolveResource', requestId, path })
  }
  return null
}

/**
 * Forces Overleaf's selection-sensitive decoration field to rebuild.
 */
function refreshVisualDecorations(): void {
  if (!view) return
  view.dispatch({
    selection: EditorSelection.create(view.state.selection.ranges),
  })
}

/**
 * Builds the visual formatting toolbar.
 */
function createToolbar(): void {
  const toolbar = document.querySelector('#toolbar') as HTMLElement
  toolbar.replaceChildren()

  const heading = document.createElement('select')
  heading.setAttribute('aria-label', 'Heading level')
  for (const [label, value] of [
    ['Text', 'text'],
    ['Part', 'part'],
    ['Chapter', 'chapter'],
    ['Section', 'section'],
    ['Subsection', 'subsection'],
    ['Subsubsection', 'subsubsection'],
  ]) {
    const option = document.createElement('option')
    option.textContent = label
    option.value = value
    heading.append(option)
  }
  heading.addEventListener('change', () => {
    if (view) setSectionHeadingLevel(view, heading.value)
  })
  heading.dataset.control = 'heading'
  toolbar.append(heading)

  addButton(
    toolbar,
    'Bold',
    'B',
    () => run(toggleRanges('\\textbf')),
    'bold',
    true
  )
  addButton(
    toolbar,
    'Italic',
    'I',
    () => run(toggleRanges('\\textit')),
    'italic',
    true
  )
  addButton(
    toolbar,
    'Bullet list',
    '•',
    () =>
      run(editor => {
        toggleListForRanges('itemize')(editor)
        return true
      }),
    'bullet-list',
    true
  )
  addButton(
    toolbar,
    'Numbered list',
    '1.',
    () =>
      run(editor => {
        toggleListForRanges('enumerate')(editor)
        return true
      }),
    'numbered-list',
    true
  )
  addButton(toolbar, 'Inline math', '∑', () => run(wrapRanges('\\(', '\\)')))
  addButton(toolbar, 'Display math', '∫', () => run(wrapRanges('\n\\[', '\\]\n')))
  addButton(toolbar, 'Link', 'Link', () => run(wrapRanges('\\href{}{', '}')))
  addButton(toolbar, 'Citation', 'Cite', () => insertReference('\\cite', metadata.citationKeys))
  addButton(toolbar, 'Cross-reference', 'Ref', () => insertReference('\\ref', metadata.labels))
  addButton(toolbar, 'Figure', 'Image', openImagePicker)
  addButton(toolbar, 'Table', 'Table', () => insertTable(3, 3))
  addButton(toolbar, 'Undo', '↶', () => view && undo(view), 'undo')
  addButton(toolbar, 'Redo', '↷', () => view && redo(view), 'redo')
}

/**
 * Adds one accessible toolbar button.
 */
function addButton(
  parent: HTMLElement,
  label: string,
  text: string,
  action: () => void,
  control?: string,
  toggle = false
): void {
  const button = document.createElement('button')
  button.type = 'button'
  button.title = label
  button.setAttribute('aria-label', label)
  button.textContent = text
  if (control) button.dataset.control = control
  if (toggle) button.setAttribute('aria-pressed', 'false')
  button.addEventListener('mousedown', event => event.preventDefault())
  button.addEventListener('click', action)
  parent.append(button)
}

/**
 * Runs a CodeMirror command and restores editor focus.
 */
function run(command: (editor: EditorView) => boolean): void {
  if (!view) return
  command(view)
  view.focus()
}

/**
 * Inserts a citation or reference using indexed workspace keys.
 */
function insertReference(command: string, values: string[]): void {
  if (!view) return
  const suggestion = values.length
    ? window.prompt(`Choose a value:\n${values.slice(0, 30).join('\n')}`, values[0])
    : window.prompt('Enter value')
  if (!suggestion) return
  const range = view.state.selection.main
  view.dispatch({
    changes: {
      from: range.from,
      to: range.to,
      insert: `${command}{${suggestion}}`,
    },
    selection: { anchor: range.from + command.length + suggestion.length + 2 },
  })
}

/**
 * Inserts a simple Overleaf-compatible table template.
 */
function insertTable(columns: number, rows: number): void {
  if (!view) return
  const body = Array.from(
    { length: rows },
    () => `\t\t${Array.from({ length: columns }, () => '').join(' & ')} \\\\`
  ).join('\n')
  const latex = `\\begin{table}\n\t\\centering\n\t\\begin{tabular}{${'c'.repeat(columns)}}\n${body}\n\t\\end{tabular}\n\t\\caption{Caption}\n\t\\label{tab:placeholder}\n\\end{table}`
  insertBlock(latex)
}

/**
 * Opens a file picker and copies the selected image through the host.
 */
function openImagePicker(): void {
  const input = document.createElement('input')
  input.type = 'file'
  input.accept = 'image/*,.pdf,.eps'
  input.addEventListener('change', async () => {
    const file = input.files?.[0]
    if (!file) return
    const path = await uploadImage(file)
    openFigureDialog({ path })
  })
  input.click()
}

/**
 * Copies a browser file into the workspace assets directory.
 */
async function uploadImage(file: File): Promise<string> {
  const requestId = requestIdFor('image')
  const result = new Promise<string>(resolve => pendingImages.set(requestId, resolve))
  vscode.postMessage({
    type: 'insertImage',
    requestId,
    name: file.name,
    mimeType: file.type,
    bytes: [...new Uint8Array(await file.arrayBuffer())],
  })
  return result
}

/**
 * Inserts an Overleaf-style figure environment.
 */
function insertBlock(latex: string): void {
  if (!view) return
  const line = view.state.doc.lineAt(view.state.selection.main.head)
  const from = line.text.trim() ? line.to : line.from
  const prefix = line.text.trim() ? '\n\n' : ''
  view.dispatch({
    changes: { from, insert: prefix + latex + '\n' },
    selection: { anchor: from + prefix.length + latex.length },
    scrollIntoView: true,
  })
  view.focus()
}

/**
 * Handles pasted or dropped image files.
 */
function installImageDrop(): void {
  if (!view) return
  const handle = async (files: FileList | null) => {
    const file = files?.[0]
    if (!file || (!file.type.startsWith('image/') && !/\.(pdf|eps)$/i.test(file.name))) {
      return false
    }
    openFigureDialog({ path: await uploadImage(file) })
    return true
  }
  view.dom.addEventListener('drop', event => {
    if (event.dataTransfer?.files.length) {
      event.preventDefault()
      void handle(event.dataTransfer.files)
    }
  })
  view.dom.addEventListener('paste', event => {
    if (event.clipboardData?.files.length) {
      event.preventDefault()
      void handle(event.clipboardData.files)
    }
  })
}

/**
 * Edits the path and width of the figure selected by Overleaf's image widget.
 */
function editSelectedFigure(): void {
  if (!view) return
  const current = view.state.field(editFigureData, false)
  if (!current) return
  const source = view.state.sliceDoc(current.from, current.to)
  openFigureDialog({
    path: current.file.path,
    width: current.width ?? 0.5,
    placement: source.match(/\\begin\{figure\}(?:\[([^\]]+)\])?/)?.[1] ?? '',
    caption: commandArgument(source, 'caption'),
    label: commandArgument(source, 'label'),
    existing: { from: current.from, to: current.to },
  })
}

type FigureDialogData = {
  path: string
  width?: number
  placement?: string
  caption?: string | null
  label?: string | null
  existing?: { from: number; to: number }
}

/**
 * Opens the local replacement for Overleaf's server-backed figure modal.
 */
function openFigureDialog(data: FigureDialogData): void {
  const backdrop = document.createElement('div')
  backdrop.className = 'latex-figure-dialog-backdrop'
  const dialog = document.createElement('form')
  dialog.className = 'latex-figure-dialog'
  dialog.setAttribute('role', 'dialog')
  dialog.setAttribute('aria-modal', 'true')
  dialog.innerHTML = `
    <h2>${data.existing ? 'Edit figure' : 'Insert figure'}</h2>
    <label>Image path<input name="path" required></label>
    <label>Width as fraction of line<input name="width" type="number" min="0.05" max="1" step="0.05"></label>
    <label>Placement<input name="placement" placeholder="htbp"></label>
    <label>Caption<input name="caption"></label>
    <label>Label<input name="label" placeholder="fig:example"></label>
    <div class="latex-figure-dialog-actions">
      ${data.existing ? '<button type="button" data-action="delete">Delete</button>' : ''}
      <button type="button" data-action="cancel">Cancel</button>
      <button type="submit">${data.existing ? 'Update' : 'Insert'}</button>
    </div>
  `
  backdrop.append(dialog)
  document.body.append(backdrop)

  const pathInput = dialog.elements.namedItem('path') as HTMLInputElement
  const widthInput = dialog.elements.namedItem('width') as HTMLInputElement
  const placementInput = dialog.elements.namedItem('placement') as HTMLInputElement
  const captionInput = dialog.elements.namedItem('caption') as HTMLInputElement
  const labelInput = dialog.elements.namedItem('label') as HTMLInputElement
  pathInput.value = data.path
  widthInput.value = String(data.width ?? 0.5)
  placementInput.value = data.placement ?? ''
  captionInput.value = data.caption ?? 'Enter Caption'
  labelInput.value = data.label ?? 'fig:placeholder'
  pathInput.focus()

  const close = () => {
    backdrop.remove()
    view?.focus()
  }
  dialog.querySelector('[data-action="cancel"]')?.addEventListener('click', close)
  dialog.querySelector('[data-action="delete"]')?.addEventListener('click', () => {
    if (view && data.existing) {
      view.dispatch({
        changes: { from: data.existing.from, to: data.existing.to, insert: '' },
      })
    }
    close()
  })
  backdrop.addEventListener('mousedown', event => {
    if (event.target === backdrop) close()
  })
  dialog.addEventListener('submit', event => {
    event.preventDefault()
    const latex = buildFigureLatex({
      path: pathInput.value,
      width: Number.parseFloat(widthInput.value) || 0.5,
      placement: placementInput.value.trim(),
      caption: captionInput.value.trim(),
      label: labelInput.value.trim(),
    })
    if (view && data.existing) {
      view.dispatch({
        changes: {
          from: data.existing.from,
          to: data.existing.to,
          insert: latex,
        },
      })
    } else {
      insertBlock(latex)
    }
    close()
  })
}

/**
 * Creates a figure environment from dialog values.
 */
function buildFigureLatex(data: Required<Omit<FigureDialogData, 'existing'>>): string {
  const svg = data.path.toLowerCase().endsWith('.svg')
  const command = svg ? 'includesvg' : 'includegraphics'
  const sourcePath = svg ? data.path.replace(/\.svg$/i, '') : data.path
  const placement = data.placement ? `[${data.placement}]` : ''
  const caption = data.caption ? `\n\t\\caption{${data.caption}}` : ''
  const label = data.label ? `\n\t\\label{${data.label}}` : ''
  return `\\begin{figure}${placement}\n\t\\centering\n\t\\${command}[width=${data.width}\\linewidth]{${sourcePath}}${caption}${label}\n\\end{figure}`
}

/**
 * Reads a simple command argument from a figure source block.
 */
function commandArgument(source: string, command: string): string | null {
  return source.match(new RegExp(`\\\\${command}\\{([^}]*)\\}`))?.[1] ?? null
}

/**
 * Updates toolbar state after selection changes.
 */
function updateToolbarState(): void {
  if (!view) return
  const state = view.state
  const isFormatted = withinFormattingCommand(state)
  setToolbarToggle('bold', isFormatted('\\textbf'))
  setToolbarToggle('italic', isFormatted('\\textit'))

  const listType = ancestorListType(state)
  setToolbarToggle('bullet-list', listType === 'itemize')
  setToolbarToggle('numbered-list', listType === 'enumerate')

  const heading = document.querySelector<HTMLSelectElement>(
    '#toolbar [data-control="heading"]'
  )
  if (heading) {
    heading.value = findCurrentSectionHeadingLevel(state)?.level ?? 'text'
  }

  const undoButton = toolbarButton('undo')
  if (undoButton) undoButton.disabled = undoDepth(state) === 0
  const redoButton = toolbarButton('redo')
  if (redoButton) redoButton.disabled = redoDepth(state) === 0
}

function setToolbarToggle(control: string, active: boolean): void {
  const button = toolbarButton(control)
  if (!button) return
  button.setAttribute('aria-pressed', String(active))
  button.classList.toggle('active', active)
}

function toolbarButton(control: string): HTMLButtonElement | null {
  return document.querySelector(`#toolbar button[data-control="${control}"]`)
}

/**
 * Creates a collision-resistant message request identifier.
 */
function requestIdFor(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

const phrases: Record<string, string> = {
  expand: 'Expand',
  learn_more: 'Learn more',
  hide_document_preamble: 'Hide document preamble',
  show_document_preamble: 'Show document preamble',
  edit_figure: 'Edit figure',
  the_visual_editor_cant_preview_this_type_of_image_file:
    'The visual editor cannot preview this image.',
  click_recompile_and_check_your_pdf_to_see_how_its_looking:
    'Open the compiled PDF to inspect this image.',
  sorry_your_table_cant_be_displayed_at_the_moment:
    'This table cannot be displayed.',
  this_could_be_because_we_cant_support_some_elements_of_the_table:
    'The table contains unsupported LaTeX.',
}

vscode.postMessage({ type: 'ready' })

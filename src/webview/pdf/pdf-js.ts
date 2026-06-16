import * as PDFJS from 'pdfjs-dist'
import type {
  DocumentInitParameters,
  PDFDocumentProxy,
} from 'pdfjs-dist/types/src/display/api'

const workerUrl = document
  .querySelector<HTMLMetaElement>('meta[name="latex-visual-editor-pdf-worker"]')
  ?.content

let workerReady: Promise<void> | null = null

export type { PDFDocumentProxy } from 'pdfjs-dist/types/src/display/api'

async function ensureWorker(): Promise<void> {
  if (PDFJS.GlobalWorkerOptions.workerPort) return
  workerReady ??= createWorker()
  await workerReady
}

async function createWorker(): Promise<void> {
  if (!workerUrl) {
    throw new Error('Missing PDF.js worker URI.')
  }

  const response = await fetch(workerUrl)
  if (!response.ok) {
    throw new Error(`Failed to fetch PDF.js worker: ${response.status}`)
  }

  const workerSource = await response.text()
  const objectUrl = URL.createObjectURL(
    new Blob([workerSource], { type: 'text/javascript' })
  )
  PDFJS.GlobalWorkerOptions.workerPort = new Worker(objectUrl, { type: 'module' })
}

export async function loadPdfDocumentFromUrl(
  url: string,
  options: Partial<DocumentInitParameters> = {}
): Promise<PDFDocumentProxy> {
  await ensureWorker()
  return PDFJS.getDocument({
    url,
    disableAutoFetch: true,
    isEvalSupported: false,
    enableXfa: false,
    ...options,
  }).promise
}

type MathJaxApi = {
  startup: {
    defaultReady: () => Promise<void>
    document: {
      menu?: { menu: { findID: (...ids: string[]) => { disable: () => void } } }
      safe?: {
        filterAttributes: Map<string, string>
        filterMethods: Record<
          string,
          (_safe: unknown, value: string) => string
        >
      }
    }
    promise: Promise<void>
  }
  tex: { tags?: string }
  options: Record<string, unknown>
  svgStylesheet: () => HTMLStyleElement
  texReset: (labels?: number[]) => void
  getMetricsFor: (
    element: HTMLElement,
    display?: boolean
  ) => Record<string, unknown>
  tex2svgPromise: (
    source: string,
    options?: Record<string, unknown>
  ) => Promise<HTMLElement>
  typesetPromise: (elements: HTMLElement[]) => Promise<void>
  typesetClear: (elements: HTMLElement[]) => void
}

declare global {
  interface Window {
    MathJax: MathJaxApi | Record<string, unknown>
  }
}

let mathJaxPromise: Promise<MathJaxApi> | undefined

/**
 * Loads the same MathJax component and configuration as Overleaf's editor.
 */
export const loadMathJax = async (options?: {
  enableMenu?: boolean
  numbering?: string
  singleDollar?: boolean
  useLabelIds?: boolean
}): Promise<MathJaxApi> => {
  if (!mathJaxPromise) {
    mathJaxPromise = new Promise((resolve, reject) => {
      const settings = {
        enableMenu: false,
        singleDollar: true,
        useLabelIds: false,
        ...options,
      }
      const inlineMath = [['\\(', '\\)']]
      if (settings.singleDollar) inlineMath.push(['$', '$'])

      window.MathJax = {
        tex: {
          macros: {
            bm: ['\\boldsymbol{#1}', 1],
          },
          inlineMath,
          displayMath: [
            ['\\[', '\\]'],
            ['$$', '$$'],
          ],
          packages: {
            '[-]': ['html', 'require', 'textmacros'],
          },
          processEscapes: true,
          processEnvironments: true,
          useLabelIds: settings.useLabelIds,
        },
        output: {
          displayOverflow: 'linebreak',
        },
        loader: {
          load: ['ui/safe'],
        },
        options: {
          enableMenu: settings.enableMenu,
        },
        startup: {
          typeset: false,
          pageReady() {
            const api = window.MathJax as MathJaxApi
            api.startup.document.menu?.menu
              .findID('Settings', 'Renderer')
              .disable()
          },
          async ready() {
            const api = window.MathJax as MathJaxApi
            await api.startup.defaultReady()
            const safe = api.startup.document.safe
            if (safe) {
              safe.filterAttributes.set('fontfamily', 'filterFontFamily')
              safe.filterMethods.filterFontFamily = (_safe, family) =>
                family.split(/;/)[0]
            }
          },
        },
      }

      const configuration = window.MathJax as {
        tex: { tags?: string }
        options: Record<string, unknown>
      }
      if (settings.numbering) configuration.tex.tags = settings.numbering
      if (!settings.enableMenu) {
        configuration.options.menuOptions = {
          settings: {
            enrich: false,
            speech: false,
            braille: false,
            assistiveMml: false,
          },
        }
      }

      const path = document
        .querySelector<HTMLMetaElement>(
          'meta[name="latex-visual-editor-mathjax"]'
        )
        ?.getAttribute('content')
      if (!path) {
        reject(new Error('No MathJax path configured'))
        return
      }

      const script = document.createElement('script')
      script.src = path
      const nonce = document.querySelector<HTMLScriptElement>(
        'script[nonce]'
      )?.nonce
      if (nonce) script.nonce = nonce
      script.addEventListener('load', async () => {
        const api = window.MathJax as MathJaxApi
        await api.startup.promise
        document.head.appendChild(api.svgStylesheet())
        resolve(api)
      })
      script.addEventListener('error', () =>
        reject(new Error(`Could not load MathJax from ${path}`))
      )
      document.head.append(script)
    })
  }

  return mathJaxPromise
}

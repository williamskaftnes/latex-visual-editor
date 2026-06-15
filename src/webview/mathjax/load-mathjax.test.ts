// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest'
import { loadMathJax } from './load-mathjax'

describe('loadMathJax', () => {
  beforeEach(() => {
    const path = document.createElement('meta')
    path.name = 'latex-visual-editor-mathjax'
    path.content = '/dist/mathjax/tex-svg.js'
    document.head.append(path)
    const bootstrap = document.createElement('script')
    bootstrap.nonce = 'test-nonce'
    document.head.append(bootstrap)
  })

  it('configures the Overleaf MathJax runtime before loading it', () => {
    void loadMathJax()

    expect(window.MathJax).toMatchObject({
      tex: {
        processEnvironments: true,
        macros: { bm: [String.raw`\boldsymbol{#1}`, 1] },
      },
      output: { displayOverflow: 'linebreak' },
      startup: { typeset: false },
    })
    const mathJaxScript = document.querySelector<HTMLScriptElement>(
      'script[src*="tex-svg.js"]'
    )
    expect(mathJaxScript?.src).toContain(
      '/dist/mathjax/tex-svg.js'
    )
    expect(mathJaxScript?.nonce).toBe('test-nonce')
  })
})

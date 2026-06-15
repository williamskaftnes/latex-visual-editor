import * as esbuild from 'esbuild'
import { mkdir, cp, rm } from 'node:fs/promises'

const watch = process.argv.includes('--watch')
await mkdir('dist', { recursive: true })
await mkdir('dist/mathjax', { recursive: true })
await rm('dist/katex.min.css', { force: true })
await rm('dist/fonts', { recursive: true, force: true })
if (!watch) {
  await rm('dist/extension.js.map', { force: true })
  await rm('dist/webview.js.map', { force: true })
  await rm('dist/webview.css.map', { force: true })
}

const builds = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.js',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
  },
  {
    entryPoints: ['src/webview/editor.ts'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    loader: { '.css': 'css', '.mjs': 'js' },
  },
]

for (const options of builds) {
  const config = {
    ...options,
    bundle: true,
    sourcemap: watch,
    target: 'es2022',
    logLevel: 'info',
  }
  if (watch) {
    const context = await esbuild.context(config)
    await context.watch()
  } else {
    await esbuild.build(config)
  }
}

await cp('node_modules/mathjax/tex-svg.js', 'dist/mathjax/tex-svg.js')
await cp('node_modules/mathjax/input', 'dist/mathjax/input', { recursive: true })
await cp('node_modules/mathjax/ui', 'dist/mathjax/ui', { recursive: true })
await cp('node_modules/mathjax/sre', 'dist/mathjax/sre', { recursive: true })

import { cp, readFile } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { homedir } from 'node:os'

const manifest = JSON.parse(await readFile('package.json', 'utf8'))
const extensionId = `${manifest.publisher}.${manifest.name}-${manifest.version}`
const installedRoot = join(homedir(), '.vscode', 'extensions', extensionId)
const installedDist = join(installedRoot, 'dist')

await cp('dist', installedDist, { recursive: true })

const uri = `vscode://${manifest.publisher}.${manifest.name}/refreshWebviews`
const result =
  process.platform === 'win32'
    ? spawnSync(
        process.env.ComSpec ?? 'cmd.exe',
        ['/d', '/s', '/c', 'code', '--reuse-window', '--open-url', uri],
        { stdio: 'inherit' }
      )
    : spawnSync('code', ['--reuse-window', '--open-url', uri], {
        stdio: 'inherit',
      })

if (result.status !== 0) {
  if (result.error) {
    console.error(result.error.message)
  }
  process.exit(result.status ?? 1)
}

console.log(`Synced dist to ${installedDist}`)
console.log(`Requested webview refresh through ${uri}`)

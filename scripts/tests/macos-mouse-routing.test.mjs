import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'

const source = readFileSync(
  new URL('../../electron/main/services/live-companion/macos.ts', import.meta.url),
  'utf8',
)
const run = source
  .slice(
    source.indexOf('async function run(action: string)'),
    source.indexOf('export class MacOSLiveCompanionDriver'),
  )
  .replace('action: string', 'action')
for (const action of ['start', 'stop', 'confirm-stop', 'state']) {
  test(`${action} uses the appropriate native transport`, async () => {
    const calls = []
    const context = {
      findProcessIds: async () => ['123'],
      execFileText: async (...args) => {
        calls.push(args)
        return 'ok'
      },
      MACOS_MOUSE_SCRIPT: 'mouse script',
      MACOS_MOUSE_START_SCRIPT: 'mouse script',
      MACOS_AX_SCRIPT: 'state script',
      logger: { info() {}, error() {} },
    }
    runInNewContext(run, context)
    await context.run(action)
    assert.equal(calls.length, 1)
    assert.equal(calls[0][0], action === 'state' ? 'osascript' : '/usr/bin/swift')
    assert.equal(calls[0][1].at(-1), action)
  })
}

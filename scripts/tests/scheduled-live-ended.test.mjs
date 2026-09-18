import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const source = readFileSync(
  new URL('../../electron/main/services/ScheduledLiveService.ts', import.meta.url),
  'utf8',
)
function service() {
  const exports = {}
  runInNewContext(
    ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
    {
      exports,
      AbortController,
      Date,
      setTimeout: callback => {
        queueMicrotask(callback)
        return 1
      },
      clearTimeout() {},
      require: name => {
        if (name === 'shared/ipcChannels')
          return { IPC_CHANNELS: { tasks: { scheduledLive: { statusChanged: 'status' } } } }
        if (name === '#/logger') return { createLogger: () => ({ info() {}, error() {} }) }
        if (name === '#/windowManager') return { default: { send() {} } }
        return {}
      },
    },
  )
  return new exports.ScheduledLiveService()
}
for (const finalState of ['ended', 'ready']) {
  test(`scheduled task completes on ${finalState} after closing stream`, async () => {
    const instance = service()
    const controller = new AbortController()
    instance.controller = controller
    const states = ['ready', 'live', 'confirmingStop', finalState]
    const clicks = []
    const driver = {
      readState: async () => {
        assert.ok(states.length, 'must not keep polling after ended')
        return states.shift()
      },
      clickStart: async () => clicks.push('start'),
      clickStop: async () => clicks.push('stop'),
      confirmStop: async () => clicks.push('confirm'),
    }
    await instance.run(driver, 1, controller)
    assert.equal(instance.getSnapshot().status, 'completed')
    assert.deepEqual(clicks, ['start', 'stop', 'confirm'])
  })
}

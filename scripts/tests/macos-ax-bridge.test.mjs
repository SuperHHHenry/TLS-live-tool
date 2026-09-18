import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'

const source = readFileSync(
  new URL('../../electron/main/services/live-companion/macos.ts', import.meta.url),
  'utf8',
)
const script = source.match(/const MACOS_AX_SCRIPT = String\.raw`([\s\S]*?)`/)[1]
// Exercise the production converters with real opaque Core Foundation references.
// Only AX lookup is substituted, so tests require neither accessibility permission
// nor a running streaming app, and cannot press live-stream buttons.
const helpers = script
  .slice(0, script.indexOf('function run(argv)'))
  .replace('$.AXUIElementCopyAttributeValue(element, $(name), value)', 'copyFixture(value)')
function evaluate(fixture, expression) {
  const harness = `
    (function(Ref) {
    ${helpers}
    function copyFixture(output) { output[0] = ${fixture}; return 0 }
    return JSON.stringify(${expression})
    })(function() { return [] })
  `
  return JSON.parse(
    execFileSync('osascript', ['-l', 'JavaScript', '-e', harness], { encoding: 'utf8' }).trim(),
  )
}

test('AX array attributes expose native entries as a traversable array', {
  skip: process.platform !== 'darwin',
}, () => {
  const result = evaluate(
    '$.CFLocaleCopyAvailableLocaleIdentifiers()',
    `(() => {
    const entries = children(null)
    return { isArray: Array.isArray(entries), count: entries.length || 0 }
  })()`,
  )
  assert.equal(result.isArray, true)
  assert.ok(result.count > 0)
})

test('AX string attributes expose text instead of an opaque reference', {
  skip: process.platform !== 'darwin',
}, () => {
  const result = evaluate(
    '$.CFLocaleGetIdentifier($.CFLocaleCopyCurrent())',
    `({
    actual: stringAttribute(null, 'AXTitle'),
    expected: ObjC.unwrap($.NSLocale.currentLocale.localeIdentifier)
  })`,
  )
  assert.equal(result.actual, result.expected)
})

// Simulate delayed AX publication while exercising the actual run/match/press flow.
async function runScenario(action, frames) {
  const { runInNewContext } = await import('node:vm')
  let scans = 0
  const pressed = []
  const context = {
    ObjC: { import() {}, unwrap: value => value },
    $: Object.assign(value => value, {
      AXIsProcessTrusted: () => true,
      AXUIElementCreateApplication: () => ({}),
      NSRunningApplication: { runningApplicationWithProcessIdentifier: () => null },
      AXUIElementPerformAction: button => {
        pressed.push(button.AXTitle)
        return 0
      },
    }),
    delay() {},
    getFrame: () => frames[Math.min(scans++, frames.length - 1)],
  }
  runInNewContext(
    script +
      `
    attribute = function() { return [{}] }
    allElements = function() { return getFrame() }
    stringAttribute = function(element, name) { return element[name] || '' }
  `,
    context,
  )
  const result = context.run(['123', action])
  return { result, scans, pressed }
}
const start = { AXRole: 'AXButton', AXTitle: '开始直播' }

test('state waits for start button to appear in delayed accessibility tree', async () => {
  const result = await runScenario('state', [[], [], [start]])
  assert.equal(result.result, 'ready')
  assert.equal(result.scans, 3)
  assert.deepEqual(result.pressed, [])
})
test('start waits for exact button and presses it once', async () => {
  const result = await runScenario('start', [
    [{ AXRole: 'AXStaticText', AXValue: '开始直播' }],
    [start],
  ])
  assert.equal(result.result, 'ok')
  assert.deepEqual(result.pressed, ['开始直播'])
})
test('state stops retrying when tree never exposes a known button', async () => {
  const result = await runScenario('state', [[]])
  assert.equal(result.result, 'unknown')
  assert.ok(result.scans > 1 && result.scans <= 12)
  assert.deepEqual(result.pressed, [])
})
test('start refuses to press when stop and start coexist', async () => {
  await assert.rejects(
    runScenario('start', [[start, { AXRole: 'AXButton', AXTitle: '关播' }]]),
    /已在直播/,
  )
})

for (const title of ['00:00:12 关播', '00:00:12关播', '关播']) {
  test(`state recognizes live control: ${title}`, async () => {
    const result = await runScenario('state', [[{ AXRole: 'AXButton', AXTitle: title }]])
    assert.equal(result.result, 'live')
    assert.deepEqual(result.pressed, [])
  })
}
test('state recognizes separately exposed stop text', async () => {
  const result = await runScenario('state', [[{ AXRole: 'AXStaticText', AXValue: '关播' }]])
  assert.equal(result.result, 'live')
})
test('stop presses timer-labelled button', async () => {
  const result = await runScenario('stop', [[{ AXRole: 'AXButton', AXTitle: '00:00:12 关播' }]])
  assert.deepEqual(result.pressed, ['00:00:12 关播'])
})
test('confirmation takes priority over live text', async () => {
  const result = await runScenario('state', [
    [
      { AXRole: 'AXStaticText', AXValue: '关播' },
      { AXRole: 'AXButton', AXTitle: '关闭直播' },
    ],
  ])
  assert.equal(result.result, 'confirmingStop')
})
test('unrelated stop instructions do not imply live', async () => {
  const result = await runScenario('state', [
    [{ AXRole: 'AXStaticText', AXValue: '点击关播结束直播' }],
  ])
  assert.equal(result.result, 'unknown')
})

for (const field of ['AXTitle', 'AXDescription', 'AXValue']) {
  test(`ended page is recognized from ${field}`, async () => {
    const result = await runScenario('state', [[{ AXRole: 'AXStaticText', [field]: '直播已结束' }]])
    assert.equal(result.result, 'ended')
    assert.deepEqual(result.pressed, [])
  })
}
test('live control takes priority over ended text', async () => {
  const result = await runScenario('state', [
    [
      { AXRole: 'AXStaticText', AXValue: '直播已结束' },
      { AXRole: 'AXButton', AXTitle: '00:01:00 关播' },
    ],
  ])
  assert.equal(result.result, 'live')
})

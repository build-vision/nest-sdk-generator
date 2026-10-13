// Parity tests on a real project (opt-in)
//
//   PARITY_REAL_API_CONFIG=../buildvision/frontend/api-gen.config.json npm test
//
// Runs the generator configuration with every variant (outputs are written to a temporary directory) and compares the
// results like the fixture tests do. Also reports how long each variant took.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { assertBuilt, cleanup, describeDiff, FAST_VARIANTS, LEGACY_VARIANTS, runVariant } from './harness.mjs'

const CONFIG = process.env.PARITY_REAL_API_CONFIG

function findFileAbove(name, dir) {
  for (let current = dir; ; current = path.dirname(current)) {
    if (fs.existsSync(path.join(current, name))) return path.join(current, name)
    if (current === path.dirname(current)) return null
  }
}

/** The real configuration, with its outputs redirected to the run directory */
function scenarioConfig() {
  const configPath = path.resolve(CONFIG)
  const configDir = path.dirname(configPath)
  const original = JSON.parse(fs.readFileSync(configPath, 'utf8'))
  const sdkInterfacePath = path.resolve(configDir, original.sdkInterfacePath)
  const prettierConfig = original.prettierConfig
    ? path.resolve(configDir, original.prettierConfig)
    : findFileAbove('.prettierrc', path.resolve(configDir, original.sdkOutputPath))

  return {
    ...original,
    verbose: false,
    apiInputPath: path.resolve(configDir, original.apiInputPath),
    sdkOutputPath: './out',
    // Use the real SDK interface if it exists, so that no default one is generated
    sdkInterfacePath: fs.existsSync(sdkInterfacePath) ? sdkInterfacePath : './sdk-interface.ts',
    ...(prettierConfig ? { prettierConfig } : {}),
    ...(original.jsonOutput ? { jsonOutput: './analysis.json' } : {}),
  }
}

async function runTimed(scenario, variant) {
  const started = Date.now()
  const result = await runVariant(scenario, variant)
  return { result, seconds: (Date.now() - started) / 1000 }
}

describe('real API', { skip: !CONFIG && 'set PARITY_REAL_API_CONFIG to run' }, () => {
  before(assertBuilt)
  after(cleanup)

  // Variants run sequentially, so that timings are meaningful
  async function runScenario(t, scenario, variants) {
    const results = {}
    for (const variant of variants) {
      const { result, seconds } = await runTimed(scenario, variant)
      t.diagnostic(`${variant}: ${seconds.toFixed(2)}s`)
      assert.equal(result.exitCode, 0, `${variant} failed:\n${result.stdout}\n${result.stderr}`)
      results[variant] = result
    }
    return results
  }

  function assertSame(results, variants) {
    const [reference, ...others] = variants
    for (const variant of others) {
      assert.ok(
        JSON.stringify(results[variant]) === JSON.stringify(results[reference]),
        `${variant} differs from ${reference}:\n${describeDiff(results[reference], results[variant], reference, variant)}`
      )
    }
  }

  test('RTK Query endpoints', async (t) => {
    const scenario = { name: 'real-rtk', config: scenarioConfig(), args: ['--generate-rtk'] }
    const results = await runScenario(t, scenario, [...LEGACY_VARIANTS, ...FAST_VARIANTS])

    assertSame(results, LEGACY_VARIANTS)
    assertSame(results, FAST_VARIANTS)

    const changed = Object.keys(results.tsgo.files).filter((file) => results.tsgo.files[file] !== results.baseline.files[file])
    t.diagnostic(`files differing between tsgo (TypeScript 7) and baseline (TypeScript 4.8): ${changed.length ? changed.join(', ') : 'none'}`)
  })

  test('full analysis (JSON output)', async (t) => {
    // The baseline can't write JSON outputs (see test/parity.test.mjs)
    const scenario = { name: 'real-json', config: { ...scenarioConfig(), jsonOutput: './analysis.json', jsonPrettyOutput: true }, args: [] }
    const results = await runScenario(t, scenario, ['ts-morph', 'ts-morph-compat', ...FAST_VARIANTS])

    assertSame(results, ['ts-morph', 'ts-morph-compat'])

    // TypeScript 6 and 7 print a few types differently (e.g. classes declared in generic functions), which can change
    // the set of extracted types: report differences without failing
    const [a, b] = FAST_VARIANTS
    if (JSON.stringify(results[a]) !== JSON.stringify(results[b])) {
      t.diagnostic(`${a} and ${b} analyses differ:\n${describeDiff(results[a], results[b], a, b)}`)
    }
  })
})

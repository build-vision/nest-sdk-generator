// Engine selection, fallback and file ordering

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { assertBuilt, FIXTURES, REPO, TYPESCRIPT_6_PATH } from './harness.mjs'

const require = createRequire(import.meta.url)

const API = path.join(FIXTURES, 'api')
const BIN = path.join(REPO, 'build', 'bin.js')
const SIMULATE_TSGO_FAILURE = path.join(REPO, 'test', 'support', 'simulate-tsgo-failure.cjs')

const tmp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nest-sdk-generator-engines-'))

before(assertBuilt)
after(() => fs.rmSync(tmp, { recursive: true, force: true }))

/** Run the generator in a fresh directory, returns the run's result and generated files */
function generate(name, config, args = [], env = {}) {
  const dir = path.join(tmp, name)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(
    path.join(dir, 'config.json'),
    JSON.stringify({ apiInputPath: API, sdkOutputPath: './out', sdkInterfacePath: './sdk.ts', generateTimestamps: false, typescriptPath: TYPESCRIPT_6_PATH, ...config })
  )
  const result = spawnSync(process.execPath, [BIN, 'config.json', '--generate-rtk', ...args], {
    cwd: dir,
    encoding: 'utf8',
    env: { ...process.env, FORCE_COLOR: '0', ...env },
  })
  const outDir = path.join(dir, 'out')
  const files = fs.existsSync(outDir) ? Object.fromEntries(fs.readdirSync(outDir).map((f) => [f, fs.readFileSync(path.join(outDir, f), 'utf8')])) : {}
  return { ...result, files }
}

describe('engines', { concurrency: true }, () => {
  test('tsgo is the default engine', () => {
    const result = generate('default', { verbose: true })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /Analysis engine: tsgo/)
    assert.match(result.stderr, /Using TypeScript 7\.\d+\.\d+ \(native\)/)
  })

  test('the configuration file selects the engine', () => {
    const result = generate('config-engine', { verbose: true, engine: 'typescript' })
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /Analysis engine: typescript/)
    assert.match(result.stderr, /Using TypeScript 6\.\d+\.\d+ from /)
  })

  test('the command line overrides the configuration file', () => {
    for (const args of [['--engine=ts-morph'], ['--engine', 'ts-morph']]) {
      const result = generate(`cli-engine-${args.length}`, { verbose: true, engine: 'typescript' }, args)
      assert.equal(result.status, 0, result.stderr)
      assert.match(result.stderr, /Analysis engine: ts-morph/)
    }
  })

  test('unknown engines are rejected', () => {
    const result = generate('unknown-engine', {}, ['--engine=rust'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Unknown analysis engine rust \(expected one of: tsgo, typescript, ts-morph\)/)
  })

  test('falls back to the typescript engine when tsgo is unavailable, with the same output', () => {
    const expected = generate('fallback-reference', {}, ['--engine=tsgo'])
    const result = generate('fallback', {}, ['--engine=tsgo'], { NODE_OPTIONS: `--require ${SIMULATE_TSGO_FAILURE}` })

    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stderr, /Could not start the tsgo engine, falling back to the typescript engine \(same output, slower\)/)
    assert.match(result.stderr, /Simulated failure/)
    assert.ok(Object.keys(result.files).length > 0)
    assert.deepEqual(result.files, expected.files)
  })

  test('the typescript engine requires a TypeScript version with a JavaScript API', () => {
    const result = generate('typescript-7-api', { typescriptPath: path.dirname(require.resolve('typescript/package.json')) }, ['--engine=typescript'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /does not provide the JavaScript compiler API required by the typescript engine/)
  })

  test('the typescript engine reports a missing TypeScript installation', () => {
    const result = generate('typescript-missing', { typescriptPath: './no-typescript-here' }, ['--engine=typescript'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /Could not load TypeScript from \.\/no-typescript-here/)
  })
})

describe('file order', () => {
  // ts-morph's own ordering is the reference: the tsgo and typescript engines reproduce it from a flat list of files
  const { orderProjectFiles } = require(path.join(REPO, 'build', 'engine', 'file-order.js'))
  const { Project } = require('ts-morph')

  const projects = [path.join(API, 'tsconfig.json'), path.join(API, 'tsconfig.custom.json')]
  if (process.env.PARITY_REAL_API_TSCONFIG) projects.push(process.env.PARITY_REAL_API_TSCONFIG)

  for (const tsConfigFilePath of projects) {
    test(`matches ts-morph for ${path.relative(REPO, tsConfigFilePath)}`, () => {
      const project = new Project({ tsConfigFilePath })
      const expected = project.getSourceFiles().map((file) => file.getFilePath())
      const program = project.getProgram().compilerObject
      const programFiles = program.getSourceFiles().map((file) => file.fileName)

      assert.ok(expected.length > 0)
      assert.deepEqual(orderProjectFiles(program.getRootFileNames(), programFiles.reverse()), expected)
    })
  }
})

// The generated RTK Query client, with the starter request function, must work in a client using Redux Toolkit 2
//
// test/fixtures/client is a client project set up as described in the README: the client is generated into it, then
// type-checked along with code using it.

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { before, describe, test } from 'node:test'

import { assertBuilt, FIXTURES, REPO } from './harness.mjs'

const require = createRequire(import.meta.url)

const CLIENT = path.join(FIXTURES, 'client')
const GENERATED = path.join(CLIENT, 'src', 'api')
const BIN = path.join(REPO, 'build', 'bin.js')
const TSC = path.join(REPO, 'node_modules', 'typescript', 'bin', 'tsc')

before(assertBuilt)

function generate(engine) {
  // Remove the previous output, including the starter request function so that it's generated again
  fs.rmSync(GENERATED, { recursive: true, force: true })
  fs.mkdirSync(GENERATED, { recursive: true })

  const result = spawnSync(process.execPath, [BIN, 'api-gen.config.json', '--generate-rtk', `--engine=${engine}`], {
    cwd: CLIENT,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(fs.existsSync(path.join(GENERATED, 'BaseRequest.ts')), 'the starter request function should be generated')
}

describe('generated RTK Query client', () => {
  // Engines run one after the other, as they generate into the same directory
  for (const engine of ['tsgo', 'ts-morph']) {
    test(`type-checks with Redux Toolkit 2 (${engine} engine)`, () => {
      generate(engine)

      const result = spawnSync(process.execPath, [TSC, '--project', CLIENT], { encoding: 'utf8' })
      assert.equal(result.status, 0, result.stdout + result.stderr)
    })
  }

  test('the starter request function has a default user message', () => {
    generate('tsgo')

    // Transpile the starter request function and check its error messages at runtime
    const ts = require('typescript-6')
    const source = fs.readFileSync(path.join(GENERATED, 'BaseRequest.ts'), 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })

    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'nest-sdk-generator-base-request-')), 'BaseRequest.cjs')
    fs.writeFileSync(file, outputText)
    const { RequestError, RequestErrorType } = require(file)

    const http = { req: { method: 'GET', url: 'https://example.com/users' } }
    const fetchError = new RequestError({ http, type: RequestErrorType.FETCH_ERROR })
    assert.equal(fetchError.userMessage, "An unexpected error occurred. We're looking into it!")

    const apiError = new RequestError({
      http: { ...http, res: { status: 400, statusDescription: 'Bad Request', text: JSON.stringify({ message: 'Invalid email' }) } },
      type: RequestErrorType.API_ERROR,
    })
    assert.equal(apiError.userMessage, 'Invalid email')

    fs.rmSync(path.dirname(file), { recursive: true, force: true })
  })
})

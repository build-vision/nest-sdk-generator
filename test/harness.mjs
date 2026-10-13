// Parity test harness: runs the generator CLI with several engines / builds and snapshots everything it produces

import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)

export const REPO = path.resolve(import.meta.dirname, '..')
export const FIXTURES = path.join(REPO, 'test', 'fixtures')

const CURRENT_BIN = path.join(REPO, 'build', 'bin.js')
const BASELINE_BIN = path.join(REPO, '.parity', 'baseline', 'build', 'bin.js')

/** TypeScript used by the "typescript" engine in tests (a real project would use its own) */
export const TYPESCRIPT_6_PATH = path.dirname(require.resolve('typescript-6/package.json'))

/**
 * Ways to run the generator
 * - baseline: the generator as built from the main branch (see scripts/build-baseline.sh)
 * - the others: the current build, with each analysis engine
 */
export const VARIANTS = {
  baseline: { bin: BASELINE_BIN, args: [] },
  'ts-morph': { bin: CURRENT_BIN, args: ['--engine=ts-morph'] },
  'ts-morph-compat': { bin: CURRENT_BIN, args: ['--engine=ts-morph-compat'] },
  tsgo: { bin: CURRENT_BIN, args: ['--engine=tsgo'] },
  typescript: { bin: CURRENT_BIN, args: ['--engine=typescript'] },
}

/** Variants that must produce exactly the same results as the baseline (TypeScript 4.8) */
export const LEGACY_VARIANTS = ['baseline', 'ts-morph', 'ts-morph-compat']

/** Variants that must produce exactly the same results as each other (TypeScript 6 / 7) */
export const FAST_VARIANTS = ['tsgo', 'typescript']

export function assertBuilt() {
  for (const bin of [CURRENT_BIN, BASELINE_BIN]) {
    if (!fs.existsSync(bin)) {
      throw new Error(`Missing ${path.relative(REPO, bin)}: run "npm run build" and "npm run build:baseline" first`)
    }
  }
}

let tmpRoot = null

function getTmpRoot() {
  tmpRoot ??= fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nest-sdk-generator-parity-'))
  return tmpRoot
}

export function cleanup() {
  if (tmpRoot && !process.env.KEEP_PARITY_OUTPUT) fs.rmSync(tmpRoot, { recursive: true, force: true })
}

/** Write a map of relative paths to contents in a directory */
export function writeFiles(dir, files) {
  for (const [file, content] of Object.entries(files)) {
    const fullPath = path.join(dir, file)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, content)
  }
}

/** Read all files in a directory as a map of relative paths to contents */
function readTree(dir, base = dir, out = {}) {
  if (!fs.existsSync(dir)) return out

  for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) readTree(fullPath, base, out)
    else out[path.relative(base, fullPath)] = fs.readFileSync(fullPath, 'utf8')
  }

  return out
}

function run(bin, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [bin, ...args], { cwd, env: { ...process.env, FORCE_COLOR: '0' } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (d) => (stdout += d))
    child.stderr.on('data', (d) => (stderr += d))
    child.on('close', (exitCode) => resolve({ exitCode, stdout, stderr }))
  })
}

/** Remove what legitimately differs between two runs: timings, dates, temporary paths, stack traces */
function normalizeText(text, runDir) {
  text = text
    .split(runDir)
    .join('<RUN>')
    .replace(/Done in \d+\.\d+s/g, 'Done in <TIME>')
    .replace(/Generated on: .*/g, 'Generated on: <DATE>')

  // Uncaught exceptions: only keep the error message (stack traces and error class names depend on the implementation)
  if (/\n {4}at /.test(text)) {
    const message = text.match(/^[\w.]*(?:Error|Exception)\w*: ([^]*?)\n {4}at /m)
    return 'UNCAUGHT ' + (message ? message[1] : text)
  }

  return text
}

/** Debug lines specific to an engine */
const ENGINE_LOG_LINES = /^(Analysis engine: .*|Using TypeScript .*)\n/gm

/**
 * Run the generator with a given variant
 * @param {object} scenario
 * @param {string} scenario.name Unique name
 * @param {object} scenario.config Configuration file content (paths relative to the run directory)
 * @param {string[]} [scenario.args] CLI arguments after the configuration path (e.g. ["--generate-rtk"])
 * @param {Record<string, string>} [scenario.files] Files to create in the run directory before running
 * @param {string} variant
 */
export async function runVariant(scenario, variant) {
  const { args: variantArgs, bin } = VARIANTS[variant]
  const runDir = path.join(getTmpRoot(), scenario.name, variant)

  fs.rmSync(runDir, { recursive: true, force: true })
  fs.mkdirSync(runDir, { recursive: true })
  writeFiles(runDir, scenario.files ?? {})

  const config = { typescriptPath: TYPESCRIPT_6_PATH, ...scenario.config }
  fs.writeFileSync(path.join(runDir, 'config.json'), JSON.stringify(config, null, 2))

  // The baseline only supports the output type as first argument, and no engine option
  const args = ['config.json', ...(scenario.args ?? []), ...variantArgs]
  const result = await run(bin, args, runDir)

  const files = readTree(runDir)
  delete files['config.json']

  for (const file of Object.keys(files)) {
    files[file] = normalizeText(files[file], runDir)
  }

  return {
    exitCode: result.exitCode,
    stdout: normalizeText(result.stdout, runDir).replace(ENGINE_LOG_LINES, ''),
    stderr: normalizeText(result.stderr, runDir).replace(ENGINE_LOG_LINES, ''),
    files,
  }
}

/** Run a scenario with all variants */
export async function runAllVariants(scenario, variants = Object.keys(VARIANTS)) {
  const results = await Promise.all(variants.map((variant) => runVariant(scenario, variant)))
  return Object.fromEntries(variants.map((variant, i) => [variant, results[i]]))
}

/** Describe the differences between two snapshots, for assertion messages */
export function describeDiff(a, b, nameA, nameB) {
  const lines = []
  for (const key of ['exitCode', 'stdout', 'stderr']) {
    if (a[key] !== b[key]) lines.push(`${key}:\n  ${nameA}: ${JSON.stringify(a[key])}\n  ${nameB}: ${JSON.stringify(b[key])}`)
  }
  const files = new Set([...Object.keys(a.files), ...Object.keys(b.files)])
  for (const file of files) {
    if (a.files[file] !== b.files[file]) {
      if (a.files[file] === undefined || b.files[file] === undefined) {
        lines.push(`file ${file}: only produced by ${a.files[file] === undefined ? nameB : nameA}`)
      } else {
        const la = a.files[file].split('\n')
        const lb = b.files[file].split('\n')
        const i = la.findIndex((line, i) => line !== lb[i])
        lines.push(`file ${file}: first difference at line ${i + 1}\n  ${nameA}: ${la[i]}\n  ${nameB}: ${lb[i]}`)
      }
    }
  }
  return lines.join('\n')
}

// Parity tests on the fixture API: every engine must generate exactly what it is expected to
//
// - "legacy" variants (baseline build from main, ts-morph engine, ts-morph-compat engine) must all match
// - "fast" variants (tsgo engine, typescript engine) must match each other
//
// See test/fixtures/api for the code paths covered by the fixture.

import assert from 'node:assert/strict'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { assertBuilt, cleanup, describeDiff, FAST_VARIANTS, FIXTURES, LEGACY_VARIANTS, runAllVariants } from './harness.mjs'

const API = path.join(FIXTURES, 'api')

const PRETTIERRC = JSON.stringify({ singleQuote: true, jsxSingleQuote: true, trailingComma: 'es5' })

const FRONTEND_LIKE_CONFIG = {
  verbose: false,
  apiInputPath: API,
  sdkOutputPath: './out',
  sdkInterfacePath: './BaseRequest.ts',
  overwriteOldOutputDir: true,
  generateTimestamps: false,
  controllerOutput: {
    endpointGroupName: { removeSuffix: 'Controller', addSuffix: '' },
    exportName: { removeSuffix: 'Controller', addSuffix: 'Endpoints' },
    fileName: { removeSuffix: '.controller', addSuffix: '.endpoints' },
  },
  magicTypes: [
    {
      nodeModuleFilePath: 'fake-lib/index.d.ts',
      typeName: 'Decimal',
      placeholderContent: 'export type Decimal = string;',
    },
  ],
}

/** The baseline crashes when writing the JSON output (fixed in the current version) */
const BASELINE_JSON_BUG = 'the baseline crashes with "Converting circular structure to JSON" when jsonOutput is set'

const SCENARIOS = [
  {
    name: 'rtk-frontend-like',
    description: 'RTK Query endpoints, configured like the BuildVision frontend',
    config: FRONTEND_LIKE_CONFIG,
    args: ['--generate-rtk'],
    files: { '.prettierrc': PRETTIERRC, 'BaseRequest.ts': '// existing SDK interface\n' },
    expectedExitCode: 0,
    expectedFiles: ['out/index.ts', 'out/users.endpoints.ts', 'out/comments.endpoints.ts', 'out/baseRequest.ts'],
  },
  {
    name: 'rtk-defaults',
    description: 'RTK Query endpoints with default options (timestamps, default SDK interface, Prettier defaults)',
    config: { apiInputPath: API, sdkOutputPath: './out', sdkInterfacePath: './BaseRequest.ts' },
    args: ['--generate-rtk'],
    expectedExitCode: 0,
    expectedFiles: ['out/index.ts', 'out/users.controller.ts', 'BaseRequest.ts'],
  },
  {
    name: 'generate-frontend-like',
    description: 'Plain SDK with type files (without the articles controllers, see generate-index-signature)',
    config: { ...FRONTEND_LIKE_CONFIG, tsconfigFile: 'tsconfig.custom.json' },
    args: ['--generate'],
    files: { '.prettierrc': PRETTIERRC },
    expectedExitCode: 0,
    expectedFiles: ['out/index.ts', 'out/central.ts', 'out/_types/src/entities/user.entity.ts', 'out/_types/_external1/shared/money.ts'],
  },
  {
    name: 'generate-index-signature',
    description: 'Known bug: type files for classes with an index signature are rejected by Prettier',
    config: FRONTEND_LIKE_CONFIG,
    args: ['--generate'],
    expectedExitCode: 1,
    expectedFiles: [],
    expectedOutput: /'public' modifier cannot appear on an index signature/,
  },
  {
    name: 'generate-unformatted-json',
    description: 'Plain SDK without Prettier, with a pretty JSON output and a magic type overriding a builtin one',
    config: {
      apiInputPath: API,
      sdkOutputPath: './out',
      sdkInterfacePath: './sdk-interface.ts',
      prettify: false,
      generateTimestamps: false,
      jsonOutput: './analysis.json',
      jsonPrettyOutput: true,
      magicTypes: [
        {
          nodeModuleFilePath: '@mikro-orm/core/entity/Collection.d.ts',
          typeName: 'Collection',
          placeholderContent: 'export type Collection<T> = ReadonlyArray<T>;',
        },
      ],
    },
    args: ['--generate'],
    expectedExitCode: 0,
    expectedFiles: ['analysis.json', 'sdk-interface.ts', 'out/_types/src/entities/user.entity.ts', 'out/_types/src/entities/article.entity.ts'],
    baselineSkipReason: BASELINE_JSON_BUG,
  },
  {
    name: 'analysis-only-json',
    description: 'Analysis only, with a minified JSON output',
    config: { apiInputPath: API, sdkOutputPath: './out', sdkInterfacePath: './sdk.ts', jsonOutput: './analysis.json' },
    args: [],
    expectedExitCode: 0,
    expectedFiles: ['analysis.json'],
    baselineSkipReason: BASELINE_JSON_BUG,
  },
  {
    name: 'custom-tsconfig-verbose',
    description: 'Custom tsconfig file name, verbose logs',
    config: { ...FRONTEND_LIKE_CONFIG, tsconfigFile: 'tsconfig.custom.json', verbose: true },
    args: ['--generate-rtk'],
    files: { 'BaseRequest.ts': '// existing SDK interface\n' },
    expectedExitCode: 0,
    expectedFiles: ['out/users.endpoints.ts'],
  },
  {
    name: 'overwrite-output',
    description: 'Existing output directory is replaced',
    config: { ...FRONTEND_LIKE_CONFIG, generateDefaultSdkInterface: false },
    args: ['--generate-rtk'],
    files: { 'out/stale.ts': 'stale' },
    expectedExitCode: 0,
    expectedFiles: ['out/index.ts'],
  },
  {
    name: 'no-overwrite-output',
    description: 'Existing output directory is kept when overwriting is disabled',
    config: { ...FRONTEND_LIKE_CONFIG, overwriteOldOutputDir: false },
    args: ['--generate-rtk'],
    files: { 'out/stale.ts': 'stale' },
    expectedExitCode: 1,
    expectedFiles: ['out/stale.ts'],
  },
]

before(assertBuilt)
after(cleanup)

describe('fixture API', { concurrency: true }, () => {
  for (const scenario of SCENARIOS) {
    test(`${scenario.name}: ${scenario.description}`, async () => {
      const legacyVariants = scenario.baselineSkipReason ? LEGACY_VARIANTS.filter((v) => v !== 'baseline') : LEGACY_VARIANTS
      const results = await runAllVariants(scenario, [...legacyVariants, ...FAST_VARIANTS])

      // Sanity checks, so that a scenario where all variants fail the same way doesn't pass silently
      for (const [variant, result] of Object.entries(results)) {
        assert.equal(result.exitCode, scenario.expectedExitCode, `${variant} exit code\n${result.stdout}\n${result.stderr}`)

        for (const file of scenario.expectedFiles) {
          assert.ok(file in result.files, `${variant} should produce ${file} (got: ${Object.keys(result.files).join(', ')})`)
        }

        if (scenario.expectedOutput) {
          assert.match(result.stdout + result.stderr, scenario.expectedOutput, `${variant} output`)
        }
      }

      const [legacyReference, ...legacyOthers] = legacyVariants
      for (const variant of legacyOthers) {
        assert.ok(
          JSON.stringify(results[variant]) === JSON.stringify(results[legacyReference]),
          `${variant} differs from ${legacyReference}:\n${describeDiff(results[legacyReference], results[variant], legacyReference, variant)}`
        )
      }

      const [reference, ...others] = FAST_VARIANTS
      for (const variant of others) {
        assert.ok(
          JSON.stringify(results[variant]) === JSON.stringify(results[reference]),
          `${variant} differs from ${reference}:\n${describeDiff(results[reference], results[variant], reference, variant)}`
        )
      }
    })
  }
})

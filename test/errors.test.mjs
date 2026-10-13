// Parity tests on error paths: every engine must fail the same way, with the same message
//
// Each case is a minimal API project generated in a temporary directory.

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { after, before, describe, test } from 'node:test'

import { assertBuilt, cleanup, describeDiff, FAST_VARIANTS, FIXTURES, LEGACY_VARIANTS, runAllVariants, writeFiles } from './harness.mjs'

const NEST_COMMON = path.join(FIXTURES, 'api', 'node_modules', '@nestjs', 'common')

const projectsRoot = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'nest-sdk-generator-errors-'))

const IMPORTS = `import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Put, Query } from '@nestjs/common'\n`

/** A module file */
const module = (name) => `${IMPORTS}\n@Module({})\nexport class ${name} {}\n`

/** A controller file with the given class body */
const controller = (decorator, name, body) => `${IMPORTS}\n${decorator}\nexport class ${name} {\n${body}\n}\n`

/** Create a minimal API project, returns its path */
function createProject(name, files) {
  const dir = path.join(projectsRoot, name)
  writeFiles(dir, {
    'package.json': '{ "private": true }',
    'tsconfig.json': JSON.stringify({
      compilerOptions: {
        strict: true,
        experimentalDecorators: true,
        module: 'nodenext',
        moduleResolution: 'nodenext',
        target: 'es2022',
        types: [],
        noEmit: true,
      },
      include: ['src'],
    }),
    ...files,
  })
  fs.cpSync(NEST_COMMON, path.join(dir, 'node_modules', '@nestjs', 'common'), { recursive: true })
  return dir
}

/** A project with a single module and controller */
const singleController = (body, decorator = "@Controller('things')") => ({
  'src/things/things.module.ts': module('ThingsModule'),
  'src/things/things.controller.ts': controller(decorator, 'ThingsController', body),
})

const CASES = [
  // ===== Parameters ===== //
  {
    name: 'get-with-body',
    files: singleController(`  @Get() find(@Body() body: { a: string }) { return body }`),
    expected: /GET request should not have @Body params/,
  },
  {
    name: 'post-with-query',
    files: singleController(`  @Post() create(@Query('a') a: string) { return a }`),
    expected: /POST request should not have @Query params/,
  },
  {
    name: 'route-param-not-in-url',
    files: singleController(`  @Get(':id') find(@Param('other') other: string) { return other }`),
    expected: /Route param other does not appear in route URL/,
  },
  {
    name: 'generic-route-params',
    files: singleController(`  @Get(':id') find(@Param() params: { id: string }) { return params }`),
    expected: /Route param rawType does not appear in route URL/,
  },
  {
    name: 'same-query-key-twice',
    files: singleController(`  @Get() find(@Query('a') a: string, @Query('a') b: string) { return a + b }`),
    expected: /Query\('a'\) used twice in controller method/,
  },
  {
    name: 'generic-body-twice',
    files: singleController(`  @Post() create(@Body() a: { a: string }, @Body() b: { b: string }) { return [a, b] }`),
    expected: /Body\(\) used twice in controller method/,
  },
  {
    name: 'mixed-generic-and-keyed-body',
    files: singleController(`  @Put() update(@Body() a: { a: string }, @Body('b') b: string) { return [a, b] }`),
    expected: /Cannot mix generic and specific Body\(\)/,
  },
  {
    name: 'argument-with-two-decorators',
    files: singleController(`  @Patch() update(@Body() @Query() a: { a: string }) { return a }`),
    expected: /ThingsController update has multiple decorators on argument a Body, Query/,
  },
  {
    name: 'generic-query-not-an-object',
    files: singleController(`  @Get() find(@Query() q: string) { return q }`),
    expected: /generic controller argument Query\(\) q must be an object type/,
  },
  {
    name: 'decorator-argument-not-a-literal',
    files: {
      ...singleController(''),
      'src/things/things.controller.ts': `const KEY = 'q'\n` + controller("@Controller('things')", 'ThingsController', `  @Get() find(@Query(KEY) q: string) { return q }`),
    },
    expected: /The argument provided to the decorator is not a string literal/,
  },
  {
    name: 'decorator-with-two-arguments',
    files: singleController(`  @Delete() remove(@Body('a', 'pipe') a: string) { return a }`),
    expected: /Body\(\) a argument decorator has multiple parameters/,
  },
  {
    name: 'param-key-collides-with-object-property',
    files: singleController(`  @Get(':constructor') find(@Param('constructor') c: string) { return c }`),
    expected: /Param\('constructor'\) param name collides with JavaScript native object property/,
  },

  // ===== Methods & routes ===== //
  {
    name: 'two-http-decorators',
    files: singleController(`  @Get() @Post() find() { return 1 }`),
    expected: /Missing parameter/,
  },
  {
    name: 'http-decorator-with-two-arguments',
    files: singleController(`  @Get('a', 'b') find() { return 1 }`),
    expected: /Multiple \(2\) arguments were provided to the HTTP decorator/,
  },
  {
    name: 'http-decorator-argument-not-a-literal',
    files: {
      ...singleController(''),
      'src/things/things.controller.ts': `const PATH = 'a'\n` + controller("@Controller('things')", 'ThingsController', `  @Get(PATH) find() { return 1 }`),
    },
    expected: /The argument provided to the HTTP decorator is not a string literal/,
  },
  {
    name: 'wildcard-route',
    files: singleController(`  @Get('files/*') find() { return 1 }`),
    expected: /Generic symbols \(\* \+ \?\) are not supported/,
  },
  {
    name: 'invalid-route-param-name',
    files: singleController(`  @Get(':id-x') find() { return 1 }`),
    expected: /Invalid character detected in named parameter in URI/,
  },
  {
    name: 'unsupported-decorator-expression',
    files: singleController(`  @(Get as any)() find() { return 1 }`),
    expected: /to be an identifier/,
  },

  // ===== Controllers & modules ===== //
  {
    name: 'no-module-file',
    files: { 'src/things/things.controller.ts': controller("@Controller('things')", 'ThingsController', `  @Get() find() { return 1 }`) },
    expected: /No module file was found for controller at path/,
  },
  {
    name: 'module-without-decorated-class',
    files: { ...singleController(`  @Get() find() { return 1 }`), 'src/things/things.module.ts': `export class ThingsModule {}\n` },
    expected: /No class declaration found in module at/,
  },
  {
    name: 'module-without-module-decorator',
    files: {
      ...singleController(`  @Get() find() { return 1 }`),
      'src/things/things.module.ts': `${IMPORTS}\n@Controller()\nexport class ThingsModule {}\n`,
    },
    expected: /Module class ThingsModule is missing @Module decorator/,
  },
  {
    name: 'duplicate-controller-names',
    files: {
      'src/a/a.module.ts': module('AModule'),
      'src/a/things.controller.ts': controller("@Controller('a')", 'ThingsController', `  @Get() findA() { return 1 }`),
      'src/b/b.module.ts': module('BModule'),
      'src/b/things.controller.ts': controller("@Controller('b')", 'ThingsController', `  @Get() findB() { return 1 }`),
    },
    expected: /Detected two controllers with the same name/,
  },
  {
    name: 'registration-name-collides-with-object-property',
    files: singleController(`  @Get() find() { return 1 }`, "@Controller('constructor')"),
    expected: /Detected controller whose registration name constructor collides/,
  },
  {
    name: 'module-name-collides-with-object-property',
    files: {
      'src/things/things.module.ts': `${IMPORTS}\n@Module({})\nexport class toString {}\n`,
      'src/things/things.controller.ts': controller("@Controller('things')", 'ThingsController', `  @Get() find() { return 1 }`),
    },
    expected: /Detected module whose name toString collides/,
  },
  {
    name: 'rtk-duplicate-method-names',
    files: {
      'src/a/a.module.ts': module('AModule'),
      'src/a/a.controller.ts': controller("@Controller('a')", 'AController', `  @Get() find() { return 1 }`),
      'src/b/b.module.ts': module('BModule'),
      'src/b/b.controller.ts': controller("@Controller('b')", 'BController', `  @Get() find() { return 2 }`),
    },
    expected: /Duplicate method name found: find in/,
  },

  // ===== Types extraction ===== //
  {
    name: 'type-not-found-in-file',
    files: {
      ...singleController(''),
      'src/things/things.controller.ts':
        `import { Inner } from './ns'\n` + controller("@Controller('things')", 'ThingsController', `  @Get() find(): Inner.Thing { return { a: 1 } }`),
      'src/things/ns.ts': `export namespace Inner {\n  export interface Thing { a: number }\n}\n`,
    },
    expected: /Type Thing was not found in file|Type Inner was not found in file/,
  },
  {
    name: 'dependency-type-not-found',
    files: {
      ...singleController(''),
      'src/things/things.controller.ts':
        `import { Outer } from './types'\n` + controller("@Controller('things')", 'ThingsController', `  @Get() find(): Outer { return { inner: { a: 1 } } }`),
      'src/things/types.ts': `import { Inner } from './ns'\nexport interface Outer { inner: Inner.Thing }\n`,
      'src/things/ns.ts': `export namespace Inner {\n  export interface Thing { a: number }\n}\n`,
    },
    expected: /Failed to extract type Outer due to an error in dependency type/,
  },
]

/** Configuration errors, on a valid project */
const CONFIG_CASES = [
  { name: 'missing-api-dir', config: { apiInputPath: './does-not-exist' }, expected: /Provided source path .* does not exist/ },
  { name: 'api-path-is-a-file', config: { apiInputPath: './config.json' }, expected: /Provided source path is not a directory/ },
  { name: 'tsconfig-name-with-slash', config: { tsconfigFile: 'sub/tsconfig.json' }, expected: /Provided tsconfig file name contains slashes/ },
  { name: 'missing-tsconfig', config: { tsconfigFile: 'tsconfig.missing.json' }, expected: /No tsconfig.missing.json file found in provided source path/ },
  { name: 'missing-json-output-dir', config: { jsonOutput: './missing/analysis.json' }, expected: /Output file's parent directory .* does not exist/ },
  { name: 'missing-output-parent-dir', config: { sdkOutputPath: './missing/out' }, expected: /Output directory's parent .* does not exist/ },
]

before(assertBuilt)
after(() => {
  cleanup()
  fs.rmSync(projectsRoot, { recursive: true, force: true })
})

function assertParity(results, expected) {
  for (const [variant, result] of Object.entries(results)) {
    assert.equal(result.exitCode, 1, `${variant} should fail\n${result.stdout}\n${result.stderr}`)
    assert.match(result.stdout + result.stderr, expected, `${variant} output`)
  }

  for (const group of [LEGACY_VARIANTS, FAST_VARIANTS]) {
    const [reference, ...others] = group
    for (const variant of others) {
      assert.ok(
        JSON.stringify(results[variant]) === JSON.stringify(results[reference]),
        `${variant} differs from ${reference}:\n${describeDiff(results[reference], results[variant], reference, variant)}`
      )
    }
  }
}

describe('analysis errors', { concurrency: os.availableParallelism() }, () => {
  for (const { expected, files, name } of CASES) {
    test(name, async () => {
      const apiInputPath = createProject(name, files)
      const results = await runAllVariants({
        name: `error-${name}`,
        config: { apiInputPath, sdkOutputPath: './out', sdkInterfacePath: './sdk.ts', generateTimestamps: false },
        args: ['--generate-rtk'],
      })
      assertParity(results, expected)
    })
  }
})

describe('configuration errors', { concurrency: os.availableParallelism() }, () => {
  for (const { config, expected, name } of CONFIG_CASES) {
    test(name, async () => {
      const apiInputPath = createProject(`config-${name}`, singleController(`  @Get() find() { return 1 }`))
      const results = await runAllVariants({
        name: `config-${name}`,
        config: { apiInputPath, sdkOutputPath: './out', sdkInterfacePath: './sdk.ts', ...config },
        args: ['--generate-rtk'],
      })
      assertParity(results, expected)
    })
  }
})

/**
 * @file Analysis engines
 *
 * - `tsgo` (default): TypeScript 7's native compiler, through its API. Fastest.
 * - `typescript`: the TypeScript compiler installed for the analyzed API (6.x), running in-process. Generates the same SDK
 *   as `tsgo`, and is used automatically if `tsgo` can't be started.
 * - `ts-morph`: the original analyzer, running on the TypeScript 4.8 compiler bundled with ts-morph. Slowest; generates
 *   the same SDK as previous versions of this tool (which may differ from TypeScript 6+ on some inferred types).
 */

/* eslint-disable @typescript-eslint/no-var-requires -- engines are loaded lazily, as loading a compiler is expensive */

import * as path from 'path'

import type { SdkContent } from '../analyzer/sdk'
import { Config } from '../config'
import { debug, notice, panic } from '../logging'

import { analyzeWithHost } from './analyze'

export const ENGINES = ['tsgo', 'typescript', 'ts-morph'] as const

export type EngineName = (typeof ENGINES)[number]

/** Internal engine running this analyzer on ts-morph's program, used to verify it matches the legacy analyzer */
const TS_MORPH_COMPAT_ENGINE = 'ts-morph-compat'

export function isEngineName(name: string): name is EngineName {
  return (ENGINES as readonly string[]).includes(name) || name === TS_MORPH_COMPAT_ENGINE
}

export async function analyze(config: Config, engine: EngineName): Promise<SdkContent> {
  debug('Analysis engine: {yellow}', engine)

  const sourcePath = path.resolve(process.cwd(), config.apiInputPath)

  switch (engine as string) {
    // Engines are loaded lazily: loading a compiler is expensive
    case 'ts-morph': {
      const { analyzerCli }: typeof import('../analyzer') = require('../analyzer')
      return analyzerCli(config)
    }

    case TS_MORPH_COMPAT_ENGINE: {
      const { createTsMorphCompatHost }: typeof import('./ts-morph-compat-host') = require('./ts-morph-compat-host')
      return analyzeWithHost(config, createTsMorphCompatHost)
    }

    case 'typescript': {
      const { createTypeScriptHost, loadTypeScript }: typeof import('./typescript-host') = require('./typescript-host')
      return analyzeWithHost(config, (tsConfigFilePath) =>
        createTypeScriptHost(loadTypeScript(sourcePath, config.typescriptPath), tsConfigFilePath)
      )
    }

    case 'tsgo': {
      const { createTsgoHost }: typeof import('./tsgo-host') = require('./tsgo-host')
      const { createTypeScriptHost, loadTypeScript }: typeof import('./typescript-host') = require('./typescript-host')

      return analyzeWithHost(config, (tsConfigFilePath) => {
        try {
          return createTsgoHost(tsConfigFilePath)
        } catch (e) {
          // Only startup failures end up here (e.g. no native binary for this platform): analysis errors happen later on
          notice(
            'Could not start the {yellow} engine, falling back to the {yellow} engine (same output, slower):\n{}',
            'tsgo',
            'typescript',
            e instanceof Error ? e.message : String(e)
          )
          return createTypeScriptHost(loadTypeScript(sourcePath, config.typescriptPath), tsConfigFilePath)
        }
      })
    }

    default:
      panic('Unknown analysis engine {yellow} (expected one of: {})', engine, ENGINES.join(', '))
  }
}

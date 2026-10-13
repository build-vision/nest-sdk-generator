#!/usr/bin/env node

import * as path from 'path'

import { config, configPath } from './config'
import { analyze, ENGINES, EngineName, isEngineName } from './engine'
import generateAPIClient from './generator'
import { log, panic } from './logging'
import generateRTKQueryEndpoints from './rtk-query-generator'

/**
 * Get the analysis engine to use: `--engine <name>` or `--engine=<name>` on the command line,
 * then the configuration file's `engine` option, then the default one
 */
function getEngine(args: string[]): EngineName {
  let engine: string = config.engine ?? 'tsgo'

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--engine') {
      engine = args[++i] ?? ''
    } else if (args[i].startsWith('--engine=')) {
      engine = args[i].substring('--engine='.length)
    }
  }

  if (!isEngineName(engine)) {
    panic('Unknown analysis engine {yellow} (expected one of: {})', engine, ENGINES.join(', '))
  }

  return engine
}

async function main() {
  const started = Date.now()

  const args = process.argv.slice(3)
  const engine = getEngine(args)
  const outputType = args.find((arg) => arg === '--generate' || arg === '--generate-rtk')

  process.chdir(path.dirname(path.resolve(configPath)))

  const sdkContent = await analyze(config, engine)

  if (outputType === '--generate') {
    await generateAPIClient(config, sdkContent)
  }

  if (outputType === '--generate-rtk') {
    log('> Generating RTK Query endpoints for Nest API...')
    await generateRTKQueryEndpoints(config, sdkContent)
  }

  log('> Done in ' + ((Date.now() - started) / 1000).toFixed(2) + 's')
}

main()

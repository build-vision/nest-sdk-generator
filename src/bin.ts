#!/usr/bin/env node

import * as path from 'path'

import { analyzerCli } from './analyzer'
import { config, configPath } from './config'
import generateAPIClient from './generator'
import { log } from './logging'
import generateRTKQueryEndpoints from './rtk-query-generator'

async function main() {
  const started = Date.now()

  process.chdir(path.dirname(path.resolve(configPath)))

  const sdkContent = await analyzerCli(config)

  const outputType = process.argv[3]

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

#!/usr/bin/env node

import * as path from 'path'

import { analyzerCli } from './analyzer'
import { config, configPath } from './config'
import generatorCli from './generator'
import { println } from './logging'

async function main() {
  const started = Date.now()

  process.chdir(path.dirname(path.resolve(configPath)))

  const sdkContent = await analyzerCli(config)
  if (process.argv[3] === '--generate') {
    await generatorCli(config, sdkContent)
  }

  println('{green}', '@ Done in ' + ((Date.now() - started) / 1000).toFixed(2) + 's')
}

main()

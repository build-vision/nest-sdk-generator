/**
 * @file Entrypoint of the SDK generator
 */

import * as fs from 'fs'
import * as path from 'path'
import { SdkContent } from '../analyzer'
import { normalizeExternalFilePath } from '../analyzer/typedeps'
import { Config } from '../config'
import { debug, panic, println } from '../logging'
import { generateSdkModules } from './genmodules'
import { generateSdkTypeFiles } from './gentypes'
import { findPrettierConfig, prettify } from './prettier'
import { defaultSdkInterface } from './sdk-interface'

export default async function generatorCli(config: Config, sdkContent: SdkContent): Promise<void> {
  const prettifyOutput = config.prettify !== false

  if (!prettifyOutput) {
    debug('NOTE: files will not be prettified with Prettier')
  }

  const output = path.resolve(process.cwd(), config.sdkOutput)

  if (fs.existsSync(output)) {
    if (config.overwriteOldOutputDir === false) {
      panic("Please provide an output directory that doesn't exist yet")
    } else {
      if (!fs.existsSync(path.join(output, 'central.ts'))) {
        panic("Provided output path exists but doesn't seem to contain an SDK output. Please check the output directory.")
      } else {
        fs.rmSync(output, { recursive: true })
      }
    }
  }

  const outputParentDir = path.dirname(output)

  if (!fs.existsSync(outputParentDir)) {
    panic("Output directory's parent {magentaBright} does not exist.", outputParentDir)
  }

  fs.mkdirSync(output)

  const prettierConfig = prettifyOutput ? findPrettierConfig(config) : {}

  const writeScriptTo = (parentDir: null | string, file: string, utf8Content: string) => {
    const fullPath = path.resolve(output, parentDir ?? '', file)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(
      fullPath,
      prettifyOutput ? prettify(utf8Content, prettierConfig, file.endsWith('.json') ? 'json' : 'typescript') : utf8Content,
      'utf8'
    )
  }

  println('> Generating type files...')

  for (const [file, content] of generateSdkTypeFiles(sdkContent.types)) {
    writeScriptTo('_types', normalizeExternalFilePath(file), content)
  }

  println('> Generating modules...')

  for (const [file, content] of generateSdkModules(sdkContent.modules)) {
    writeScriptTo(null, file, content)
  }

  const sdkInterfacePath = path.resolve(process.cwd(), config.sdkInterfacePath)

  const relativeSdkInterfacePath = path
    .relative(output, sdkInterfacePath)
    .replace(/\\/g, '/')
    .replace(/\.([jt]sx?)$/, '')

  writeScriptTo(null, 'central.ts', `export { request } from "${relativeSdkInterfacePath}"`)

  if (!fs.existsSync(sdkInterfacePath) && config.generateDefaultSdkInterface !== false) {
    println('> Generating default SDK interface...')

    fs.writeFileSync(sdkInterfacePath, defaultSdkInterface, 'utf8')
  }
}

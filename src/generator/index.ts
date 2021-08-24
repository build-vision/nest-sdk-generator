import * as fs from 'fs'
import * as path from 'path'
import { debug, JsonValue, None, panic, println } from 'typescript-core'
import { SdkContent } from '../analyzer'
import { Config } from '../config'
import { CENTRAL_FILE } from './central'
import { generateSdkModules } from './genmodules'
import { generateSdkTypeFiles } from './gentypes'
import { findPrettierConfig, prettify } from './prettier'

export default async function generatorCli(config: Config, sdkContent: SdkContent): Promise<void> {
  const started = Date.now()

  if (config.prettify) {
    debug("NOTE: '--prettify' option was provided, files will be prettified with Prettier")
  }

  const output = path.resolve(process.cwd(), config.sdkOutput)

  if (fs.existsSync(output)) {
    if (config.removeOldOutputDir.unwrapOr(false)) {
      if (!fs.existsSync(path.join(output, 'central.ts'))) {
        panic("Provided output path exists but doesn't seem to contain an SDK output. Please check the output directory.")
      } else {
        fs.rmSync(output, { recursive: true })
      }
    } else {
      panic("Please provide an output directory that doesn't exist yet")
    }
  }

  const outputParentDir = path.dirname(output)

  if (!fs.existsSync(outputParentDir)) {
    panic("Output directory's parent {magentaBright} does not exist.", outputParentDir)
  }

  fs.mkdirSync(output)

  const writeScriptTo = (parentDir: null | string, file: string, utf8Content: string) => {
    const fullPath = path.resolve(output, parentDir ?? '', file)
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(
      fullPath,
      config.prettify ? prettify(utf8Content, prettierConfig, file.endsWith('.json') ? 'json' : 'typescript') : utf8Content,
      'utf8'
    )
  }

  const prettierConfig = config.prettify ? findPrettierConfig(config) : None<JsonValue>()

  println('> Generating type files...')

  for (const [file, content] of generateSdkTypeFiles(sdkContent.types)) {
    writeScriptTo('_types', file, content)
  }

  println('> Generating modules...')

  for (const [file, content] of generateSdkModules(sdkContent.modules)) {
    writeScriptTo(null, file, content)
  }

  const configScriptPath = path.resolve(process.cwd(), config.configScriptPath)

  writeScriptTo(null, 'central.ts', CENTRAL_FILE(path.relative(output, configScriptPath), config.configNameToImport))

  println('{green}', '@ Done in ' + ((Date.now() - started) / 1000).toFixed(2) + 's')
}

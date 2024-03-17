import * as fs from 'fs'
import * as path from 'path'

import chalk = require('chalk')

/**
 * The configuration file's content
 * For details on what these options do, see the project's README
 */
export interface Config {
  /** Path to the API's source directory */
  readonly apiInputPath: string

  readonly controllerOutput?: {
    endpointGroupName?: {
      addSuffix?: string
      removeSuffix?: string
    }
    exportName?: {
      addSuffix?: string
      removeSuffix?: string
    }
    fileName?: {
      addSuffix?: string
      removeSuffix?: string
    }
  }

  /** If the SDK interface file does not exist yet, create one automatically (enabled by default) */
  readonly generateDefaultSdkInterface?: boolean

  /** Write generation timestamp in each TypeScript file (enabled by default) */
  readonly generateTimestamps?: boolean

  /** Show a JSON output */
  readonly jsonOutput?: string

  /** Prettify the JSON output */
  readonly jsonPrettyOutput?: boolean

  /** List of magic types */
  readonly magicTypes?: MagicType[]

  /** Disable colored output */
  readonly noColor?: boolean

  /** If the output directory already exists, overwrite it (enabled by default) */
  readonly overwriteOldOutputDir?: boolean

  /** Path to Prettier's configuration file */
  readonly prettierConfig?: string

  /** Prettify the generated files (enabled by default) */
  readonly prettify?: boolean

  /** Path to the SDK interface file */
  readonly sdkInterfacePath: string

  /** Path to generate the SDK at */
  readonly sdkOutputPath: string
  /** Path to custom tsconfig file */
  readonly tsconfigFile?: string

  /** Enable verbose mode */
  readonly verbose?: boolean
}

/**
 * Magic type used to replace a non-compatible type in the generated SDK
 */
export interface MagicType {
  readonly nodeModuleFilePath: string
  readonly placeholderContent: string
  readonly typeName: string
}

/**
 * Load an existing configuration file and decode it
 * @param configPath
 */
function loadConfigFile(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    console.error(chalk.red('Config file was not found at path: ' + chalk.yellow(path.resolve(configPath))))
    process.exit(4)
  }

  const text = fs.readFileSync(configPath, 'utf8')

  try {
    return JSON.parse(text)
  } catch (e) {
    console.error(chalk.red('Failed to parse configuration file: ' + e))
    process.exit(3)
  }
}

export const configPath = process.argv[2]

if (!configPath) {
  console.error(chalk.red('Please provide a path to the configuration file'))
  process.exit(2)
}

export const config = loadConfigFile(configPath)

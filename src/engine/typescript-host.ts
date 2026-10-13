/**
 * @file Analysis host backed by the in-process TypeScript compiler API
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires -- the TypeScript compiler is resolved at runtime */

import * as fs from 'fs'
import * as path from 'path'

import { debug, notice, panic } from '../logging'

import { orderProjectFiles } from './file-order'
import { AnalysisHost, SyntaxKinds, TsNode, TsType, TYPE_FORMAT_FLAGS } from './host'

/** The TypeScript compiler module (`typeof import('typescript')` for TypeScript 6 and below) */
export type TypeScriptModule = any

/**
 * Resolution mode attributes of import types, e.g. `import("pkg", { with: { "resolution-mode": "import" } }).Type`
 * TypeScript 5.3+ prints them for ESM-only modules referenced from CommonJS files; TypeScript 7 and 4.8 print the
 * same type as `import("pkg").Type`.
 */
const IMPORT_TYPE_ATTRIBUTES_REGEX = /\bimport\(("[^"]+"|'[^']+'), \{ (?:with|assert): \{ "resolution-mode": "(?:import|require)" \} \}\)/g

/**
 * Create a host from an existing program
 * @param name Engine name
 * @param ts The TypeScript module the program was created with
 * @param program The TypeScript program
 * @param projectFilePaths Files that are part of the project
 */
export function createProgramHost(name: string, ts: TypeScriptModule, program: any, projectFilePaths: string[]): AnalysisHost {
  const checker = program.getTypeChecker()

  return {
    name,
    SyntaxKind: ts.SyntaxKind as SyntaxKinds,
    getProjectFilePaths: () => projectFilePaths,
    getSourceFile: (absolutePath) => program.getSourceFile(absolutePath),
    getTypeAtLocation: (node: TsNode) => checker.getTypeAtLocation(node),
    getReturnTypeOfDeclaration(node: TsNode) {
      const signature = checker.getSignatureFromDeclaration(node)

      if (!signature) {
        throw new Error('Expected the node to have a signature.')
      }

      return checker.getReturnTypeOfSignature(signature)
    },
    typeToString: (type: TsType) =>
      checker.typeToString(type, undefined, TYPE_FORMAT_FLAGS).replace(IMPORT_TYPE_ATTRIBUTES_REGEX, 'import($1)'),
    isObjectType: (type: TsType) => (type.flags & ts.TypeFlags.Object) !== 0,
    getIndexType: (type: TsType, keyKind) => (keyKind === 'string' ? type.getStringIndexType() : type.getNumberIndexType()),
    dispose() {},
  }
}

/**
 * Load the TypeScript compiler used by the `typescript` engine
 * By default, this is the TypeScript version installed for the analyzed API (resolved from its source directory).
 * @param sourcePath Absolute path of the API's source directory
 * @param typescriptPath Explicit path to a TypeScript package (from the configuration file)
 */
export function loadTypeScript(sourcePath: string, typescriptPath: string | undefined): TypeScriptModule {
  let modulePath: string

  try {
    modulePath = typescriptPath
      ? require.resolve(path.resolve(process.cwd(), typescriptPath))
      : require.resolve('typescript', { paths: [sourcePath] })
  } catch (e) {
    // TypeScript 7 packages have no main entry point
    const packageJsonPath = typescriptPath && path.resolve(process.cwd(), typescriptPath, 'package.json')

    if (packageJsonPath && fs.existsSync(packageJsonPath)) {
      panic(
        'The TypeScript package at {magentaBright} (version {yellow}) does not provide the JavaScript compiler API required by the {yellow} engine.\nUse TypeScript 6 or below, or the {yellow} engine.',
        path.dirname(packageJsonPath),
        String(JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')).version),
        'typescript',
        'tsgo'
      )
    }

    panic(
      typescriptPath
        ? 'Could not load TypeScript from {magentaBright}'
        : 'The {yellow} engine uses the TypeScript compiler installed for the analyzed API, but none was found from {magentaBright}.\nInstall {yellow} or set the {yellow} option.',
      ...(typescriptPath ? [typescriptPath] : ['typescript', sourcePath, 'typescript', 'typescriptPath'])
    )
  }

  const ts = require(modulePath)

  if (typeof ts.createProgram !== 'function') {
    panic(
      'The TypeScript package at {magentaBright} (version {yellow}) does not provide the JavaScript compiler API required by the {yellow} engine.\nUse TypeScript 6 or below, or the {yellow} engine.',
      modulePath,
      String(ts.version),
      'typescript',
      'tsgo'
    )
  }

  const [major] = String(ts.version).split('.').map(Number)

  if (major < 6) {
    notice(
      'TypeScript {yellow} does not support stable type ordering: generated types may be ordered differently than with the {yellow} engine.',
      String(ts.version),
      'tsgo'
    )
  }

  debug('Using TypeScript {yellow} from {magentaBright}', String(ts.version), modulePath)

  return ts
}

/**
 * Create a host running the in-process TypeScript compiler on a tsconfig file
 * Uses the same settings as the TypeScript 7 native compiler, so both engines generate the same SDK.
 */
export function createTypeScriptHost(ts: TypeScriptModule, tsConfigFilePath: string): AnalysisHost {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    tsConfigFilePath,
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (diagnostic: any) =>
        panic('Failed to parse {yellow}: {}', tsConfigFilePath, ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')),
    }
  )

  // Order union constituents deterministically, like TypeScript 7 does
  const options = { ...parsed.options, stableTypeOrdering: true }

  const compilerHost = ts.createCompilerHost(options)

  // JSDoc comments don't affect types in TypeScript files: skip parsing them (TypeScript 5.3+)
  if (ts.JSDocParsingMode) {
    compilerHost.jsDocParsingMode = ts.JSDocParsingMode.ParseForTypeErrors
  }

  const program = ts.createProgram({
    rootNames: parsed.fileNames,
    options,
    host: compilerHost,
    projectReferences: parsed.projectReferences,
  })

  const projectFilePaths = orderProjectFiles(
    parsed.fileNames,
    program.getSourceFiles().map((file: any) => file.fileName)
  )

  return createProgramHost('typescript', ts, program, projectFilePaths)
}

/**
 * @file Analysis host backed by the TypeScript 7 native compiler (tsgo), through its synchronous API
 */

/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-var-requires -- the TypeScript 7 API is loaded lazily, and can fail to load */

import * as fs from 'fs'
import * as path from 'path'

import { debug } from '../logging'

import { orderProjectFiles } from './file-order'
import { AnalysisHost, SyntaxKinds, TsNode, TsType, TYPE_FORMAT_FLAGS } from './host'

/**
 * The API throws synchronously when the native executable is missing, but if it exists and can't be executed, the
 * failure surfaces as an unhandled 'error' event of the child process, which would crash instead of falling back
 */
function assertTsgoIsExecutable() {
  if (process.platform === 'win32') return

  // Same resolution as TypeScript's lib/getExePath.js
  const platformPackage = `@typescript/typescript-${process.platform}-${process.arch}`
  const packageJson = require.resolve(`${platformPackage}/package.json`, {
    paths: [path.dirname(require.resolve('typescript/package.json'))],
  })
  fs.accessSync(path.join(path.dirname(packageJson), 'lib', 'tsc'), fs.constants.X_OK)
}

/**
 * Stop tsgo
 * The API's `close()` sends SIGTERM, to which a busy tsgo process responds by logging "context canceled" to the stderr
 * it shares with this process. tsgo holds no state worth a graceful shutdown, so it is killed with SIGKILL first.
 */
function terminate(api: any) {
  // Private fields of TypeScript 7.0's synchronous API (the dependency's version is pinned)
  const client = api.client
  const child = client?.channel?.child

  if (!child) {
    api.close()
    return
  }

  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL')
  }

  // Only close the channel: `api.close()` would first ask the (now dead) process to release its snapshots
  client.close()
}

/**
 * Load the TypeScript 7 API and start a tsgo process
 * Throws if the API can't be loaded or tsgo can't be started (e.g. unsupported platform)
 */
export function createTsgoHost(tsConfigFilePath: string): AnalysisHost {
  // The synchronous API relies on Node.js internals (and the tsgo process it spawns would then never exit)
  if (process.versions['bun']) {
    throw new Error("TypeScript 7's API requires the Node.js runtime (run the generator with `bun x` or `npx`, without `--bun`)")
  }

  // The API is published as ES modules: this relies on `require(esm)` (Node.js 20.19+ / 22.12+, Bun)
  const { API, TypeFlags } = require('typescript/unstable/sync')
  const { SyntaxKind } = require('typescript/unstable/ast')

  assertTsgoIsExecutable()

  const api = new API({ cwd: path.dirname(tsConfigFilePath) })

  // Errors exit the process right away: stop tsgo then too. Prepended, to run before the API's own exit handler.
  const onExit = () => terminate(api)
  process.prependListener('exit', onExit)

  try {
    const snapshot = api.updateSnapshot({ openProjects: [tsConfigFilePath] })
    const project = snapshot.getProject(tsConfigFilePath)

    if (!project) {
      throw new Error(`tsgo did not load the project for ${tsConfigFilePath}`)
    }

    const { checker, program } = project

    debug('Using TypeScript {yellow} (native)', String(require('typescript/package.json').version))

    return {
      name: 'tsgo',
      SyntaxKind: SyntaxKind as SyntaxKinds,
      getProjectFilePaths: () => orderProjectFiles(project.rootFiles, program.getSourceFileNames()),
      getSourceFile: (absolutePath) => program.getSourceFile(absolutePath),
      getTypeAtLocation: (node: TsNode) => checker.getTypeAtLocation(node),
      getReturnTypeOfDeclaration(node: TsNode) {
        const signature = checker.getSignatureFromDeclaration(node)

        if (!signature) {
          throw new Error('Expected the node to have a signature.')
        }

        return checker.getReturnTypeOfSignature(signature)
      },
      typeToString: (type: TsType) => checker.typeToString(type, undefined, TYPE_FORMAT_FLAGS),
      isObjectType: (type: TsType) => (type.flags & TypeFlags.Object) !== 0,
      getIndexType(type: TsType, keyKind) {
        const keyFlag = keyKind === 'string' ? TypeFlags.String : TypeFlags.Number
        return checker.getIndexInfosOfType(type).find((info: any) => (info.keyType.flags & keyFlag) !== 0)?.valueType
      },
      dispose() {
        process.removeListener('exit', onExit)
        terminate(api)
      },
    }
  } catch (e) {
    process.removeListener('exit', onExit)
    terminate(api)
    throw e
  }
}

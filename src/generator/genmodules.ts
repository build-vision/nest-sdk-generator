/**
 * @file Generate SDK modules
 */

import * as path from 'path'
import { SdkModules } from '../analyzer/controllers'
import { SdkMethod } from '../analyzer/methods'
import { SdkMethodParams } from '../analyzer/params'
import { resolveRouteWith, unparseRoute } from '../analyzer/route'
import { normalizeExternalFilePath, ResolvedTypeDeps } from '../analyzer/typedeps'
import { panic } from '../logging'

// Returned codes are not formatted yet
export function generateSdkModules(modules: SdkModules): Map<string, string> {
  const genFiles = new Map<string, string>()

  for (const [moduleName, controllers] of modules) {
    for (const [controllerName, controller] of controllers) {
      const out: string[] = []

      out.push('/// Parent module: ' + moduleName)
      out.push(`/// Controller: "${controllerName}" registered as "${controller.registrationName}" (${controller.methods.size} routes)`)
      out.push('')
      out.push('import { request } from "../central";')

      const imports = new Map<string, string[]>()

      const depsToImport = new Array<ResolvedTypeDeps>()

      for (const controller of controllers.values()) {
        for (const method of controller.methods.values()) {
          const { parameters: args, query, body } = method.params

          depsToImport.push(method.returnType)

          if (args) {
            depsToImport.push(...args.values())
          }

          if (query) {
            depsToImport.push(...query.values())
          }

          if (body) {
            if (body.full) {
              depsToImport.push(body.type)
            } else {
              depsToImport.push(...body.fields.values())
            }
          }
        }
      }

      for (const dep of depsToImport) {
        for (const [file, types] of dep.dependencies) {
          let imported = imports.get(file)

          if (!imported) {
            imported = []
            imports.set(file, imported)
          }

          for (const typ of types) {
            if (!imported.includes(typ)) {
              imported.push(typ)
            }
          }
        }
      }

      for (const [file, types] of imports) {
        out.push(`import type { ${types.join(', ')} } from "../_types/${normalizeExternalFilePath(file.replace(/\\/g, '/'))}";`)
      }

      out.push('')
      out.push(`export default {`)

      for (const [methodName, method] of controller.methods) {
        const ret = method.returnType.resolvedType
        const promised = ret.startsWith('Promise<') ? ret : `Promise<${ret}>`

        out.push('')
        out.push(`  // ${methodName} @ ${unparseRoute(method.route)}`)
        out.push(`  ${method.name}(${stringifySdkMethodParams(method.params)}): ${promised} {`)
        out.push(generateCentralRequest(method).replace(/^/gm, '    '))
        out.push('  },')
      }

      out.push('')
      out.push('};')

      genFiles.set(path.join(moduleName, controller.camelClassName + '.ts'), out.join('\n'))
    }

    // TODO: Generate module file that simply re-exports controllers
    const moduleContent: string[] = []

    moduleContent.push('/// Module name: ' + moduleName)
    moduleContent.push('')

    for (const controller of controllers.keys()) {
      moduleContent.push(`export { default as ${controller} } from "./${controller}";`)
    }

    genFiles.set(path.join(moduleName, 'index.ts'), moduleContent.join('\n'))
  }

  return genFiles
}

export function stringifySdkMethodParams(params: SdkMethodParams): string {
  const parameters = params.parameters ? [...params.parameters].map(([name, type]) => `${name}: ${type.resolvedType}`) : []

  const query = params.query ? [...params.query].map(([name, type]) => `${name}: ${type.resolvedType}`) : []

  const body = params.body
    ? params.body.full
      ? params.body.type.resolvedType
      : '{ ' + [...params.body.fields].map(([name, type]) => `${name}: ${type.resolvedType}`).join(', ') + ' }'
    : null

  return [
    `params: {${' ' + parameters.join(', ') + ' '}}${parameters.length === 0 && !body && query.length === 0 ? ' = {}' : ''}`,
    `body: ${body ?? '{}'}${!body && query.length === 0 ? ' = {}' : ''}`,
    `query: {${' ' + query.join(', ') + ' '}}${query.length === 0 ? ' = {}' : ''}`,
  ].join(', ')
}

export function generateCentralRequest(method: SdkMethod): string {
  const resolvedRoute = resolveRouteWith(method.route, (param) => '${params.' + param + '}')

  if (resolvedRoute instanceof Error) {
    panic('Internal error: failed to resolve route: ' + resolvedRoute.message)
  }

  return `return request('${method.type}', \`${resolvedRoute}\`, query, body)`
}

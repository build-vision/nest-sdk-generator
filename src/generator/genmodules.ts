/**
 * @file Generate SDK modules
 */

import { SdkController } from '../analyzer/controller'
import { SdkModules } from '../analyzer/controllers'
import { SdkHttpMethod, SdkMethod } from '../analyzer/methods'
import { SdkMethodParams } from '../analyzer/params'
import { resolveRouteWith, unparseRoute } from '../analyzer/route'
import { ResolvedTypeDeps, normalizeExternalFilePath } from '../analyzer/typedeps'
import { panic } from '../logging'

/**
 * Generate the SDK's module and controllers files
 * @param modules
 * @returns
 */
export function generateSdkModules(modules: SdkModules): Map<string, string> {
  /** Generated module files */
  const genFiles = new Map<string, string>()

  /** Index file content: Exports all controllers */
  const indexContent: string[] = []

  // Iterate over each module
  for (const [moduleName, controllers] of modules) {
    // Iterate over each of the module's controllers
    for (const [controllerName, controller] of controllers) {
      genFiles.set(controller.camelClassName + '.ts', generateController(moduleName, controller))
      indexContent.push(`export { default as ${controller.camelClassName} } from "./${controller.camelClassName}";`)
    }    
  }

  genFiles.set('index.ts', indexContent.join('\n'))

  return genFiles
}

export function generateController(moduleName: string, controller: SdkController): string {
  const controllerName = controller.camelClassName
  /** Generated controller's content */
  const out: string[] = []

  out.push('/// Parent module: ' + moduleName)
  out.push(`/// Controller: "${controllerName}" registered as "${controller.registrationName}" (${controller.methods.length} routes)`)
  out.push(`/// File Path: ${controller.path}`)
  out.push('')
  out.push('import { request } from "./central";')

  const imports = new Map<string, string[]>()

  const depsToImport = new Array<ResolvedTypeDeps>()

  // Iterate over each controller
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

  // Build the imports list
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
    out.push(
      `import type { ${types.join(', ')} } from "../_types/${normalizeExternalFilePath(file.replace(/\\/g, '/')).replace(/\\/g, '/')}";`
    )
  }

  out.push('')
  out.push(`export default {`)

  const { mutations, queries } = controller.methods.reduce(
    (acc, method) => {
      if (method.httpMethod === SdkHttpMethod.Get) {
        acc.queries.push(method)
      } else {
        acc.mutations.push(method)
      }

      return acc
    },
    { mutations: [] as SdkMethod[], queries: [] as SdkMethod[] }
  ); 

  out.push(`  queries: {`)
  
  for (const method of queries) {
    out.push(generateSdkMethod(method))
  }

  out.push('  },')

  out.push(`  mutations: {`)
  
  for (const method of mutations) {
    out.push(generateSdkMethod(method))
  }

  out.push('  },')

  out.push('')
  out.push('};')
  return out.join('\n');
}

export function generateSdkMethod(method: SdkMethod): string {
  const out = [];
  const ret = method.returnType.resolvedType
  const promised = ret.startsWith('Promise<') ? ret : `Promise<${ret}>`

  out.push('')
  out.push(`  // ${method.httpMethod} @ ${unparseRoute(method.route)}`)
  out.push(`  ${method.name}(${generateSdkMethodParams(method.params)}): ${promised} {`)
  out.push(generateCentralRequest(method).replace(/^/gm, '    '))
  out.push('  },')
  return out.join('\n')
}

/**
 * Generate the method parameters for a given SDK method
 * @param params
 * @returns
 */
export function generateSdkMethodParams(params: SdkMethodParams): string {
  // List of parameters (e.g. `id` in `/get/:id`, analyzed from the usages of the `@Param` decorator)
  const parameters = params.parameters ? [...params.parameters].map(([name, type]) => `${name}: ${type.resolvedType}`) : []

  // List of query values (e.g. `id` in `?id=xxx`, analyzed from the usages of the `@Query` decorator)
  const query = params.query ? [...params.query].map(([name, type]) => `${name}: ${type.resolvedType}`) : []

  // Body's content (type used with the `@Body` decorator)
  const body = params.body
    ? params.body.full
      ? params.body.type.resolvedType
      : '{ ' + [...params.body.fields].map(([name, type]) => `${name}: ${type.resolvedType}`).join(', ') + ' }'
    : null

  // The ternary conditions below are made to eclipse useless parameters
  // For instance, if we're not expecting any query nor body, these two parameters can be omitted when calling the method
  return [
    `params: {${' ' + parameters.join(', ') + ' '}}${parameters.length === 0 && !body && query.length === 0 ? ' = {}' : ''}`,
    `body: ${body ?? '{}'}${!body && query.length === 0 ? ' = {}' : ''}`,
    `query: {${' ' + query.join(', ') + ' '}}${query.length === 0 ? ' = {}' : ''}`,
  ].join(', ')
}

/**
 * Generate a request call to Central for the generated files
 * @param method
 * @returns
 */
export function generateCentralRequest(method: SdkMethod): string {
  const resolvedRoute = resolveRouteWith(method.route, (param) => '${params.' + param + '}')

  if (resolvedRoute instanceof Error) {
    panic('Internal error: failed to resolve route: ' + resolvedRoute.message)
  }

  return `return request('${method.httpMethod}', \`${resolvedRoute}\`, body, query)`
}

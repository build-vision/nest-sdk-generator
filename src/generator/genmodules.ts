/**
 * @file Generate SDK modules
 */

import { SdkController } from '../analyzer/controller'
import { SdkModules } from '../analyzer/controllers'
import { SdkHttpMethod, SdkMethod } from '../analyzer/methods'
import { SdkMethodParam, getParamResolvedTypes, isParamResolvedType } from '../analyzer/params'
import { paramsFromRoute, resolveRouteWith, unparseRoute } from '../analyzer/route'
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
    const { routeParams, queryParams, bodyParams } = method.params

    depsToImport.push(method.returnType)
    depsToImport.push(...getParamResolvedTypes(routeParams))
    depsToImport.push(...getParamResolvedTypes(queryParams))
    depsToImport.push(...getParamResolvedTypes(bodyParams))
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
    out.push(generateSdkMethod(method, controller))
  }

  out.push('  },')

  out.push(`  mutations: {`)
  
  for (const method of mutations) {
    out.push(generateSdkMethod(method, controller))
  }

  out.push('  },')

  out.push('')
  out.push('};')
  return out.join('\n');
}

export function generateSdkMethod(method: SdkMethod, controller: SdkController): string {
  const out = [];
  const ret = method.returnType.resolvedType
  const promised = ret.startsWith('Promise<') ? ret : `Promise<${ret}>`
  const paramsType = generateSdkMethodParams(method)

  out.push('')
  out.push(`  // ${controller.camelClassName}.${method.name}`)
  out.push(`  // ${method.httpMethod} @ ${unparseRoute(method.route)}`)
  out.push(`  // ${controller.path}`)
  out.push(`${generateSdkMethodSignature(method)} {`)
  out.push(generateSdkMethodBody(method))
  out.push('  },')
  return out.join('\n')
}

export function generateSdkMethodSignature(method: SdkMethod, prefix = '    '): string {
  const ret = method.returnType.resolvedType
  const promised = ret.startsWith('Promise<') ? ret : `Promise<${ret}>`
  const paramsType = generateSdkMethodParams(method)

  return `${prefix}${method.name}(${paramsType}): ${promised}`
}

export function generateSdkMethodParams(method: SdkMethod): string {
  const { params, httpMethod, name  } = method;

  if (httpMethod === SdkHttpMethod.Get && params.bodyParams) {
    panic(`${httpMethod} ${name} should not have Body params`)
  }
  if (httpMethod !== SdkHttpMethod.Get && params.queryParams) {
    panic(`${httpMethod} ${name} should not have Query params`)
  }

  const inputTypes = [];

  if (params.routeParams) {
    inputTypes.push(methodParamsToString(params.routeParams))
  }

  if (params.queryParams) {
    inputTypes.push(methodParamsToString(params.queryParams))
  }

  if (params.bodyParams) {
    inputTypes.push(methodParamsToString(params.bodyParams))
  }

  const mergedInputType = inputTypes.join(' &\n')

  return mergedInputType ? `params: ${mergedInputType}` : ''
}

/**
 * Generate a request call to Central for the generated files
 * @param method
 * @returns
 */
export function generateSdkMethodBody(method: SdkMethod, prefix = '    '): string {
  const output = []
  const { route, httpMethod } = method
  const routeParams = paramsFromRoute(route)
  const resolvedRoute = resolveRouteWith(route, (param) => '${' + param + '}')
  const hasAnyParams = method.params.routeParams || method.params.queryParams || method.params.bodyParams

  if (resolvedRoute instanceof Error) {
    panic('Internal error: failed to resolve route: ' + resolvedRoute.message)
  }
  const routeParamsSpread = routeParams.length > 0 ? `${routeParams.join(', ')},` : ''

  // Destructure parameters if they exist
  if (hasAnyParams) {
    output.push(`const { ${routeParamsSpread} ...rest } = params`)
  }

  const isGet = httpMethod === SdkHttpMethod.Get
  const body = isGet || !hasAnyParams ? "null" : "rest"
  const query = isGet && hasAnyParams ? "rest" : "{}" 

  
  output.push(`return request('${httpMethod}', \`${resolvedRoute}\`, ${body}, ${query})`)
  return output.join('\n')
}

export function methodParamsToString(params: SdkMethodParam): string {
  if (params === null) {
    return ''
  }

  if (isParamResolvedType(params)) {
    return params.resolvedType
  }

  const output = ["{"]
  for (const [name, type] of Object.entries(params)) {
    output.push(`${name}: ${type.resolvedType},`)
  }
  output.push("}")
  return output.join("\n")
}

/**
 * @file Generate SDK modules
 */

import path = require('path')

import { SdkController } from '../analyzer/controller'
import { SdkModules } from '../analyzer/controllers'
import { SdkHttpMethod, SdkMethod } from '../analyzer/methods'
import { SdkMethodParam, getParamResolvedTypes, isParamResolvedType } from '../analyzer/params'
import { paramsFromRoute, resolveRouteWith, unparseRoute } from '../analyzer/route'
import { ResolvedTypeDeps, normalizeExternalFilePath } from '../analyzer/typedeps'
import { config } from '../config'
import { panic } from '../logging'

const NAMES = {
  buildRTKEndpoints: 'buildRTKEndpoints',
  groupRTKEndpoints: 'groupRTKEndpoints',
  GeneratedAPIType: 'GeneratedAPIType',
} as const

/**
 * Generate the SDK's module and controllers files
 * @param modules
 * @returns
 */
export function generateSdkModules({
  inputRelativePath,
  modules,
}: {
  inputRelativePath: string
  modules: SdkModules
}): Map<string, string> {
  /** Generated module files */
  const genFiles = new Map<string, string>()

  /** Index file content */
  const imports = [
    'import type { Api, EndpointBuilder, reactHooksModuleName } from "@reduxjs/toolkit/query/react";',
    'import { BaseRequest } from "./baseRequest";',
  ]
  const exports = []
  const controllerEndpointBuilders = []
  const controllerEndpointGroupers = []

  // Iterate over each module
  for (const [moduleName, controllers] of modules) {
    // Iterate over each of the module's controllers
    for (const [_, controller] of controllers) {
      const { ext: fileExt, name: fileName } = controllerFileName(controller)
      genFiles.set(fileName + fileExt, generateController({ moduleName, controller, inputRelativePath }))

      const controllerExport = controllerExportName(controller)
      imports.push(`import ${controllerExport} from "./${fileName}";`)
      exports.push(`${controllerExport}`)
      controllerEndpointBuilders.push(`...${controllerExport}.${NAMES.buildRTKEndpoints}(builder)`)

      const endpointGroupName = controllerEndpointGroupName(controller)
      controllerEndpointGroupers.push(`${endpointGroupName}: ${controllerExport}.${NAMES.groupRTKEndpoints}(api)`)
    }
  }

  const endpointBuilder = [
    `const ${NAMES.buildRTKEndpoints} = (builder: EndpointBuilder<typeof BaseRequest, any, any>) => ({`,
    controllerEndpointBuilders.join(',\n'),
    '})',
  ].join('\n')

  const generatedAPIType = `Api<typeof BaseRequest, ReturnType<typeof ${NAMES.buildRTKEndpoints}>, string, string, typeof reactHooksModuleName>`
  const endpointGrouper = [
    `const ${NAMES.groupRTKEndpoints} = (api: ${NAMES.GeneratedAPIType}) => ({`,
    controllerEndpointGroupers.join(',\n'),
    '})',
  ].join('\n')

  exports.push(NAMES.buildRTKEndpoints)
  exports.push(NAMES.groupRTKEndpoints)

  const apiTypeExport = `export type ${NAMES.GeneratedAPIType} = ${generatedAPIType}`
  const defaultExport = ['export default {', exports.join(',\n'), '}'].join('\n')

  const indexContent = [imports.join('\n'), endpointBuilder, apiTypeExport, endpointGrouper, defaultExport].join('\n\n')

  genFiles.set('index.ts', indexContent)

  return genFiles
}

export function generateController({
  controller,
  inputRelativePath,
  moduleName,
}: {
  controller: SdkController
  inputRelativePath: string
  moduleName: string
}): string {
  const controllerName = controller.className
  /** Generated controller's content */
  const out: string[] = []

  out.push('/// Module: ' + moduleName)
  out.push(`/// Controller: ${controllerName}`)
  out.push(`/// File Path: ${generateControllerFileLink({ controller, inputRelativePath })}`)
  out.push('')
  out.push('import type { Api, EndpointBuilder, reactHooksModuleName } from "@reduxjs/toolkit/query/react";')
  out.push('import { BaseRequest } from "./baseRequest";')
  out.push('import type { BaseRequestArgs } from "./baseRequest";')

  const imports = new Map<string, string[]>()

  const depsToImport = new Array<ResolvedTypeDeps>()

  // Iterate over each controller
  for (const method of controller.methods.values()) {
    const { bodyParams, queryParams, routeParams } = method.params

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
  out.push(`export default class ${controllerExportName(controller)} {`)

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
  )

  out.push(`static readonly queries = {`)

  for (const method of queries) {
    out.push(generateSdkMethod({ method, controller, inputRelativePath }))
  }

  out.push('  }')
  out.push('')

  out.push(`static readonly mutations = {`)

  for (const method of mutations) {
    out.push(generateSdkMethod({ method, controller, inputRelativePath }))
  }

  out.push('  }')
  out.push('')

  out.push(generateBuildRTKEndpoints({ controller, mutations, queries, inputRelativePath }))
  out.push('')

  out.push(generateGroupRTKEndpoints({ controller, inputRelativePath }))
  out.push('')

  out.push('};')

  return out.join('\n')
}

export function generateSdkMethod({
  controller,
  inputRelativePath,
  method,
}: {
  controller: SdkController
  inputRelativePath: string
  method: SdkMethod
}): string {
  const out = []

  out.push('')
  out.push(generateEndpointComment({ controller, inputRelativePath, method }))
  out.push(`${generateSdkMethodSignature(method)} {`)
  out.push(generateSdkMethodBody(method))
  out.push('  },')
  return out.join('\n')
}

export function generateSdkMethodSignature(method: SdkMethod): string {
  const mergedArgsType = generateMergedArgsType(method)
  return `${method.name}(args: ${mergedArgsType}): BaseRequestArgs`
}

export function generateMergedArgsType(method: SdkMethod): string {
  const { params } = method

  const inputTypes = []

  if (params.routeParams) {
    inputTypes.push(methodParamsToString(params.routeParams))
  }

  if (params.queryParams) {
    inputTypes.push(methodParamsToString(params.queryParams))
  }

  if (params.bodyParams) {
    inputTypes.push(methodParamsToString(params.bodyParams))
  }

  return inputTypes.join(' &\n') || 'void'
}

/**
 * Generate a request call to Central for the generated files
 * @param method
 * @returns
 */
export function generateSdkMethodBody(method: SdkMethod): string {
  const output = []
  const { httpMethod, route } = method
  const routeParams = paramsFromRoute(route)
  const resolvedRoute = resolveRouteWith(route, (param) => '${' + param + '}')
  const hasAnyParams = method.params.routeParams || method.params.queryParams || method.params.bodyParams

  if (resolvedRoute instanceof Error) {
    panic('Internal error: failed to resolve route: ' + resolvedRoute.message)
  }
  const routeParamsSpread = routeParams.length > 0 ? `${routeParams.join(', ')},` : ''

  // Destructure parameters if they exist
  if (hasAnyParams) {
    output.push(`const { ${routeParamsSpread} ...rest } = args`)
  }

  const isGet = httpMethod === SdkHttpMethod.Get
  const body = isGet || !hasAnyParams ? 'null' : 'rest'
  const query = isGet && hasAnyParams ? 'rest' : '{}'

  output.push(`return { body: ${body}, method: '${httpMethod}', query: ${query}, route: \`${resolvedRoute}\` }`)
  return output.join('\n')
}

export function generateBuildRTKEndpoints({
  controller,
  inputRelativePath,
  mutations,
  queries,
}: {
  controller: SdkController
  inputRelativePath: string
  mutations: SdkMethod[]
  queries: SdkMethod[]
}): string {
  const out = []
  out.push(`static readonly ${NAMES.buildRTKEndpoints} = (builder: EndpointBuilder<typeof BaseRequest, any, any>) => ({`)

  for (const method of queries) {
    out.push(generateEndpointComment({ controller, inputRelativePath, method }))

    const resultType = awaitedResolvedType(method.returnType.resolvedType)
    const argsType = generateMergedArgsType(method)

    out.push(`  ${method.name}: builder.query<${resultType}, ${argsType}>({`)
    out.push(`    queryFn: (args, api, extraOptions) => {`)
    out.push(`      return BaseRequest(this.queries.${method.name}(args), api, extraOptions)`)
    out.push(`    },`)
    out.push(`  }),`)
  }

  for (const method of mutations) {
    out.push(generateEndpointComment({ controller, inputRelativePath, method }))

    const resultType = awaitedResolvedType(method.returnType.resolvedType)
    const argsType = generateMergedArgsType(method)

    out.push(`  ${method.name}: builder.mutation<${resultType}, ${argsType}>({`)
    out.push(`    queryFn: (args, api, extraOptions) => {`)
    out.push(`      return BaseRequest(this.mutations.${method.name}(args), api, extraOptions)`)
    out.push(`    },`)
    out.push(`  }),`)
  }

  out.push('})')

  return out.join('\n')
}

export function generateGroupRTKEndpoints({
  controller,
  inputRelativePath,
}: {
  controller: SdkController
  inputRelativePath: string
}): string {
  const out = []
  out.push(
    `static readonly ${NAMES.groupRTKEndpoints} = (api: Api<typeof BaseRequest, ReturnType<typeof this.${NAMES.buildRTKEndpoints}>, string, string, typeof reactHooksModuleName>) => ({`
  )

  for (const method of controller.methods) {
    out.push(generateEndpointComment({ controller, inputRelativePath, method }))
    out.push(`  ${method.name}: api.endpoints.${method.name},`)
  }

  out.push('})')

  return out.join('\n')
}

export function methodParamsToString(params: SdkMethodParam): string {
  if (params === null) {
    return ''
  }

  if (isParamResolvedType(params)) {
    return params.resolvedType
  }

  const output = ['{']
  for (const [name, type] of Object.entries(params)) {
    output.push(`${name}: ${type.resolvedType},`)
  }
  output.push('}')
  return output.join('\n')
}

export const generateEndpointComment = ({
  controller,
  inputRelativePath,
  method,
}: {
  controller: SdkController
  inputRelativePath: string
  method: SdkMethod
}) => {
  const out = []
  out.push(`/**`)
  out.push(`* ${method.httpMethod} ${unparseRoute(method.route)} <=> ${controller.className}.${method.name}`)
  out.push(`*`)
  out.push(`* ${generateControllerFileLink({ controller, inputRelativePath })}`)
  out.push(`*/`)
  return out.join('\n')
}

export const generateControllerFileLink = ({ controller, inputRelativePath }: { controller: SdkController; inputRelativePath: string }) => {
  return `file:///./${controllerRelativePath({ controller, inputRelativePath })} (cmd + click)`
}

export function replaceSuffix(str: string, { addSuffix = '', removeSuffix = '' }: { addSuffix?: string; removeSuffix?: string }) {
  return str.replace(new RegExp(removeSuffix + '$'), '') + addSuffix
}

export function controllerEndpointGroupName(controller: SdkController): string {
  const suffixReplacement = config.controllerOutput?.endpointGroupName ?? {}
  return replaceSuffix(controller.className, suffixReplacement)
}

export function controllerExportName(controller: SdkController): string {
  const suffixReplacement = config.controllerOutput?.exportName ?? {}
  return replaceSuffix(controller.className, suffixReplacement)
}

export function controllerFileName(controller: SdkController): { ext: string; name: string } {
  const { ext, name } = path.parse(controller.path)
  const suffixReplacement = config.controllerOutput?.fileName ?? {}
  const fileName = replaceSuffix(name, suffixReplacement)
  return {
    name: fileName,
    ext: ext || '.ts',
  }
}

export function controllerRelativePath({
  controller,
  inputRelativePath,
}: {
  controller: SdkController
  inputRelativePath: string
}): string {
  return path.join(inputRelativePath, controller.path)
}

export function awaitedResolvedType(type: string): string {
  const prefix = 'Promise<'
  return type.startsWith(prefix) ? type.substring(prefix.length, type.length - 1) : type
}

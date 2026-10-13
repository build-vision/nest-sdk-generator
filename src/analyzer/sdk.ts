/**
 * @file Engine-independent description of the analyzed SDK
 *
 * Everything in this file is plain data and pure helpers: it must not import any TypeScript
 * compiler at runtime, so the generators and the fast analysis engines can load it cheaply.
 */

import type { Route } from './route'
import type { ResolvedTypeDeps } from './typedeps'

export interface SdkContent {
  readonly modules: SdkModules
  readonly types: TypesExtractorContent
}

/** Modules mapped to their controllers (keyed by class name) */
export type SdkModules = Map<string, Map<string, SdkController>>

/**
 * SDK interface of a controller
 */
export interface SdkController {
  /** Name of the controller's class, camel cased */
  readonly className: string

  /** Controller's methods */
  readonly methods: SdkMethod[]

  /** Original controller file's path */
  readonly path: string

  /** Name the controller is registered under */
  readonly registrationName: string
}

/**
 * SDK interface for a single controller's method
 */
export interface SdkMethod {
  /** Method's HTTP method (e.g. GET / POST) */
  readonly httpMethod: SdkHttpMethod

  /** Method's name */
  readonly name: string

  /** Method's parameters */
  readonly params: SdkMethodParams

  /** Method's return type with resolved dependencies */
  readonly returnType: ResolvedTypeDeps

  /** Method's parsed route */
  readonly route: Route

  /** Method's URI path */
  readonly uriPath: string
}

/**
 * HTTP method of a controller's method
 */
export enum SdkHttpMethod {
  Delete = 'DELETE',
  Get = 'GET',
  Patch = 'PATCH',
  Post = 'POST',
  Put = 'PUT',
}

/**
 * Type of a parameter that must be passed to an SDK method: Body, Query or Route Param
 * Supports accessing parameters individually by key or as a whole object
 *
 * EXAMPLE
 *
 * Controller Method:
 *
 * getStuff(@Query('email') email: string, @Query('companyId'): CompanyId)
 *
 * SDK Method Param:
 * { email: string, companyId: CompanyId }
 *
 * OR
 *
 * Controller Method:
 * type EmailAndCompanyId = { email: string, companyId: CompanyId }
 * getStuff(@Query(): EmailAndCompanyId)
 *
 * SDK Method Param:
 * EmailAndCompanyId
 */

export type SdkMethodParam = SdkMethodParamMap | ResolvedTypeDeps | null
export type SdkMethodParamMap = { [key: string]: ResolvedTypeDeps }

export const isParamResolvedType = (param: SdkMethodParam): param is ResolvedTypeDeps => {
  if (param === null) {
    return false
  }
  return 'rawType' in param && 'resolvedType' in param && 'relativeFilePath' in param && 'dependencies' in param && 'localTypes' in param
}

export const getParamResolvedTypes = (param: SdkMethodParam): ResolvedTypeDeps[] => {
  if (param === null) {
    return []
  }
  if (isParamResolvedType(param)) {
    return [param]
  }
  return Object.values(param)
}

/**
 * SDK interface for a controller's method's parameters
 */
export interface SdkMethodParams {
  bodyParams: SdkMethodParam
  /** Engine-specific analysis context (compiler nodes); never serialized */
  context: unknown
  queryParams: SdkMethodParam
  routeParams: SdkMethodParam
}

export enum ArgDecorator {
  Body = 'Body',
  Param = 'Param',
  Query = 'Query',
}

/** Valid extensions for TypeScript module files */
export const MODULE_EXTENSIONS = ['.ts', '.d.ts', '.tsx', '.d.tsx', '.js', '.jsx']

/**
 * Location of an imported type
 */
export interface TypeLocation {
  readonly relativePathNoExt: string
  readonly typename: string
}

/**
 * Location of an imported type after figuring out its extension
 */
export interface TypeLocationWithExt extends TypeLocation {
  readonly relativePath: string
}

/**
 * Extracted imported type
 */
export interface ExtractedType extends TypeLocationWithExt {
  /** Type's declaration */
  readonly content: string

  /** Types this one depends on */
  readonly dependencies: TypeLocationWithExt[]

  /** Type parameters (e.g. <T>) */
  readonly typeParams: string[]
}

// Maps files to records mapping themselves type names to their declaration code
export type TypesExtractorContent = Map<string, Map<string, ExtractedType>>

/**
 * Locate the files containing a list of a resolved types
 * @param resolvedTypes
 * @returns
 */
export function locateTypesFile(resolvedTypes: Array<ResolvedTypeDeps>): TypeLocation[] {
  const out = new Array<TypeLocation>()

  for (const resolved of resolvedTypes) {
    for (const [file, types] of resolved.dependencies) {
      for (const typename of types) {
        if (!out.find((loc) => loc.typename === typename && loc.relativePathNoExt === file)) {
          out.push({ typename, relativePathNoExt: file })
        }
      }
    }

    for (const typename of resolved.localTypes) {
      if (!out.find((loc) => loc.typename === typename && loc.relativePathNoExt === resolved.relativeFilePath)) {
        out.push({ typename, relativePathNoExt: resolved.relativeFilePath })
      }
    }
  }

  return out
}

/**
 * Flatten a tree of resolved type dependencies
 * @param sdkModules
 * @returns
 */
export function flattenSdkResolvedTypes(sdkModules: SdkModules): ResolvedTypeDeps[] {
  const flattened = new Array<ResolvedTypeDeps>()

  for (const module of sdkModules.values()) {
    for (const controller of module.values()) {
      for (const method of controller.methods.values()) {
        const { bodyParams, queryParams, routeParams } = method.params

        flattened.push(method.returnType)
        flattened.push(...getParamResolvedTypes(routeParams))
        flattened.push(...getParamResolvedTypes(queryParams))
        flattened.push(...getParamResolvedTypes(bodyParams))
      }
    }
  }

  return flattened
}

/**
 * Convert a string to camel case
 * @param str
 */
export function camelcase(str: string): string {
  return str
    .split(/[^a-zA-Z0-9_]/g)
    .map((p, i) => {
      const f = p.substr(0, 1)
      return (i === 0 ? f.toLocaleLowerCase() : f.toLocaleUpperCase()) + p.substr(1)
    })
    .join('')
}

/**
 * Serialize analyzed SDK content to JSON
 * Maps are converted to plain objects, and engine-specific analysis contexts are omitted.
 */
export function serializeSdkContent(content: SdkContent, pretty: boolean): string {
  return JSON.stringify(
    content,
    function (this: unknown, key, v) {
      if (key === 'context' && isSdkMethodParams(this)) return undefined
      return v instanceof Map ? Object.fromEntries(v) : v
    },
    pretty ? 4 : 0
  )
}

function isSdkMethodParams(value: unknown): value is SdkMethodParams {
  return typeof value === 'object' && value !== null && 'routeParams' in value && 'queryParams' in value && 'bodyParams' in value
}

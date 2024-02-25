/**
 * @file Analyzer for the source API's controllers' methods' parameters
 */

import { ClassDeclaration, Decorator, MethodDeclaration, Node, ParameterDeclaration, Type } from 'ts-morph'

import { debug, panic } from '../logging'

import { SdkHttpMethod } from './methods'
import { paramsFromRoute, Route } from './route'
import { ResolvedTypeDeps, resolveTypeDependencies } from './typedeps'

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
  context: MethodContext
  queryParams: SdkMethodParam
  routeParams: SdkMethodParam
}

export type MethodContext = {
  absoluteSrcPath: string
  controllerClass: ClassDeclaration
  filePath: string
  httpMethod: SdkHttpMethod
  method: MethodDeclaration
  route: Route
}

export enum ArgDecorator {
  Body = 'Body',
  Param = 'Param',
  Query = 'Query',
}

export type DecoratedArg = {
  arg: ParameterDeclaration
  argParamKey: string | null
  context: MethodContext
  decorator: Decorator
  decoratorType: ArgDecorator
}

/**
 * Generate a SDK interface for a controller's method's parameters
 * @param httpMethod The method's HTTP method
 * @param route The method's route
 * @param args The method's arguments
 * @param filePath Path to the controller's file
 * @param absoluteSrcPath Absolute path to the source directory
 * @returns A SDK interface for the method's parameters
 */
export function extractParams(context: MethodContext): SdkMethodParams {
  const { route } = context
  const { Body, Param, Query } = extractDecoratedArgs(context)
  const resolvedParams: SdkMethodParams = {
    routeParams: mergeDecoratedArgs(Param),
    queryParams: mergeDecoratedArgs(Query),
    bodyParams: mergeDecoratedArgs(Body),
    context,
  }

  /**
   * Validate Route Params exist in route URL
   */
  const { routeParams } = resolvedParams
  if (routeParams) {
    const allowedRouteParams = new Set(paramsFromRoute(route))
    const usedRouteParams =
      routeParams instanceof Type
        ? // If routeParams was resolved to a single type, assume there's only one decorated argument
          Param[0].arg
            .getType()
            .getProperties()
            .map((prop) => prop.getName())
        : // If routeParams was resolved to a map, assume the keys are the route params
          Object.keys(routeParams)

    for (const usedParam of usedRouteParams) {
      if (!allowedRouteParams.has(usedParam)) {
        panicWithContext(`Route param ${usedParam} does not appear in route URL`, context)
      }
    }
  }

  return resolvedParams
}

export function extractDecoratedArgs(context: MethodContext): Record<ArgDecorator, DecoratedArg[]> {
  const decoratedArgs = {
    [ArgDecorator.Param]: [] as DecoratedArg[],
    [ArgDecorator.Query]: [] as DecoratedArg[],
    [ArgDecorator.Body]: [] as DecoratedArg[],
  }

  const { controllerClass, method } = context
  const args = method.getParameters()

  for (const arg of args) {
    const argName = arg.getName()

    debug('├───── Detected argument: {yellow}', argName)

    // Arguments are collected as soon as they have a decorator like @Query() or @Body()
    const argDecorators = arg.getDecorators().filter((dec) => (Object.values(ArgDecorator) as string[]).includes(dec.getName()))

    if (argDecorators.length === 0) {
      // If we have no argument, this is not an argument we are interested in, so we just skip it
      debug('├───── Skipping this argument as it does not have a decorator')
      continue
    } else if (argDecorators.length > 1) {
      panic(
        `${controllerClass.getName()} ${method.getName()} has multiple decorators on argument ${argName} ${argDecorators.map((dec) => dec.getName()).join(', ')}`
      )
    }
    // Get the only decrator
    const decorator = argDecorators[0]
    const decoratorType = decorator.getName() as ArgDecorator
    const argParamKey = extractArgParamKey({ ...context, arg, decorator })
    const argType = arg.getType()

    if (!argParamKey && !argType.isObject()) {
      panic(
        `${controllerClass.getName()} ${method.getName()} generic controller argument ${decoratorType}() ${argName} must be an object type`
      )
    }

    decoratedArgs[decoratorType].push({
      arg,
      argParamKey,
      decorator,
      decoratorType,
      context,
    })
  }

  return decoratedArgs
}

export function extractArgParamKey(
  context: MethodContext & {
    arg: ParameterDeclaration
    decorator: Decorator
  }
): string | null {
  const { arg, controllerClass, decorator, method } = context
  const decoratorArgs = decorator.getArguments()

  if (decoratorArgs.length > 1) {
    panic(
      `${controllerClass.getName()} ${method.getName()} ${decorator.getName()}() ${arg.getName()} argument decorator has multiple parameters`
    )
  } else if (decoratorArgs.length === 0) {
    return null
  }

  const decoratorArg = decoratorArgs[0]

  if (!Node.isStringLiteral(decoratorArg)) {
    panic('The argument provided to the decorator is not a string literal:\n>>> {cyan}', arg.getText())
  }

  const paramKey = decoratorArg.getLiteralText()
  if (paramKey in {}) {
    panicWithContext(`${decorator.getName()}('${paramKey}') param name collides with JavaScript native object property`, context)
  }

  return paramKey
}

export function mergeDecoratedArgs(decoratedArgs: DecoratedArg[]): SdkMethodParam {
  let genericParam: SdkMethodParam | null = null
  const paramMap: SdkMethodParamMap = {}

  for (const decoratedArg of decoratedArgs) {
    const { arg, argParamKey, context, decoratorType } = decoratedArg
    const resolvedType = resolveTypeDependencies(arg.getType(), context.filePath, context.absoluteSrcPath)

    if (argParamKey) {
      if (paramMap[argParamKey]) {
        panicWithContext(`${decoratorType}('${argParamKey}') used twice in controller method`, decoratedArg.context)
      }

      paramMap[argParamKey] = resolvedType
    } else {
      if (genericParam) {
        panicWithContext(`${decoratorType}() used twice in controller method`, decoratedArg.context)
      }

      genericParam = resolvedType
    }
  }

  const hasArgsByKey = Object.keys(paramMap).length > 0

  if (genericParam && hasArgsByKey) {
    panicWithContext(`Cannot mix generic and specific ${decoratedArgs[0].decoratorType}()`, decoratedArgs[0].context)
  }

  return hasArgsByKey ? paramMap : genericParam
}

const panicWithContext = (message: string, context: MethodContext) => {
  const { controllerClass, filePath, httpMethod, method } = context
  const ctx = {
    controller: controllerClass.getName(),
    method: method.getName(),
    httpMethod,
    filePath,
  }
  panic(`${message}\n${JSON.stringify(ctx, null, 2)}`)
}

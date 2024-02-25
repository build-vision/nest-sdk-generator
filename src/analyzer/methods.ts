/**
 * @file Analyzer for the source API's methods
 */

import { blue } from 'chalk'
import { ClassDeclaration, MethodDeclaration, Node } from 'ts-morph'

import { debug, format } from '../logging'

import { extractParams, SdkMethodParams } from './params'
import { analyzeUri, debugUri, Route } from './route'
import { ResolvedTypeDeps, resolveTypeDependencies } from './typedeps'

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
 * Generate a SDK interface for a controller
 * @param controllerClass The class declaration of the controller
 * @param controllerUriPrefix Optional URI prefix for this controller (e.g. `@Controller("registrationName")`)
 * @param filePath Path to the controller's file
 * @param absoluteSrcPath Absolute path to the source directory
 */
export function analyzeMethods(
  controllerClass: ClassDeclaration,
  controllerUriPrefix: string | null,
  filePath: string,
  absoluteSrcPath: string
): SdkMethod[] | Error {
  // Output variable
  const collected = new Array<SdkMethod>()

  // Get the list of all methods
  const methods = controllerClass.forEachChildAsArray().filter((node) => node instanceof MethodDeclaration) as MethodDeclaration[]

  for (const method of methods) {
    const methodName = method.getName()

    debug('├─ Found method: {yellow}', methodName)

    // Get the HTTP decorator(s) of the method
    const decorators = method.getDecorators().filter((dec) => Object.keys(SdkHttpMethod).includes(dec.getName()))

    // We expect to have exactly one HTTP decorator
    if (decorators.length > 1) {
      // If there is more than one decorator, that's invalid, so we can't analyze the method
      return new Error(
        format('├─── Detected multiple HTTP decorators on method: {yellow}' + decorators.map((dec) => dec.getName()).join(','))
      )
    } else if (decorators.length === 0) {
      // If there isn't any HTTP decorator, this is simply not a method available from the outside and so we won't generate an interface for it
      debug('├─── Skipping this method as it does not have an HTTP decorator')
      continue
    }

    // Get the HTTP decorator
    const dec = decorators[0]

    // @ts-expect-error TypeScript doesn't like indexing an enumeration with a string key, although this works fine
    const httpMethod = SdkHttpMethod[dec.getName()]

    debug('├─── Detected HTTP method: {magentaBright}', httpMethod.toLocaleUpperCase())

    // Get the arguments provided to the HTTP decorator (we expect one, the URI path)
    const decArgs = dec.getArguments()

    // The method's URI path
    let uriPath: string

    // We expect the decorator to have exactly one argument
    if (decArgs.length > 1) {
      // If we have more than one argument, that's invalid (or at least not supported here), so we can't analyze the method
      return new Error(`Multiple (${decArgs.length}) arguments were provided to the HTTP decorator`)
    } else if (decArgs.length === 0) {
      // If there is no argument, we take the method's name as the URI path
      debug('├─── No argument found for decorator, using base URI path.')
      uriPath = ''
    } else {
      // If we have exactly one argument, hurray! That's our URI path.
      const uriNameDec = decArgs[0]

      // Variables are not supported
      if (!Node.isStringLiteral(uriNameDec)) {
        return new Error(
          format('├─── The argument provided to the HTTP decorator is not a string literal:\n>> {cyan}', uriNameDec.getText())
        )
      }

      // Update the method's URI path
      uriPath = uriNameDec.getLiteralText()

      debug('├─── Detected argument in HTTP decorator, mapping this method to custom URI name')
    }

    debug('├─── Detected URI name: {yellow}', uriPath)

    // Analyze the method's URI
    const route = analyzeUri(controllerUriPrefix ? (uriPath ? `/${controllerUriPrefix}/${uriPath}` : `/` + controllerUriPrefix) : uriPath)

    if (route instanceof Error) {
      return new Error(
        '├─── Detected unsupported URI format:\n' +
          route.message
            .split('\n')
            .map((line) => '├───── ' + line)
            .join('\n')
      )
    }

    debug('├─── Parsed URI name to route: {yellow}', debugUri(route, blue))

    // Analyze the method's arguments
    debug('├─── Analyzing arguments...')
    const params = extractParams({ controllerClass, httpMethod, route, method, filePath, absoluteSrcPath })

    // Get the method's return type
    debug('├─── Resolving return type...')
    const returnType = resolveTypeDependencies(method.getReturnType(), filePath, absoluteSrcPath)

    debug('├─── Detected return type: {cyan}', returnType.resolvedType)

    // Success!
    collected.push({
      name: methodName,
      httpMethod,
      returnType,
      route,
      uriPath,
      params,
    })
  }

  return collected
}

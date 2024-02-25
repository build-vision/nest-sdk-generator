/**
 * @file Analyzer for the source API's controllers (singles)
 */

import * as path from 'path'

import { Node, Project } from 'ts-morph'

import { debug, warn } from '../logging'

import { analyzeMethods, SdkMethod } from './methods'

/**
 * Convert a string to camel case
 * @param str
 */
function camelcase(str: string): string {
  return str
    .split(/[^a-zA-Z0-9_]/g)
    .map((p, i) => {
      const f = p.substr(0, 1)
      return (i === 0 ? f.toLocaleLowerCase() : f.toLocaleUpperCase()) + p.substr(1)
    })
    .join('')
}

/**
 * SDK interface of a controller
 */
export interface SdkController {
  /** Name of the controller's class, camel cased */
  readonly camelClassName: string
  /** Controller's methods */
  readonly methods: SdkMethod[]
  /** Original controller file's path */
  readonly path: string
  /** Name the controller is registered under */
  readonly registrationName: string
}

/**
 * Generate a SDK interface for a controller
 * @param project TS-Morph project the controller is contained in
 * @param controllerPath Path to the controller's file
 * @param absoluteSrcPath Absolute path to the source directory
 * @returns The SDK interface of the provided controller
 */
export function analyzeController(project: Project, controllerPath: string, absoluteSrcPath: string): SdkController | null | Error {
  debug('Analyzing: {yellow}', controllerPath)

  // Prepare the source file to analyze
  const file = project.getSourceFileOrThrow(path.resolve(absoluteSrcPath, controllerPath))

  // Find the controller class declaration
  const classDecl = file.forEachChildAsArray().find((node) => Node.isClassDeclaration(node))

  if (!classDecl) {
    warn('No controller found in this file.')
    return null
  }

  if (!Node.isClassDeclaration(classDecl))
    return new Error('Internal error: found class declaration statement which is not an instance of ClassDeclaration')

  const className = classDecl.getName()

  if (className === undefined) {
    return new Error('Internal error: failed to retrieve name of declared class')
  }

  // By default, a controller is registered under its class name
  // This is unless it provides an argument to its @Controller() decorator
  let registrationName = camelcase(className)
  let controllerUriPrefix: string | null = null

  debug('Found class declaration: {yellow}', className)

  // Get the @Controller() decorator
  const decorator = classDecl.getDecorators().find((dec) => dec.getName() === 'Controller')

  if (!decorator) {
    warn('Skipping this controller as it does not have a @Controller() decorator')
    return null
  }

  // Get the decorator's call expression
  const decCallExpr = decorator.getCallExpression()

  if (!decCallExpr) {
    warn('Skipping this controller as its @Controller() decorator is not called')
    return null
  }

  // Get the decorator's arguments
  const decExpr = decCallExpr.getArguments()

  if (decExpr.length > 1) {
    warn('Skipping this controller as its @Controller() decorator is called with more than 1 argument')
    return null
  }

  // Get the first argument, which is expected to be the controller's registration name
  // Example: `@Controller("SuperName")` will register the controller under the name "SuperName"
  if (decExpr[0]) {
    const nameArg = decExpr[0]

    // Variables are not supported
    if (!Node.isStringLiteral(nameArg)) {
      warn("Skipping this controller as its @Controller() decorator's argument is not a string literal")
      return null
    }

    // Update the registration name
    registrationName = camelcase(nameArg.getLiteralText())
    controllerUriPrefix = registrationName
    debug('Registering controller {yellow} as {yellow} (as specified in @Controller())', className, registrationName)
  } else {
    // No argument was provided to the @Controller() decorator, so we stick with the original controller's name
    debug('@Controller() was called without argument, registering controller under name {yellow}', registrationName)
  }

  // Generate a SDK interface for the controller's methods
  const methods = analyzeMethods(classDecl, controllerUriPrefix, controllerPath, absoluteSrcPath)

  if (methods instanceof Error) {
    return methods
  }

  // Success!
  debug(`└─ Done for controller {yellow}`, controllerPath)

  return {
    path: controllerPath,
    camelClassName: camelcase(className),
    registrationName,
    methods,
  }
}

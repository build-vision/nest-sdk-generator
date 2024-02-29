/**
 * @file Analyzer for the source API's modules
 */

import * as path from 'path'

import { Node, Project } from 'ts-morph'

import { format, panic } from '../logging'

/**
 * Get the name of a module
 * @param project TS-Morph project the module is contained in
 * @param modulePath Path to the module's file
 * @param sourcePath Path to the TypeScript root directory
 */
export function getModuleName(project: Project, modulePath: string, sourcePath: string): string {
  // Prepare the source file to analyze
  const file = project.getSourceFileOrThrow(path.resolve(sourcePath, modulePath))

  // Find the module class declaration
  const classDecl = file.forEachChildAsArray().find((node) => Node.isClassDeclaration(node) && node.getDecorators().length > 0)

  if (!classDecl) {
    panic('No class declaration found in module at {yellow}', modulePath)
  }

  if (!Node.isClassDeclaration(classDecl))
    panic('Internal error: found class declaration statement which is not an instance of ClassDeclaration')

  const moduleName = classDecl.getName()

  if (moduleName === undefined) {
    panic('Internal error: failed to retrieve name of declared class')
  }

  const decorators = classDecl.getDecorators()
  const moduleDecorator = decorators.find((dec) => dec.getName() === 'Module')

  if (!moduleDecorator) {
    panic(format(`Module class {yellow} is missing {yellow} decorator\nModule path is: {yellow}`, moduleName, '@Module', modulePath))
  }

  return moduleName
}

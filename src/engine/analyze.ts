/**
 * @file Source API analyzer running on top of an `AnalysisHost` (tsgo or in-process TypeScript)
 *
 * This is a port of the legacy ts-morph analyzer (`src/analyzer`). It performs the same operations, in the same
 * order, with the same messages, so that given the same type checker it produces the same SDK content.
 * The parity tests enforce this by running it against the TypeScript program ts-morph builds.
 */

import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

import chalk = require('chalk')

import { builtinMagicTypes } from '../analyzer/builtin'
import { analyzeUri, debugUri, paramsFromRoute, Route } from '../analyzer/route'
import {
  ArgDecorator,
  camelcase,
  ExtractedType,
  flattenSdkResolvedTypes,
  locateTypesFile,
  MODULE_EXTENSIONS,
  SdkContent,
  SdkController,
  SdkHttpMethod,
  SdkMethod,
  SdkMethodParam,
  SdkMethodParamMap,
  SdkMethodParams,
  SdkModules,
  serializeSdkContent,
  TypeLocation,
  TypeLocationWithExt,
  TypesExtractorContent,
} from '../analyzer/sdk'
import { getImportResolvedTypeText, ResolvedTypeDeps, resolveTypeTextDependencies } from '../analyzer/typedeps'
import { Config, MagicType } from '../config'
import { debug, format, panic, unreachable, warn } from '../logging'
import { findFileAbove } from '../utils'

import {
  decoratorArguments,
  decoratorCallExpression,
  decoratorName,
  getClassMembers,
  getDecorators,
  getDeclarationProperties,
  getExtendsTypeNodes,
  isStringLiteral,
  nodeName,
  nodeText,
} from './ast'
import { AnalysisHost, TsNode, TsType } from './host'

/**
 * Analyze the source API
 * @param config Generator configuration
 * @param createHost Creates the engine for a given tsconfig file
 */
export async function analyzeWithHost(config: Config, createHost: (tsConfigFilePath: string) => AnalysisHost): Promise<SdkContent> {
  const started = Date.now()

  const sourcePath = path.resolve(process.cwd(), config.apiInputPath)

  if (!sourcePath) panic('Please provide a source directory')

  if (!fs.existsSync(sourcePath)) panic('Provided source path {magentaBright} does not exist', sourcePath)
  if (!fs.lstatSync(sourcePath).isDirectory()) panic('Provided source path is not a directory')

  debug(`Analyzing from source directory {yellow}`, sourcePath)

  if (config.jsonOutput) {
    const jsonOutputParentDir = path.dirname(path.resolve(process.cwd(), config.jsonOutput))

    if (!fs.existsSync(jsonOutputParentDir)) {
      panic("Output file's parent directory {magentaBright} does not exist.", jsonOutputParentDir)
    }

    debug('Writing output to {yellow}', config.jsonOutput, config.jsonPrettyOutput ? 'beautified' : 'minified')
  }

  // ====== Find & parse 'tsconfig.json' ====== //
  if (config.tsconfigFile && config.tsconfigFile.includes('/')) {
    panic('Provided tsconfig file name contains slashes')
  }

  const tsConfigFileName = config.tsconfigFile ?? 'tsconfig.json'
  const tsConfigFilePath = path.join(sourcePath, tsConfigFileName)

  if (!fs.existsSync(tsConfigFilePath)) {
    panic('No {yellow} file found in provided source path {yellow}', tsConfigFileName, sourcePath)
  }

  const host = createHost(tsConfigFilePath)

  try {
    // Get the list of all TypeScript files in the source directory
    const sourceTSFiles = host.getProjectFilePaths().map((file) => path.relative(sourcePath, file))
    debug(`Found {magentaBright} source files.`, sourceTSFiles.length)

    // Add them
    debug('\nAdding them to the source project...')

    let progressByTenth = 0
    const strLen = sourceTSFiles.length.toString().length

    const hasProgress = (filesTreated: number) => filesTreated / sourceTSFiles.length >= (progressByTenth + 1) / 10

    const controllers = []

    for (let i = 0; i < sourceTSFiles.length; i++) {
      const file = sourceTSFiles[i]

      if (file.endsWith('.controller.ts')) {
        controllers.push(file)
      }

      if (hasProgress(i + 1)) {
        while (hasProgress(i + 1)) progressByTenth++

        debug(
          '| Progress: {yellow} ({magentaBright} files) - {green} controller{} found',
          (progressByTenth * 10).toString().padStart(3, ' ') + '%',
          `${(i + 1).toString().padStart(strLen, ' ')} / ${sourceTSFiles.length}`,
          controllers.length.toString().padStart(strLen, ''),
          controllers.length > 1 ? 's' : ''
        )
      }
    }

    debug('All files were added successfully.\n')

    const modules = analyzeControllers(host, controllers, sourcePath)

    // Builtin magic types are concatenated **after** the configuration's ones, as this allows users to
    // override the builtin ones if they want. Do **not** change the concatenation order!
    const magicTypes = (config.magicTypes ?? []).concat(builtinMagicTypes)

    const typesCache = new TypesExtractor(host, sourcePath, magicTypes)

    const typesToExtract = locateTypesFile(flattenSdkResolvedTypes(modules))

    debug('\n==== Extracting {} type' + (typesToExtract.length > 1 ? 's' : '') + ' ====\n', typesToExtract.length)

    for (const loc of typesToExtract) {
      const result = typesCache.extractType(loc)

      if (result instanceof Error) {
        panic(result.message)
      }
    }

    const content: SdkContent = {
      modules,
      types: typesCache.extracted,
    }

    if (config.jsonOutput) {
      fs.writeFileSync(config.jsonOutput, serializeSdkContent(content, !!config.jsonPrettyOutput), 'utf8')
    }

    debug('\n===== Done in {green}! ====', ((Date.now() - started) / 1000).toFixed(2) + 's')

    return content
  } finally {
    host.dispose()
  }
}

/**
 * Get a source file from the program, throwing like ts-morph's `project.getSourceFileOrThrow()`
 */
function getSourceFileOrThrow(host: AnalysisHost, absolutePath: string): TsNode {
  const file = host.getSourceFile(absolutePath)

  if (!file) {
    throw new Error(`Could not find source file in project at the provided path: ${absolutePath}`)
  }

  return file
}

// =============================================================================================================== //
// Controllers & modules (see src/analyzer/controllers.ts, src/analyzer/controller.ts, src/analyzer/module.ts)     //
// =============================================================================================================== //

function analyzeControllers(host: AnalysisHost, controllers: string[], absoluteSrcPath: string): SdkModules {
  /** Hierarchised SDK informations */
  const collected = new Map<string, Map<string, SdkController>>()
  const usedControllerNames = new Set<string>()

  /**
   * Modules cache: contains for a given directory the nearest module file's path and name
   * This allows to avoid having to analyze the whole directory structure for each controller
   */
  const modulesCache = new Map<string, string>()

  /**
   * Path of the declared modules
   * When a module is detected and put in the cache, its name is registered here along with its path
   * This allows to ensure there is no name clash between two different modules
   */
  const declaredModulesPath = new Map<string, string>()

  debug(`Analyzing {yellow} controllers...`, controllers.length)

  controllers.forEach((relativeControllerPath, i) => {
    const absoluteControllerPath = path.resolve(absoluteSrcPath, relativeControllerPath)

    debug(
      '\n{cyan} {yellow}: {magentaBright} {cyan}\n',
      '===== Analyzing controller',
      `${i + 1}/${controllers.length}`,
      relativeControllerPath,
      '====='
    )

    const basePath = path.dirname(absoluteControllerPath)

    let moduleName = modulesCache.get(basePath)

    // Check if the module's name is in cache
    if (!moduleName) {
      // Else, find the nearest module file
      const absoluteModulePath = findFileAbove(/^.*\.module\.ts$/, path.resolve(absoluteSrcPath, basePath))

      if (absoluteModulePath === null) {
        panic('No module file was found for controller at path: {yellow}', absoluteControllerPath)
      }

      const relativeModulePath = path.relative(absoluteSrcPath, absoluteModulePath)

      // Get the module's name
      moduleName = getModuleName(host, relativeModulePath, absoluteSrcPath)

      debug('Discovered module: {yellow}', moduleName)

      // Ensure this module is unique
      const cachedModulePath = declaredModulesPath.get(moduleName)

      if (cachedModulePath) {
        panic(
          `Two modules were declared with the same name {yellow}:\n` + `- One in {yellow}\n` + `- One in {yellow}`,
          moduleName,
          cachedModulePath,
          relativeModulePath
        )
      }

      modulesCache.set(basePath, moduleName)
    }

    if (moduleName in {}) {
      panic(`Detected module whose name {yellow} collides with a JavaScript's native object property`, moduleName)
    }

    let moduleSdkInfos = collected.get(moduleName)

    if (!moduleSdkInfos) {
      moduleSdkInfos = new Map()
      collected.set(moduleName, moduleSdkInfos)
    }

    if (i === 0) {
      if (process.platform === 'linux' && os.release().toLocaleLowerCase().includes('microsoft') && absoluteSrcPath.startsWith('/mnt/')) {
        warn("NOTE: On WSL, the first type analysis on a project located in Windows's filesystem may take a long time to complete.")
        warn('Please consider moving your project to WSL, or running this tool directly from Windows')
      }
    }

    const metadata = analyzeController(host, relativeControllerPath, absoluteSrcPath)

    if (metadata instanceof Error) {
      throw new Error(format('Failed to analyze controller at path {magenta}:\n{}', relativeControllerPath, metadata.message))
    }

    if (metadata) {
      if (metadata.registrationName in {}) {
        panic(
          `Detected controller whose registration name {yellow} collides with a JavaScript's native object property`,
          metadata.registrationName
        )
      }

      // Ensure the each controller has a unique name across modules
      if (usedControllerNames.has(metadata.className)) {
        panic(
          `Detected two controllers with the same name {yellow}. Second occurrence found in {yellow}`,
          metadata.registrationName,
          metadata.path
        )
      } else {
        usedControllerNames.add(metadata.className)
      }

      moduleSdkInfos.set(metadata.className, metadata)
    }
  })

  return collected
}

function getModuleName(host: AnalysisHost, modulePath: string, sourcePath: string): string {
  const SK = host.SyntaxKind

  // Prepare the source file to analyze
  const file = getSourceFileOrThrow(host, path.resolve(sourcePath, modulePath))

  // Find the module class declaration
  const classDecl = (file.statements as TsNode[]).find((node) => node.kind === SK.ClassDeclaration && getDecorators(host, node).length > 0)

  if (!classDecl) {
    panic('No class declaration found in module at {yellow}', modulePath)
  }

  const moduleName = nodeName(classDecl, file)

  if (moduleName === undefined) {
    panic('Internal error: failed to retrieve name of declared class')
  }

  const decorators = getDecorators(host, classDecl)
  const moduleDecorator = decorators.find((dec) => decoratorName(host, dec, file) === 'Module')

  if (!moduleDecorator) {
    panic(format(`Module class {yellow} is missing {yellow} decorator\nModule path is: {yellow}`, moduleName, '@Module', modulePath))
  }

  return moduleName
}

function analyzeController(host: AnalysisHost, controllerPath: string, absoluteSrcPath: string): SdkController | null | Error {
  const SK = host.SyntaxKind

  debug('Analyzing: {yellow}', controllerPath)

  // Prepare the source file to analyze
  const file = getSourceFileOrThrow(host, path.resolve(absoluteSrcPath, controllerPath))

  // Find the controller class declaration
  const classDecl = (file.statements as TsNode[]).find((node) => node.kind === SK.ClassDeclaration)

  if (!classDecl) {
    warn('No controller found in this file.')
    return null
  }

  const className = nodeName(classDecl, file)

  if (className === undefined) {
    return new Error('Internal error: failed to retrieve name of declared class')
  }

  // By default, a controller is registered under its class name
  // This is unless it provides an argument to its @Controller() decorator
  let registrationName = camelcase(className)
  let controllerUriPrefix: string | null = null

  debug('Found class declaration: {yellow}', className)

  // Get the @Controller() decorator
  const decorator = getDecorators(host, classDecl).find((dec) => decoratorName(host, dec, file) === 'Controller')

  if (!decorator) {
    warn('Skipping this controller as it does not have a @Controller() decorator')
    return null
  }

  // Get the decorator's call expression
  const decCallExpr = decoratorCallExpression(host, decorator)

  if (!decCallExpr) {
    warn('Skipping this controller as its @Controller() decorator is not called')
    return null
  }

  // Get the decorator's arguments
  const decExpr: TsNode[] = decCallExpr.arguments

  if (decExpr.length > 1) {
    warn('Skipping this controller as its @Controller() decorator is called with more than 1 argument')
    return null
  }

  // Get the first argument, which is expected to be the controller's registration name
  // Example: `@Controller("SuperName")` will register the controller under the name "SuperName"
  if (decExpr[0]) {
    const nameArg = decExpr[0]

    // Variables are not supported
    if (!isStringLiteral(host, nameArg)) {
      warn("Skipping this controller as its @Controller() decorator's argument is not a string literal")
      return null
    }

    // Update the registration name
    registrationName = nameArg.text
    controllerUriPrefix = registrationName
    debug('Registering controller {yellow} as {yellow} (as specified in @Controller())', className, registrationName)
  } else {
    // No argument was provided to the @Controller() decorator, so we stick with the original controller's name
    debug('@Controller() was called without argument, registering controller under name {yellow}', registrationName)
  }

  // Generate a SDK interface for the controller's methods
  const methods = analyzeMethods(host, file, classDecl, controllerUriPrefix, controllerPath, absoluteSrcPath)

  if (methods instanceof Error) {
    return methods
  }

  // Success!
  debug(`└─ Done for controller {yellow}`, controllerPath)

  return {
    path: controllerPath,
    className,
    registrationName,
    methods,
  }
}

// =============================================================================================================== //
// Methods & parameters (see src/analyzer/methods.ts, src/analyzer/params.ts)                                      //
// =============================================================================================================== //

function analyzeMethods(
  host: AnalysisHost,
  sourceFile: TsNode,
  controllerClass: TsNode,
  controllerUriPrefix: string | null,
  filePath: string,
  absoluteSrcPath: string
): SdkMethod[] | Error {
  // Output variable
  const collected = new Array<SdkMethod>()

  // Get the list of all methods
  const methods = (controllerClass.members as TsNode[]).filter((node) => node.kind === host.SyntaxKind.MethodDeclaration)

  for (const method of methods) {
    const methodName = nodeName(method, sourceFile)!

    debug('├─ Found method: {yellow}', methodName)

    // Get the HTTP decorator(s) of the method
    const decorators = getDecorators(host, method).filter((dec) =>
      Object.keys(SdkHttpMethod).includes(decoratorName(host, dec, sourceFile))
    )

    // We expect to have exactly one HTTP decorator
    if (decorators.length > 1) {
      // If there is more than one decorator, that's invalid, so we can't analyze the method
      return new Error(
        format(
          '├─── Detected multiple HTTP decorators on method: {yellow}' +
            decorators.map((dec) => decoratorName(host, dec, sourceFile)).join(',')
        )
      )
    } else if (decorators.length === 0) {
      // If there isn't any HTTP decorator, this is simply not a method available from the outside and so we won't generate an interface for it
      debug('├─── Skipping this method as it does not have an HTTP decorator')
      continue
    }

    // Get the HTTP decorator
    const dec = decorators[0]

    const httpMethod = SdkHttpMethod[decoratorName(host, dec, sourceFile) as keyof typeof SdkHttpMethod]

    debug('├─── Detected HTTP method: {magentaBright}', httpMethod.toLocaleUpperCase())

    // Get the arguments provided to the HTTP decorator (we expect one, the URI path)
    const decArgs = decoratorArguments(host, dec)

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
      if (!isStringLiteral(host, uriNameDec)) {
        return new Error(
          format('├─── The argument provided to the HTTP decorator is not a string literal:\n>> {cyan}', nodeText(uriNameDec, sourceFile))
        )
      }

      // Update the method's URI path
      uriPath = uriNameDec.text

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

    debug('├─── Parsed URI name to route: {yellow}', debugUri(route, chalk.blue))

    // Analyze the method's arguments
    debug('├─── Analyzing arguments...')
    const params = extractParams({ host, sourceFile, controllerClass, httpMethod, route, method, filePath, absoluteSrcPath })

    // Get the method's return type
    debug('├─── Resolving return type...')
    const returnType = resolveTypeTextDependencies(host.typeToString(host.getReturnTypeOfDeclaration(method)), filePath, absoluteSrcPath)

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

type MethodContext = {
  absoluteSrcPath: string
  controllerClass: TsNode
  filePath: string
  host: AnalysisHost
  httpMethod: SdkHttpMethod
  method: TsNode
  route: Route
  sourceFile: TsNode
}

type DecoratedArg = {
  arg: TsNode
  argParamKey: string | null
  context: MethodContext
  decorator: TsNode
  decoratorType: ArgDecorator
}

function extractParams(context: MethodContext): SdkMethodParams {
  const { httpMethod, route } = context
  const { Body, Param, Query } = extractDecoratedArgs(context)
  const resolvedParams: SdkMethodParams = {
    routeParams: mergeDecoratedArgs(Param),
    queryParams: mergeDecoratedArgs(Query),
    bodyParams: mergeDecoratedArgs(Body),
    context,
  }

  /**
   * Validate Body Params are not used in GET requests
   */
  if (httpMethod === SdkHttpMethod.Get && resolvedParams.bodyParams) {
    panicWithContext(`${httpMethod} request should not have @Body params, use @Query params instead`, context)
  }

  /**
   * Validate Query Params are not used in non-GET requests
   */
  if (httpMethod !== SdkHttpMethod.Get && resolvedParams.queryParams) {
    panicWithContext(`${httpMethod} request should not have @Query params, use @Body params instead`, context)
  }

  /**
   * Validate Route Params exist in route URL
   */
  const { routeParams } = resolvedParams
  if (routeParams) {
    const allowedRouteParams = new Set(paramsFromRoute(route))
    // Like the legacy analyzer, this checks the keys of the resolved params object. For a generic `@Param()` argument,
    // these are the keys of the resolved type's description (rawType, resolvedType...), which are rejected.
    const usedRouteParams = Object.keys(routeParams)

    for (const usedParam of usedRouteParams) {
      if (!allowedRouteParams.has(usedParam)) {
        panicWithContext(`Route param ${usedParam} does not appear in route URL`, context)
      }
    }
  }

  return resolvedParams
}

function extractDecoratedArgs(context: MethodContext): Record<ArgDecorator, DecoratedArg[]> {
  const decoratedArgs = {
    [ArgDecorator.Param]: [] as DecoratedArg[],
    [ArgDecorator.Query]: [] as DecoratedArg[],
    [ArgDecorator.Body]: [] as DecoratedArg[],
  }

  const { controllerClass, host, method, sourceFile } = context
  const args: TsNode[] = method.parameters

  for (const arg of args) {
    const argName = nodeName(arg, sourceFile)

    debug('├───── Detected argument: {yellow}', argName!)

    // Arguments are collected as soon as they have a decorator like @Query() or @Body()
    const argDecorators = getDecorators(host, arg).filter((dec) =>
      (Object.values(ArgDecorator) as string[]).includes(decoratorName(host, dec, sourceFile))
    )

    if (argDecorators.length === 0) {
      // If we have no argument, this is not an argument we are interested in, so we just skip it
      debug('├───── Skipping this argument as it does not have a decorator')
      continue
    } else if (argDecorators.length > 1) {
      panic(
        `${nodeName(controllerClass, sourceFile)} ${nodeName(method, sourceFile)} has multiple decorators on argument ${argName} ${argDecorators
          .map((dec) => decoratorName(host, dec, sourceFile))
          .join(', ')}`
      )
    }
    // Get the only decrator
    const decorator = argDecorators[0]
    const decoratorType = decoratorName(host, decorator, sourceFile) as ArgDecorator
    const argParamKey = extractArgParamKey({ ...context, arg, decorator })
    const argType = host.getTypeAtLocation(arg)

    if (!argParamKey && !host.isObjectType(argType)) {
      panic(
        `${nodeName(controllerClass, sourceFile)} ${nodeName(method, sourceFile)} generic controller argument ${decoratorType}() ${argName} must be an object type`
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

function extractArgParamKey(
  context: MethodContext & {
    arg: TsNode
    decorator: TsNode
  }
): string | null {
  const { arg, controllerClass, decorator, host, method, sourceFile } = context
  const decoratorArgs = decoratorArguments(host, decorator)

  if (decoratorArgs.length > 1) {
    panic(
      `${nodeName(controllerClass, sourceFile)} ${nodeName(method, sourceFile)} ${decoratorName(host, decorator, sourceFile)}() ${nodeName(
        arg,
        sourceFile
      )} argument decorator has multiple parameters`
    )
  } else if (decoratorArgs.length === 0) {
    return null
  }

  const decoratorArg = decoratorArgs[0]

  if (!isStringLiteral(host, decoratorArg)) {
    panic('The argument provided to the decorator is not a string literal:\n>>> {cyan}', nodeText(arg, sourceFile))
  }

  const paramKey: string = decoratorArg.text
  if (paramKey in {}) {
    panicWithContext(
      `${decoratorName(host, decorator, sourceFile)}('${paramKey}') param name collides with JavaScript native object property`,
      context
    )
  }

  return paramKey
}

function mergeDecoratedArgs(decoratedArgs: DecoratedArg[]): SdkMethodParam {
  let genericParam: SdkMethodParam | null = null
  const paramMap: SdkMethodParamMap = {}

  for (const decoratedArg of decoratedArgs) {
    const { arg, argParamKey, context, decoratorType } = decoratedArg
    const resolvedType = resolveTypeTextDependencies(
      context.host.typeToString(context.host.getTypeAtLocation(arg)),
      context.filePath,
      context.absoluteSrcPath
    )

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
  const { controllerClass, filePath, httpMethod, method, sourceFile } = context
  const ctx = {
    controller: nodeName(controllerClass, sourceFile),
    method: nodeName(method, sourceFile),
    httpMethod,
    filePath,
  }
  panic(`${message}\n${JSON.stringify(ctx, null, 2)}`)
}

// =============================================================================================================== //
// Types extraction (see src/analyzer/extractor.ts, src/analyzer/classdeps.ts)                                     //
// =============================================================================================================== //

function analyzeClassDeps(
  host: AnalysisHost,
  decl: TsNode,
  sourceFile: TsNode,
  relativeFilePath: string,
  absoluteSrcPath: string
): ResolvedTypeDeps[] {
  if (path.isAbsolute(relativeFilePath)) {
    unreachable(
      'Internal error: got absolute file path in class dependencies analyzer, when expecting a relative one (got {magentaBright})',
      relativeFilePath
    )
  }

  const toLookup = new Array<TsType>()

  for (const sup of getExtendsTypeNodes(host, decl)) {
    toLookup.push(host.getTypeAtLocation(sup))
  }

  for (const prop of getDeclarationProperties(host, decl, sourceFile)) {
    toLookup.push(host.getTypeAtLocation(prop))
  }

  return toLookup.map((type) => resolveTypeTextDependencies(host.typeToString(type), relativeFilePath, absoluteSrcPath))
}

/**
 * Types extractor
 */
class TypesExtractor {
  constructor(
    /** Analysis engine */
    public readonly host: AnalysisHost,

    /** Absolute source path */
    public readonly absoluteSrcPath: string,

    /** Magic types to replace non-portable types */
    public readonly magicTypes: Array<MagicType>,

    /** Extracted types */
    public readonly extracted: TypesExtractorContent = new Map()
  ) {}

  /**
   * Find if a type has previously been extracted, without providing its extension
   * @param loc
   * @returns
   */
  findExtractedTypeWithoutExt(loc: TypeLocation): ExtractedType | null {
    for (const ext of MODULE_EXTENSIONS) {
      const typ = this.extracted.get(loc.relativePathNoExt + ext)?.get(loc.typename)

      if (typ) {
        return typ
      }
    }

    return null
  }

  /**
   * Find the relative file location of a type
   * @param loc
   * @returns
   */
  findTypeRelativeFilePath(loc: TypeLocation): string | Error {
    if (path.isAbsolute(loc.relativePathNoExt)) {
      unreachable(
        'Internal error: got absolute file path in types extractor, when expecting a relative one (got {magentaBright})',
        loc.relativePathNoExt
      )
    }

    const absolutePathNoExt = path.resolve(this.absoluteSrcPath, loc.relativePathNoExt)

    const cached = this.findExtractedTypeWithoutExt(loc)

    if (cached) {
      return cached.relativePath
    }

    let relativeFilePath: string | null = null

    for (const ext of MODULE_EXTENSIONS) {
      if (this.host.getSourceFile(absolutePathNoExt + ext)) {
        relativeFilePath = loc.relativePathNoExt + ext
      }
    }

    return (
      relativeFilePath ??
      new Error(
        format('File {magenta} was not found (was expected to contain dependency type {yellow})', loc.relativePathNoExt, loc.typename)
      )
    )
  }

  /**
   * Extract a type
   * @param loc
   * @param typesPath
   * @returns
   */
  extractType(loc: TypeLocation, typesPath: string[] = []): ExtractedType | Error {
    const { host } = this
    const SK = host.SyntaxKind

    if (path.isAbsolute(loc.relativePathNoExt)) {
      unreachable(
        'Internal error: got absolute file path in types extractor, when expecting a relative one (got {magentaBright})',
        loc.relativePathNoExt
      )
    }

    // Get the absolute path of the type's parent file
    // We don't know its extension yet as imported file names in import statements don't have an extension
    const absolutePathNoExt = path.resolve(this.absoluteSrcPath, loc.relativePathNoExt)

    // If the type is already in cache, return it directly
    const cached = this.findExtractedTypeWithoutExt(loc)

    if (cached) {
      return cached
    }

    // Try to find the path with extension of the file and get it as a source file
    // (like the legacy analyzer, the last matching extension wins)
    let fileAndPath: [TsNode, string] | null = null

    for (const ext of MODULE_EXTENSIONS) {
      const sourceFile = host.getSourceFile(absolutePathNoExt + ext)

      if (sourceFile) {
        fileAndPath = [sourceFile, loc.relativePathNoExt + ext]
      }
    }

    if (!fileAndPath) {
      return new Error(
        format('File {magenta} was not found (was expected to contain dependency type {yellow})', loc.relativePathNoExt, loc.typename)
      )
    }

    const [file, relativeFilePath] = fileAndPath

    // Use magic types to replace non-portable types
    for (const magicType of this.magicTypes) {
      if (relativeFilePath.endsWith(`node_modules/${magicType.nodeModuleFilePath}`) && loc.typename === magicType.typeName) {
        debug(
          '-> '.repeat(typesPath.length + 1) +
            'Found magic type {yellow} from external module file {magentaBright}, using provided placeholder.',
          loc.typename,
          relativeFilePath
        )

        const extracted: ExtractedType = {
          content: '/** @file Magic placeholder from configuration file */\n\n' + magicType.placeholderContent,
          relativePath: relativeFilePath,
          relativePathNoExt: loc.relativePathNoExt,
          typename: loc.typename,
          typeParams: [],
          dependencies: [],
        }

        typesPath.pop()

        let types = this.extracted.get(relativeFilePath)

        if (!types) {
          types = new Map()
          this.extracted.set(relativeFilePath, types)
        }

        types.set(loc.typename, extracted)

        return extracted
      }
    }

    debug('-> '.repeat(typesPath.length + 1) + 'Extracting type {yellow} from file {magentaBright}...', loc.typename, relativeFilePath)

    // Analyze the type's declaration
    const decl = (file.statements as TsNode[]).find((node) => {
      return (
        (node.kind === SK.EnumDeclaration ||
          node.kind === SK.TypeAliasDeclaration ||
          node.kind === SK.InterfaceDeclaration ||
          node.kind === SK.ClassDeclaration ||
          node.kind === SK.FunctionDeclaration) &&
        nodeName(node, file) === loc.typename
      )
    })

    if (!decl) {
      return new Error(format(`Type {yellow} was not found in file {magenta}`, loc.typename, relativeFilePath))
    }

    // Handle a limitation of the tool: you can't import two types from two files at the same path with just two different extensions
    // Example: importing a type named "User" from two files in the same directory called "user.entity.ts" and "user.entity.js"
    const typ = this.findExtractedTypeWithoutExt(loc)

    if (typ && typ.relativePath !== relativeFilePath) {
      panic(
        'Found two conflicting files at same path but with different extensions:\n> {magentaBright}\n> {magentaBright}',
        typ.relativePath,
        relativeFilePath
      )
    }

    /** Resolved type's dependencies */
    let resolvedDeps: ResolvedTypeDeps[]

    /** Type's parameters (e.g. <T>) */
    let typeParams: string[]

    /** Type declaration */
    let extractedDecl = nodeText(decl, file)

    // Handle enumerations
    if (decl.kind === SK.EnumDeclaration) {
      resolvedDeps = []
      typeParams = []
    }

    // Handle type aliases
    else if (decl.kind === SK.TypeAliasDeclaration) {
      resolvedDeps = [resolveTypeTextDependencies(host.typeToString(host.getTypeAtLocation(decl)), relativeFilePath, this.absoluteSrcPath)]
      typeParams = []
    }

    // Handle interfaces
    else if (decl.kind === SK.InterfaceDeclaration) {
      resolvedDeps = analyzeClassDeps(host, decl, file, relativeFilePath, this.absoluteSrcPath)
      typeParams = (decl.typeParameters ?? []).map((tp: TsNode) => nodeText(tp, file))
    }

    // Handle classes
    // Methods are not handled because they shouldn't be used as DTOs and won't be decodable from JSON in all cases
    // This part is tricky as we remake the class from scratch using the informations we have on it, given we have to get rid
    //  of methods as well as removing decorators
    else if (decl.kind === SK.ClassDeclaration) {
      const classHead = nodeText(decl, file).match(/\b(export[^{]+class[^{]+{)/)

      if (!classHead) {
        unreachable('Internal error: failed to match class head in declaration: {yellow}', nodeText(decl, file))
      }

      extractedDecl = classHead[1]

      const index = host.getIndexType(host.getTypeAtLocation(decl), 'string') ?? host.getIndexType(host.getTypeAtLocation(decl), 'number')

      if (index) {
        extractedDecl += '\npublic [input: string | number]: ' + getImportResolvedTypeText(host.typeToString(index))
      }

      // Export all members
      for (const member of getClassMembers(host, decl, file)) {
        if (member.kind !== SK.PropertyDeclaration) {
          warn('Found non-property member in class {cyan}: {magenta}', nodeName(decl, file) ?? '<anonymous>', nodeText(member, file))
          continue
        }

        const memberType = host.getTypeAtLocation(member)
        const memberText = nodeText(member, file)

        extractedDecl += `\npublic ${nodeName(member, file)}${
          memberText.includes('?') ? '?' : memberText.includes('!:') ? '!' : ''
        }: ${getImportResolvedTypeText(host.typeToString(memberType))};`
      }

      extractedDecl += '\n}'

      resolvedDeps = analyzeClassDeps(host, decl, file, relativeFilePath, this.absoluteSrcPath)
      typeParams = (decl.typeParameters ?? []).map((tp: TsNode) => nodeText(tp, file))
    }

    // Handle functions
    else if (decl.kind === SK.FunctionDeclaration) {
      resolvedDeps = []
      typeParams = []
    }

    // Handle unknown types
    else {
      panic('Unknown node type when extracting types: ' + decl.kind)
    }

    /** Normalized dependencies */
    const dependencies: TypeLocationWithExt[] = []

    // Ensure we're not stuck in an infinite loop where we analyze a type A, then its dependency B, which itself depends on A, and so on
    if (typesPath.includes(loc.typename)) {
      unreachable(`Internal error: infinite loop detected in types extracted: {yellow}`, typesPath.join(' -> '))
    }

    typesPath.push(loc.typename)

    // Analyze all dependencies
    for (const dependencyLoc of locateTypesFile(resolvedDeps)) {
      // If the "dependency" is one of the type's parameters (e.g. "T"), ignore this part
      if (typeParams.includes(dependencyLoc.typename)) {
        continue
      }

      // Find the dependency's relative path
      let relativePath: string | Error

      const cached = this.findExtractedTypeWithoutExt(dependencyLoc)

      if (cached) {
        relativePath = cached.relativePath
      } else if (typesPath.includes(dependencyLoc.typename)) {
        relativePath = this.findTypeRelativeFilePath(dependencyLoc)
      } else {
        const extracted = this.extractType(dependencyLoc, typesPath)
        relativePath = extracted instanceof Error ? extracted : extracted.relativePath
      }

      if (relativePath instanceof Error) {
        return new Error(
          format(
            '├─ Failed to extract type {yellow} due to an error in dependency type {yellow}\nfrom file {magenta} :\n{}',
            loc.typename,
            dependencyLoc.typename,
            relativeFilePath,
            relativePath.message.replace(/^/gm, '  ')
          )
        )
      }

      // Update dependencies
      dependencies.push({ ...dependencyLoc, relativePath })
    }

    const extracted: ExtractedType = {
      ...loc,
      relativePath: relativeFilePath,
      typeParams,
      content: extractedDecl,
      dependencies,
    }

    typesPath.pop()

    let types = this.extracted.get(relativeFilePath)

    if (!types) {
      types = new Map()
      this.extracted.set(relativeFilePath, types)
    }

    // Save the dependency
    types.set(loc.typename, extracted)

    return extracted
  }
}

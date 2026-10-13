/**
 * @file Minimal compiler interface the analyzer needs from a TypeScript engine
 *
 * Both the in-process TypeScript compiler API and the TypeScript 7 native (tsgo) API expose the same AST shapes
 * (`kind`, `statements`, `members`, `modifiers`...) and the same checker operations, so the analyzer is written once
 * against this interface. Syntax kinds differ between TypeScript versions, so they are provided by the host.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** A compiler AST node (TypeScript JS API or TypeScript 7 API) */
export type TsNode = any

/** A compiler type (TypeScript JS API or TypeScript 7 API) */
export type TsType = any

/**
 * Flags ts-morph uses by default when printing a type with `Type.getText()`:
 * UseTypeOfFunction (4096) | NoTruncation (1) | UseFullyQualifiedType (64) | WriteTypeArgumentsOfSignature (32)
 */
export const TYPE_FORMAT_FLAGS = 4193

export interface SyntaxKinds {
  readonly AbstractKeyword: number
  readonly CallExpression: number
  readonly ClassDeclaration: number
  readonly ClassStaticBlockDeclaration: number
  readonly Constructor: number
  readonly DeclareKeyword: number
  readonly Decorator: number
  readonly EnumDeclaration: number
  readonly ExtendsKeyword: number
  readonly FunctionDeclaration: number
  readonly GetAccessor: number
  readonly Identifier: number
  readonly InterfaceDeclaration: number
  readonly MethodDeclaration: number
  readonly ParenthesizedExpression: number
  readonly PropertyAccessExpression: number
  readonly PropertyDeclaration: number
  readonly PropertySignature: number
  readonly SetAccessor: number
  readonly StringLiteral: number
  readonly TypeAliasDeclaration: number
}

export interface AnalysisHost {
  readonly SyntaxKind: SyntaxKinds

  /** Release the engine's resources */
  dispose(): void

  /** Equivalent of ts-morph's `type.getStringIndexType()` / `type.getNumberIndexType()` */
  getIndexType(type: TsType, keyKind: 'string' | 'number'): TsType | undefined

  /**
   * Absolute paths of the project's source files: the files ts-morph would consider part of the project (the tsconfig's
   * files and the non-`node_modules` files they import), in the order of ts-morph's `project.getSourceFiles()`
   */
  getProjectFilePaths(): string[]

  /** Equivalent of ts-morph's `method.getReturnType()` */
  getReturnTypeOfDeclaration(node: TsNode): TsType

  /** Get a source file of the program, if it exists */
  getSourceFile(absolutePath: string): TsNode | undefined

  /** Equivalent of ts-morph's `node.getType()` */
  getTypeAtLocation(node: TsNode): TsType

  /** Equivalent of ts-morph's `type.isObject()` */
  isObjectType(type: TsType): boolean

  /** Engine name, for logging */
  readonly name: string

  /** Equivalent of ts-morph's `type.getText()` */
  typeToString(type: TsType): string
}

/**
 * @file AST helpers reproducing the semantics of the ts-morph methods used by the legacy analyzer
 */

import { AnalysisHost, TsNode } from './host'

/** ts-morph's `node.getText()`: the node's source text, without leading trivia */
export function nodeText(node: TsNode, sourceFile: TsNode): string {
  return sourceFile.text.substring(node.getStart(sourceFile), node.end)
}

/** ts-morph's `node.getName()` for named and nameable declarations (class, function, method, parameter...) */
export function nodeName(node: TsNode, sourceFile: TsNode): string | undefined {
  return node.name ? nodeText(node.name, sourceFile) : undefined
}

/** ts-morph's `node.getDecorators()` */
export function getDecorators(host: AnalysisHost, node: TsNode): TsNode[] {
  return (node.modifiers ?? []).filter((m: TsNode) => m.kind === host.SyntaxKind.Decorator)
}

/** ts-morph's `decorator._getInnerExpression()` */
function decoratorInnerExpression(host: AnalysisHost, decorator: TsNode): TsNode {
  let expr = decorator.expression
  while (expr.kind === host.SyntaxKind.ParenthesizedExpression) expr = expr.expression
  return expr
}

/** ts-morph's `decorator.getCallExpression()` */
export function decoratorCallExpression(host: AnalysisHost, decorator: TsNode): TsNode | undefined {
  const expr = decoratorInnerExpression(host, decorator)
  return expr.kind === host.SyntaxKind.CallExpression ? expr : undefined
}

/** ts-morph's `decorator.getArguments()` */
export function decoratorArguments(host: AnalysisHost, decorator: TsNode): TsNode[] {
  return decoratorCallExpression(host, decorator)?.arguments ?? []
}

/** ts-morph's `decorator.getName()` */
export function decoratorName(host: AnalysisHost, decorator: TsNode, sourceFile: TsNode): string {
  const callExpression = decoratorCallExpression(host, decorator)
  let identifier = callExpression ? callExpression.expression : decoratorInnerExpression(host, decorator)

  if (identifier.kind === host.SyntaxKind.PropertyAccessExpression) {
    identifier = identifier.name
  }

  if (identifier.kind !== host.SyntaxKind.Identifier) {
    throw new Error(
      `Expected the decorator expression '${nodeText(identifier, sourceFile)}' to be an identifier. ` +
        `Please deal directly with 'getExpression()' on the decorator to handle more complex scenarios.`
    )
  }

  return nodeText(identifier, sourceFile)
}

/** ts-morph's `Node.isStringLiteral()` */
export function isStringLiteral(host: AnalysisHost, node: TsNode): boolean {
  return node.kind === host.SyntaxKind.StringLiteral
}

function hasModifier(node: TsNode, kind: number): boolean {
  return (node.modifiers ?? []).some((m: TsNode) => m.kind === kind)
}

/** ts-morph's `classDeclaration.getMembers()` */
export function getClassMembers(host: AnalysisHost, decl: TsNode, sourceFile: TsNode): TsNode[] {
  const SK = host.SyntaxKind
  const isAmbient = hasModifier(decl, SK.DeclareKeyword) || sourceFile.isDeclarationFile

  return (decl.members as TsNode[])
    .filter((m) => {
      if (isAmbient) return true
      if (m.kind !== SK.Constructor && m.kind !== SK.MethodDeclaration) return true
      if (m.kind === SK.MethodDeclaration && hasModifier(m, SK.AbstractKeyword)) return true
      return m.body != null
    })
    .filter((m) =>
      [
        SK.MethodDeclaration,
        SK.PropertyDeclaration,
        SK.GetAccessor,
        SK.SetAccessor,
        SK.Constructor,
        SK.ClassStaticBlockDeclaration,
      ].includes(m.kind)
    )
}

/** ts-morph's `classDeclaration.getProperties()` / `interfaceDeclaration.getProperties()` */
export function getDeclarationProperties(host: AnalysisHost, decl: TsNode, sourceFile: TsNode): TsNode[] {
  const SK = host.SyntaxKind
  return decl.kind === SK.ClassDeclaration
    ? getClassMembers(host, decl, sourceFile).filter((m) => m.kind === SK.PropertyDeclaration)
    : (decl.members as TsNode[]).filter((m) => m.kind === SK.PropertySignature)
}

/** ts-morph's `classDeclaration.getExtends()` (first type only) / `interfaceDeclaration.getExtends()` (all types) */
export function getExtendsTypeNodes(host: AnalysisHost, decl: TsNode): TsNode[] {
  const clause = (decl.heritageClauses ?? []).find((c: TsNode) => c.token === host.SyntaxKind.ExtendsKeyword)
  const types: TsNode[] = clause?.types ?? []
  return decl.kind === host.SyntaxKind.ClassDeclaration ? types.slice(0, 1) : types
}

/**
 * @file Analysis host running on the TypeScript program built by ts-morph (TypeScript 4.8)
 *
 * This is not meant for users: it runs the engine-independent analyzer against the exact same program, type checker
 * and file order as the legacy ts-morph analyzer, which lets the parity tests verify both analyzers are equivalent.
 */

import { Project, ts } from 'ts-morph'

import { AnalysisHost } from './host'
import { createProgramHost } from './typescript-host'

export function createTsMorphCompatHost(tsConfigFilePath: string): AnalysisHost {
  // Same project setup as the legacy analyzer (src/analyzer/index.ts)
  const project = new Project({ tsConfigFilePath })

  const projectFilePaths = project.getSourceFiles().map((file) => file.getFilePath() as string)

  return createProgramHost('ts-morph-compat', ts, project.getProgram().compilerObject, projectFilePaths)
}

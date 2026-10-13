// An ES module referenced from CommonJS files: TypeScript 5.3+ prints its types with a resolution mode attribute
export interface Change {
  key: string
  type: 'ADD' | 'REMOVE' | 'UPDATE'
}

export type Changeset = Change[]

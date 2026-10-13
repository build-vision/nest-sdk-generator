export interface PaginationQuery {
  page?: number
  perPage?: number
}

export class PaginationResults<T> {
  results: T[]
  page: number
  total: number
}

export type Id<Brand extends string> = string & { readonly __brand: Brand }

export function paginate<T>(results: T[], page = 1): PaginationResults<T> {
  return { results, page, total: results.length }
}

export const sortDirections = ['asc', 'desc'] as const

export type SortDirection = (typeof sortDirections)[number]

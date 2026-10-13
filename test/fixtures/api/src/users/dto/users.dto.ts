import { Role, User } from '../../entities/user.entity'
import { PaginationQuery, SortDirection } from '../../utils/pagination'

export class ListUsersQuery implements PaginationQuery {
  page?: number
  perPage?: number
  role?: Role
  sort?: SortDirection
}

export class CreateUserDto {
  name: string
  email: string
  role?: Role
}

export type UpdateUserDto = Partial<Pick<User, 'name' | 'nickname' | 'preferences'>>

export interface UserStats {
  articles: number
  lastSeenAt: Date | null
}

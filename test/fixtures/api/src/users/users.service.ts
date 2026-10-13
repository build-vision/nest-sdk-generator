import { Injectable } from '@nestjs/common'

import { User } from '../entities/user.entity'
import { paginate } from '../utils/pagination'

import { CreateUserDto, ListUsersQuery, UpdateUserDto, UserStats } from './dto/users.dto'

@Injectable()
export class UsersService {
  private readonly users: User[] = []

  async list(query: ListUsersQuery) {
    return paginate(this.users, query.page)
  }

  async findOne(id: string) {
    return this.users.find((user) => user.id === id) ?? null
  }

  async create(dto: CreateUserDto) {
    return { ...dto, id: 'new', createdAt: new Date() }
  }

  async update(id: string, dto: UpdateUserDto): Promise<User | undefined> {
    return Object.assign(this.users.find((user) => user.id === id) ?? new User(), dto)
  }

  stats(): UserStats {
    return { articles: 0, lastSeenAt: null }
  }
}

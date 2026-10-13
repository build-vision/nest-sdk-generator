import { Body, Controller, Delete, Get, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common'

import { User } from '../entities/user.entity'
import { Id, PaginationResults } from '../utils/pagination'

import { CreateUserDto, ListUsersQuery, UpdateUserDto } from './dto/users.dto'
import { UsersService } from './users.service'

/** A type local to the controller's file */
export interface UserLookup {
  found: boolean
  user?: User
}

@UseGuards()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  // Generic query object, explicit return type
  @Get()
  listUsers(@Query() query: ListUsersQuery): Promise<PaginationResults<User>> {
    return this.usersService.list(query)
  }

  // Route param, inferred return type
  @Get(':id')
  async getUser(@Param('id') id: Id<'User'>) {
    return this.usersService.findOne(id)
  }

  // Query params by key, return type local to this file
  @Get('lookup')
  lookupUser(@Query('email') email: string, @Query('strict') strict?: boolean): UserLookup {
    return { found: email.length > 0 && strict !== false }
  }

  @Get('stats')
  userStats() {
    return this.usersService.stats()
  }

  @Get(':id/avatar')
  userAvatar(@Param('id') id: string, @Req() request: unknown): Promise<string> {
    void request
    return Promise.resolve(`/avatars/${id}.png`)
  }

  // Generic body object, inferred return type built with a spread
  @Post()
  async createUser(@Body() body: CreateUserDto) {
    return this.usersService.create(body)
  }

  // Route param + body params by key
  @Patch(':id')
  renameUser(@Param('id') id: string, @Body('name') name: string, @Body('nickname') nickname?: string) {
    return this.usersService.update(id, { name, nickname })
  }

  @Put(':id')
  updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.usersService.update(id, dto)
  }

  @Delete(':id')
  removeUser(@Param('id') id: string): void {
    void id
  }

  // No HTTP decorator: not part of the SDK
  helper(): string {
    return 'not exposed'
  }
}

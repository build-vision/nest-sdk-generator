import { Collection } from '@mikro-orm/core'
import { Column } from '@nestjs/common'
import { Decimal, GeoPoint } from 'fake-lib'

import { Money } from '../../../shared/money'

import { Article } from './article.entity'
import { BaseEntity } from './base.entity'

export enum Role {
  Admin = 'admin',
  Member = 'member',
}

export interface Address {
  city: string
  location?: GeoPoint
  street: string
}

export interface ContactInfo extends Address {
  emails: string[]
  phone: string | null
}

export type Preferences = {
  notifications: Record<string, boolean>
  theme: 'dark' | 'light'
}

export class User extends BaseEntity<'User'> {
  @Column()
  name: string

  @Column()
  email!: string

  nickname?: string

  role: Role = Role.Member

  contact: ContactInfo

  preferences: Preferences

  articles: Collection<Article>

  balance: Money

  credits: Decimal

  static readonly tableName = 'users'

  constructor() {
    super()
  }

  get displayName(): string {
    return this.nickname ?? this.name
  }

  greet(): string {
    return `Hello ${this.name}`
  }
}

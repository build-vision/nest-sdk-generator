import { Column } from '@nestjs/common'

import { Id } from '../utils/pagination'

export abstract class BaseEntity<Name extends string> {
  @Column()
  id: Id<Name>

  @Column()
  createdAt: Date

  updatedAt?: Date | null
}

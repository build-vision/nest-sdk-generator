import type { Changeset } from 'esm-types-lib'

import { Id } from '../utils/pagination'

import { BaseEntity } from './base.entity'
import type { User } from './user.entity'

export enum ArticleStatus {
  Draft,
  Published,
  Archived,
}

/** Recursive types: comments reference their article, which references its comments */
export interface Comment {
  article: Article
  author?: User
  id: Id<'Comment'>
  replies: Comment[]
}

export class Article extends BaseEntity<'Article'> {
  title: string
  status: ArticleStatus
  author: User
  comments: Comment[]
  tags: [string, ...string[]]
  history: Changeset
}

/** A class with an index signature */
export class ArticleMetadata {
  [key: string]: string | number

  version: number
}

export function articleSummary(article: Article) {
  return { title: article.title, status: article.status }
}

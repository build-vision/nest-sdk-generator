import { Body, Controller, Get, Param, Post } from '@nestjs/common'

import { Money } from '../../../shared/money'
import { Article, ArticleMetadata, ArticleStatus, articleSummary } from '../entities/article.entity'

// No argument: registered under its camel-cased class name, routes are not prefixed
@Controller()
export class ArticlesController {
  private readonly articles: Article[] = []

  @Get('articles')
  listArticles(): Article[] {
    return this.articles
  }

  @Get('articles/:articleId/summary')
  getArticleSummary(@Param('articleId') articleId: string): ReturnType<typeof articleSummary> | null {
    const article = this.articles.find((a) => a.id === articleId)
    return article ? articleSummary(article) : null
  }

  @Get('articles/by-status/:status')
  articlesByStatus(@Param('status') status: ArticleStatus) {
    return this.articles.filter((a) => a.status === status).map((a) => a.title)
  }

  @Post('articles/:articleId/tip')
  tipArticle(@Param('articleId') articleId: string, @Body('amount') amount: Money) {
    return { articleId, amount, at: new Date() as Date | undefined }
  }

  @Get('articles/metadata')
  articlesMetadata(): ArticleMetadata[] {
    return []
  }

  @Get('health')
  health(): 'ok' | 'degraded' {
    return 'ok'
  }
}

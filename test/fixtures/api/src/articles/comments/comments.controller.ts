import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common'

import { Comment } from '../../entities/article.entity'

// Lives in a sub-directory without a module file: belongs to ArticlesModule
@Controller('articles/:articleId/comments')
export class CommentsController {
  @Get()
  listComments(@Param('articleId') articleId: string): Promise<Comment[]> {
    void articleId
    return Promise.resolve([])
  }

  @Post()
  addComment(@Param('articleId') articleId: string, @Body() body: { replyTo?: Comment['id']; text: string }) {
    return { articleId, ...body }
  }

  @Delete(':commentId')
  removeComment(@Param('articleId') articleId: string, @Param('commentId') commentId: string) {
    return [articleId, commentId] as const
  }
}

// Misuses the generated client must reject (each line must be a type error)
import { API } from './store'

// @ts-expect-error -- missing route parameter
API.Comments.listComments.initiate({})

// @ts-expect-error -- wrong body property type
API.Comments.addComment.initiate({ articleId: 'a', text: 42 })

// @ts-expect-error -- unknown endpoint
API.Comments.editComment.initiate({ articleId: 'a' })

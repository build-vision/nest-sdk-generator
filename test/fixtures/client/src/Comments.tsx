import { API } from './store'

export function Comments({ articleId }: { articleId: string }) {
  const { data: comments, error, isLoading } = API.Comments.listComments.useQuery({ articleId })
  const [addComment, { isLoading: isSaving }] = API.Comments.addComment.useMutation()
  // Optional keyed parameters are required keys whose value may be undefined (see README)
  const { data: lookup } = API.Users.lookupUser.useQuery({ email: 'jane@example.com', strict: undefined })

  if (isLoading) return <p>Loading...</p>
  // Hooks' errors are the request function's error type, or RTK Query's SerializedError
  if (error) return <p>{'userMessage' in error ? error.userMessage : error.message}</p>

  return (
    <>
      <p>{lookup?.user?.name}</p>
      <ul>{comments?.map((comment) => <li key={comment.id}>{comment.replies.length} replies</li>)}</ul>
      <button disabled={isSaving} onClick={() => addComment({ articleId, text: 'Nice!' })}>
        Comment
      </button>
    </>
  )
}

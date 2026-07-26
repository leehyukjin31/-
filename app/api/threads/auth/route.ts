/**
 * 인증 시작점. 사용자를 Meta 인증창으로 보낸다.
 * 브라우저에서 /api/threads/auth 로 들어오면 threads.net 으로 튕겨나간다.
 */
import { redirect } from 'next/navigation'
import { buildAuthorizeUrl, readConfig, ThreadsApiError } from '@/lib/threads'
import { issueState } from '@/lib/session'

export async function GET() {
  let authorizeUrl: string

  try {
    const config = readConfig()
    const state = await issueState()
    authorizeUrl = buildAuthorizeUrl(config, state)
  } catch (error) {
    const message =
      error instanceof ThreadsApiError
        ? error.message
        : '알 수 없는 오류가 발생했습니다.'
    // 설정이 안 됐으면 홈으로 돌려보내면서 이유를 보여준다.
    redirect(`/?error=${encodeURIComponent(message)}`)
  }

  // redirect()는 내부적으로 예외를 던지므로 try 블록 밖에서 호출한다.
  redirect(authorizeUrl)
}

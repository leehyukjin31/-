/**
 * Meta가 인증 후 사용자를 여기로 돌려보낸다.
 * 이 주소가 Meta 앱 설정의 "Redirect Callback URL" 과 한 글자도 다르지 않아야 한다.
 *
 * 흐름: code 수신 → 단기 토큰(1시간) → 장기 토큰(60일) → 쿠키 저장 → 홈으로
 */
import type { NextRequest } from 'next/server'
import { redirect } from 'next/navigation'
import {
  exchangeCodeForShortLivedToken,
  exchangeForLongLivedToken,
  getProfile,
  readConfig,
  ThreadsApiError,
} from '@/lib/threads'
import { consumeState, saveConnection } from '@/lib/session'

function toHome(params: Record<string, string>): never {
  const qs = new URLSearchParams(params).toString()
  redirect(`/?${qs}`)
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const state = url.searchParams.get('state')

  // 사용자가 인증창에서 "취소"를 누른 경우 Meta가 error 파라미터를 붙여 보낸다.
  const oauthError = url.searchParams.get('error')
  if (oauthError) {
    const desc =
      url.searchParams.get('error_description') ?? '인증이 취소되었습니다.'
    toHome({ error: `Meta 인증 거부: ${desc}` })
  }

  if (!code) {
    toHome({ error: '인증 코드가 오지 않았습니다. 다시 시도해주세요.' })
  }

  if (!(await consumeState(state))) {
    toHome({
      error:
        '보안 검증(state)에 실패했습니다. 홈에서 처음부터 다시 연결해주세요. ' +
        '(인증 시작 후 10분이 지나면 만료됩니다)',
    })
  }

  let successParams: Record<string, string>

  try {
    const config = readConfig()

    // 1시간짜리 단기 토큰
    const shortLived = await exchangeCodeForShortLivedToken(config, code!)

    // 60일짜리 장기 토큰으로 즉시 교환
    const longLived = await exchangeForLongLivedToken(
      config,
      shortLived.access_token,
    )

    // 누구 계정인지 확인 (실패해도 발행 자체엔 지장 없으므로 조용히 넘어간다)
    let username: string | undefined
    try {
      const profile = await getProfile(longLived.access_token)
      username = profile.username
    } catch {
      username = undefined
    }

    await saveConnection({
      userId: String(shortLived.user_id),
      username,
      accessToken: longLived.access_token,
      obtainedAt: new Date().toISOString(),
    })

    successParams = { connected: '1' }
  } catch (error) {
    const message =
      error instanceof ThreadsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : '알 수 없는 오류'
    toHome({ error: `토큰 발급 실패: ${message}` })
  }

  toHome(successParams)
}

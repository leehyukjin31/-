/**
 * Meta가 인증 후 사용자를 여기로 돌려보낸다.
 * 이 주소가 Meta 앱 설정의 "Redirect Callback URL" 과 한 글자도 다르지 않아야 한다.
 *
 * 흐름: code 수신 → 단기 토큰(1시간) → 장기 토큰(60일) → Supabase 저장 → 홈으로
 *
 * 2단계에서 바뀐 것: 토큰을 쿠키가 아니라 DB에 넣는다.
 * 계정을 7개까지 담아야 하고, 브라우저가 꺼져 있어도 서버가 읽어야 하기 때문이다.
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
import { consumeState } from '@/lib/session'
import { saveAccount } from '@/lib/accounts'
import { ConfigError } from '@/lib/supabase'

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

    // 어느 계정인지 확인한다.
    // 발행 엔드포인트가 /me 의 id 를 요구하므로 여기서 받은 값을 저장한다.
    const profile = await getProfile(longLived.access_token)

    const account = await saveAccount({
      threadsUserId: profile.id,
      username: profile.username ?? null,
      accessToken: longLived.access_token,
    })

    successParams = { connected: account.username ?? account.threadsUserId }
  } catch (error) {
    const message =
      error instanceof ThreadsApiError ||
      error instanceof ConfigError ||
      error instanceof Error
        ? error.message
        : '알 수 없는 오류'
    toHome({ error: `계정 연결 실패: ${message}` })
  }

  toHome(successParams)
}

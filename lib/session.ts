/**
 * OAuth 인증 과정에서 잠깐 쓰는 쿠키.
 *
 * 1단계에서는 여기에 토큰까지 넣었지만, 이제 토큰은 Supabase(lib/accounts.ts)에 있다.
 * 쿠키로는 계정 여러 개를 담을 수 없고, 브라우저가 꺼지면 서버가 못 읽어서
 * 예약 발행과 토큰 자동 갱신이 불가능하기 때문이다.
 *
 * 그래서 이 파일에는 CSRF 방어용 state 만 남는다.
 */
import { cookies } from 'next/headers'

const STATE_COOKIE = 'threads_oauth_state'

const isProd = process.env.NODE_ENV === 'production'

/**
 * CSRF 방지용 state.
 * 인증창에 보낸 값과 콜백으로 돌아온 값이 같은지 확인해서,
 * 제3자가 유도한 콜백 요청을 걸러낸다.
 */
export async function issueState(): Promise<string> {
  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true, // 브라우저 JS에서 접근 불가
    secure: isProd, // 배포 환경에서는 https 로만 전송
    sameSite: 'lax', // OAuth 리다이렉트로 돌아올 때 쿠키가 유지되도록
    path: '/',
    maxAge: 60 * 10, // 10분이면 인증 끝내기 충분
  })
  return state
}

/** 콜백에서 받은 state를 검증하고, 성공/실패와 무관하게 1회용으로 폐기한다. */
export async function consumeState(received: string | null): Promise<boolean> {
  const jar = await cookies()
  const expected = jar.get(STATE_COOKIE)?.value ?? null
  jar.delete(STATE_COOKIE)
  if (!expected || !received) return false
  return expected === received
}

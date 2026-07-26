/**
 * 1단계용 임시 토큰 보관소.
 *
 * 지금은 httpOnly 쿠키에 넣는다. 쿠키는 브라우저 JS가 읽을 수 없고 서버만 읽으므로
 * 혼자 테스트하는 단계에서는 충분히 안전하다.
 *
 * 3단계(병원 7계정)에서는 Supabase DB로 옮긴다. 이유:
 *   - 계정이 여러 개면 쿠키 하나로는 부족
 *   - 예약 발행은 대표님이 브라우저를 안 열어도 서버 혼자 돌아야 하는데,
 *     쿠키는 브라우저에 있어서 서버 혼자서는 못 읽는다
 */
import { cookies } from 'next/headers'

const CONNECTION_COOKIE = 'threads_connection'
const STATE_COOKIE = 'threads_oauth_state'

export type ThreadsConnection = {
  userId: string
  username?: string
  accessToken: string
  /** 장기 토큰 발급 시각 (ISO). 갱신 시점 계산용. */
  obtainedAt: string
}

const isProd = process.env.NODE_ENV === 'production'

export async function saveConnection(conn: ThreadsConnection): Promise<void> {
  const jar = await cookies()
  jar.set(CONNECTION_COOKIE, JSON.stringify(conn), {
    httpOnly: true, // 브라우저 JS에서 접근 불가
    secure: isProd, // 배포 환경에서는 https 로만 전송
    sameSite: 'lax', // OAuth 리다이렉트로 돌아올 때 쿠키가 유지되도록
    path: '/',
    maxAge: 60 * 60 * 24 * 60, // 60일 (장기 토큰 수명과 동일)
  })
}

export async function getConnection(): Promise<ThreadsConnection | null> {
  const jar = await cookies()
  const raw = jar.get(CONNECTION_COOKIE)?.value
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as ThreadsConnection
    if (!parsed?.accessToken || !parsed?.userId) return null
    return parsed
  } catch {
    // 형식이 깨진 쿠키는 없는 것으로 취급
    return null
  }
}

export async function clearConnection(): Promise<void> {
  const jar = await cookies()
  jar.delete(CONNECTION_COOKIE)
}

/**
 * CSRF 방지용 state.
 * 인증창에 보낸 값과 콜백으로 돌아온 값이 같은지 확인해서,
 * 제3자가 유도한 콜백 요청을 걸러낸다.
 */
export async function issueState(): Promise<string> {
  const state = crypto.randomUUID()
  const jar = await cookies()
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
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

/**
 * Threads API 클라이언트.
 *
 * 엔드포인트는 Meta 공식 문서 기준 (2026-07 확인):
 *   인증창       GET  https://threads.net/oauth/authorize
 *   단기 토큰    POST https://graph.threads.net/oauth/access_token       (1시간)
 *   장기 토큰    GET  https://graph.threads.net/access_token             (60일)
 *   토큰 갱신    GET  https://graph.threads.net/refresh_access_token     (60일 연장)
 *   컨테이너     POST https://graph.threads.net/v1.0/{user-id}/threads
 *   발행         POST https://graph.threads.net/v1.0/{user-id}/threads_publish
 *
 * 이 파일은 App Secret을 사용하므로 서버에서만 실행돼야 한다.
 * 클라이언트 컴포넌트에서 import 하지 말 것.
 */

const AUTH_HOST = 'https://threads.net'
const GRAPH_HOST = 'https://graph.threads.net'
const API_VERSION = 'v1.0'

/**
 * 처음 인증할 때 5개를 한 번에 받아둔다.
 * 나중에 댓글·인사이트 기능을 붙일 때 7개 계정을 재인증하는 수고를 없애기 위함.
 */
export const THREADS_SCOPES = [
  'threads_basic',
  'threads_content_publish',
  'threads_manage_replies',
  'threads_read_replies',
  'threads_manage_insights',
] as const

export type ThreadsConfig = {
  appId: string
  appSecret: string
  redirectUri: string
}

/** 사람이 읽을 수 있는 메시지를 담은 에러. 화면에 그대로 띄워도 되는 수준으로 씀. */
export class ThreadsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly raw: unknown,
  ) {
    super(message)
    this.name = 'ThreadsApiError'
  }
}

/**
 * .env.local(로컬) 또는 Vercel 환경변수에서 설정을 읽는다.
 * 값이 없으면 무엇을 어디에 넣어야 하는지 알려주는 에러를 던진다.
 */
export function readConfig(): ThreadsConfig {
  const appId = process.env.THREADS_APP_ID
  const appSecret = process.env.THREADS_APP_SECRET
  const redirectUri = process.env.THREADS_REDIRECT_URI

  const missing: string[] = []
  if (!appId) missing.push('THREADS_APP_ID')
  if (!appSecret) missing.push('THREADS_APP_SECRET')
  if (!redirectUri) missing.push('THREADS_REDIRECT_URI')

  if (missing.length > 0) {
    throw new ThreadsApiError(
      `환경변수가 비어 있습니다: ${missing.join(', ')}\n` +
        `프로젝트 폴더의 .env.local 파일(로컬) 또는 Vercel 환경변수에 채워주세요. ` +
        `.env.local.example 파일을 참고하시면 됩니다.`,
      500,
      { missing },
    )
  }

  return {
    appId: appId!,
    appSecret: appSecret!,
    redirectUri: redirectUri!,
  }
}

/** Meta 응답에서 에러 메시지를 최대한 알아볼 수 있게 뽑아낸다. */
function describeError(status: number, body: unknown): string {
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>

    // 형태 1: { error: { message, type, code } }
    const err = b.error
    if (err && typeof err === 'object') {
      const e = err as Record<string, unknown>
      const parts = [e.message, e.type, e.code].filter(Boolean)
      if (parts.length > 0) return String(parts.join(' / '))
    }

    // 형태 2: { error_type, error_message, code }
    if (b.error_message || b.error_type) {
      return String(
        [b.error_message, b.error_type].filter(Boolean).join(' / '),
      )
    }
  }
  return `HTTP ${status} · ${JSON.stringify(body).slice(0, 300)}`
}

async function request<T>(
  url: string,
  init?: RequestInit,
): Promise<T> {
  let res: Response
  try {
    // 토큰은 절대 캐시하지 않는다.
    res = await fetch(url, { ...init, cache: 'no-store' })
  } catch (cause) {
    throw new ThreadsApiError(
      `Threads 서버에 연결하지 못했습니다. 인터넷 연결을 확인해주세요.`,
      0,
      cause,
    )
  }

  const text = await res.text()
  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    body = text
  }

  if (!res.ok) {
    throw new ThreadsApiError(describeError(res.status, body), res.status, body)
  }
  return body as T
}

/** 1단계: 사용자를 보낼 Meta 인증창 주소를 만든다. */
export function buildAuthorizeUrl(config: ThreadsConfig, state: string): string {
  const url = new URL('/oauth/authorize', AUTH_HOST)
  url.searchParams.set('client_id', config.appId)
  url.searchParams.set('redirect_uri', config.redirectUri)
  url.searchParams.set('scope', THREADS_SCOPES.join(','))
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('state', state)
  return url.toString()
}

export type ShortLivedToken = {
  access_token: string
  user_id: string | number
}

/** 2단계: 콜백으로 받은 code를 단기 토큰(1시간)으로 교환. */
export async function exchangeCodeForShortLivedToken(
  config: ThreadsConfig,
  code: string,
): Promise<ShortLivedToken> {
  const form = new URLSearchParams({
    client_id: config.appId,
    client_secret: config.appSecret,
    code,
    grant_type: 'authorization_code',
    // 인증창에 보낸 값과 완전히 같아야 한다. 한 글자라도 다르면 실패한다.
    redirect_uri: config.redirectUri,
  })

  return request<ShortLivedToken>(`${GRAPH_HOST}/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  })
}

export type LongLivedToken = {
  access_token: string
  token_type?: string
  expires_in?: number
}

/** 3단계: 단기 토큰을 장기 토큰(60일)으로 교환. */
export async function exchangeForLongLivedToken(
  config: ThreadsConfig,
  shortLivedToken: string,
): Promise<LongLivedToken> {
  const url = new URL('/access_token', GRAPH_HOST)
  url.searchParams.set('grant_type', 'th_exchange_token')
  url.searchParams.set('client_secret', config.appSecret)
  url.searchParams.set('access_token', shortLivedToken)
  return request<LongLivedToken>(url.toString())
}

/**
 * 장기 토큰을 60일 더 연장한다.
 * 조건: 발급 후 24시간 이상 지났고, 아직 만료되지 않았어야 한다.
 * 60일간 갱신하지 않으면 만료되고 다시 살릴 수 없다 → 재인증 필요.
 */
export async function refreshLongLivedToken(
  longLivedToken: string,
): Promise<LongLivedToken> {
  const url = new URL('/refresh_access_token', GRAPH_HOST)
  url.searchParams.set('grant_type', 'th_refresh_token')
  url.searchParams.set('access_token', longLivedToken)
  return request<LongLivedToken>(url.toString())
}

export type ThreadsProfile = {
  id: string
  username?: string
  threads_profile_picture_url?: string
}

/** 연결된 계정이 누구인지 확인용. 실패해도 발행에는 영향 없음. */
export async function getProfile(
  accessToken: string,
): Promise<ThreadsProfile> {
  const url = new URL(`/${API_VERSION}/me`, GRAPH_HOST)
  url.searchParams.set('fields', 'id,username,threads_profile_picture_url')
  url.searchParams.set('access_token', accessToken)
  return request<ThreadsProfile>(url.toString())
}

/**
 * 텍스트 게시물 발행. Threads는 2단계다.
 *   ① 미디어 컨테이너 생성 → creation_id 받음
 *   ② 그 creation_id로 발행
 */
export async function publishTextPost(
  text: string,
  accessToken: string,
  knownUserId?: string,
): Promise<{ id: string }> {
  const trimmed = text.trim()
  if (!trimmed) {
    throw new ThreadsApiError('발행할 내용이 비어 있습니다.', 400, null)
  }

  // 발행 대상 사용자 ID는 반드시 /me 의 id 여야 한다.
  // 토큰 교환에서 받은 user_id를 쓰면 발행 엔드포인트가 "does not exist"로
  // 거부하는 경우가 있다. (/me 의 id 는 문자열이라 큰 숫자 정밀도 문제도 없다)
  //
  // DB에 저장된 값은 이미 /me 에서 받아둔 것이므로 그대로 쓰고,
  // 없을 때만 조회한다. 발행 1건당 API 호출을 하나 아낀다.
  const userId = knownUserId ?? (await getProfile(accessToken)).id

  // ① 컨테이너 생성
  const containerForm = new URLSearchParams({
    media_type: 'TEXT',
    text: trimmed,
    access_token: accessToken,
  })
  const container = await request<{ id: string }>(
    `${GRAPH_HOST}/${API_VERSION}/${encodeURIComponent(userId)}/threads`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: containerForm.toString(),
    },
  )

  if (!container?.id) {
    throw new ThreadsApiError(
      '컨테이너 생성 응답에 id가 없습니다.',
      500,
      container,
    )
  }

  // ② 발행
  const publishForm = new URLSearchParams({
    creation_id: container.id,
    access_token: accessToken,
  })
  return request<{ id: string }>(
    `${GRAPH_HOST}/${API_VERSION}/${encodeURIComponent(userId)}/threads_publish`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: publishForm.toString(),
    },
  )
}

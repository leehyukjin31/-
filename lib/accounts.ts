/**
 * 연결된 스레드 계정 저장소.
 *
 * 1단계에서는 토큰을 브라우저 쿠키에 넣었다. 쿠키로는 두 가지가 안 된다:
 *   - 계정을 여러 개 담을 수 없다 (대행 계정 7개가 목표다)
 *   - 브라우저가 꺼져 있으면 서버가 못 읽는다 → 예약 발행·자동 갱신 불가
 * 그래서 Supabase로 옮긴다.
 *
 * DB 컬럼은 snake_case, 코드는 camelCase 라서 이 파일에서 한 번만 변환한다.
 * 다른 파일은 DB 컬럼 이름을 몰라도 되게 하기 위함이다.
 */
import 'server-only'
import { getSupabase } from './supabase'

/** 장기 토큰 수명. Meta가 정한 값이라 우리가 바꿀 수 없다. */
export const TOKEN_LIFETIME_DAYS = 60

/**
 * 갱신을 며칠 전부터 시도할지.
 * 60일 중 마지막 10일을 여유로 둔다. 크론이 며칠 실패해도 만료 전에 복구된다.
 */
export const REFRESH_WINDOW_DAYS = 10

/**
 * Meta는 발급 후 24시간이 지나야 갱신을 받아준다.
 * 그 전에 호출하면 오류가 나므로 아예 대상에서 뺀다.
 */
export const MIN_AGE_HOURS_BEFORE_REFRESH = 24

/** 토큰을 포함한 전체 정보. 서버 안에서만 쓴다. */
export type ThreadsAccount = {
  id: string
  threadsUserId: string
  username: string | null
  label: string | null
  accessToken: string
  obtainedAt: string
  expiresAt: string
  lastRefreshAt: string | null
  lastRefreshError: string | null
  isActive: boolean
}

/** 화면에 넘길 정보. 토큰이 빠져 있다. */
export type AccountSummary = Omit<ThreadsAccount, 'accessToken'> & {
  daysLeft: number
}

type Row = {
  id: string
  threads_user_id: string
  username: string | null
  label: string | null
  access_token: string
  obtained_at: string
  expires_at: string
  last_refresh_at: string | null
  last_refresh_error: string | null
  is_active: boolean
}

function toAccount(row: Row): ThreadsAccount {
  return {
    id: row.id,
    threadsUserId: row.threads_user_id,
    username: row.username,
    label: row.label,
    accessToken: row.access_token,
    obtainedAt: row.obtained_at,
    expiresAt: row.expires_at,
    lastRefreshAt: row.last_refresh_at,
    lastRefreshError: row.last_refresh_error,
    isActive: row.is_active,
  }
}

/** 만료까지 남은 일수. 음수는 0으로 깎는다. */
export function daysUntil(expiresAt: string): number {
  const ms = new Date(expiresAt).getTime() - Date.now()
  return Math.max(0, Math.floor(ms / 86_400_000))
}

export function toSummary(account: ThreadsAccount): AccountSummary {
  const { accessToken: _omit, ...rest } = account
  void _omit
  return { ...rest, daysLeft: daysUntil(account.expiresAt) }
}

function expiryFrom(obtainedAt: Date): string {
  return new Date(
    obtainedAt.getTime() + TOKEN_LIFETIME_DAYS * 86_400_000,
  ).toISOString()
}

/**
 * 계정을 저장한다. 같은 계정을 다시 연결하면 새 줄을 만들지 않고 토큰만 갈아끼운다.
 * (threads_user_id 에 unique 제약이 걸려 있다)
 *
 * 다시 연결하면 is_active 도 true 로 되돌린다 — 껐던 계정을 재연결한 경우
 * 대표님 의도는 "다시 쓰겠다"이기 때문이다.
 */
export async function saveAccount(input: {
  threadsUserId: string
  username?: string | null
  accessToken: string
}): Promise<ThreadsAccount> {
  const now = new Date()

  const { data, error } = await getSupabase()
    .from('threads_accounts')
    .upsert(
      {
        threads_user_id: input.threadsUserId,
        username: input.username ?? null,
        access_token: input.accessToken,
        obtained_at: now.toISOString(),
        expires_at: expiryFrom(now),
        last_refresh_at: null,
        last_refresh_error: null,
        is_active: true,
      },
      { onConflict: 'threads_user_id' },
    )
    .select()
    .single()

  if (error) throw new Error(`계정 저장 실패: ${error.message}`)
  return toAccount(data as Row)
}

/** 운영 중인 계정 전체. 토큰이 들어 있으므로 서버 안에서만 쓸 것. */
export async function listAccounts(): Promise<ThreadsAccount[]> {
  const { data, error } = await getSupabase()
    .from('threads_accounts')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: true })

  if (error) throw new Error(`계정 목록 조회 실패: ${error.message}`)
  return (data as Row[]).map(toAccount)
}

/** 화면용 목록. 토큰이 빠져 있어 클라이언트로 넘겨도 안전하다. */
export async function listAccountSummaries(): Promise<AccountSummary[]> {
  return (await listAccounts()).map(toSummary)
}

export async function getAccountById(
  id: string,
): Promise<ThreadsAccount | null> {
  const { data, error } = await getSupabase()
    .from('threads_accounts')
    .select('*')
    .eq('id', id)
    .maybeSingle()

  if (error) throw new Error(`계정 조회 실패: ${error.message}`)
  return data ? toAccount(data as Row) : null
}

/**
 * 갱신이 필요한 계정을 고른다.
 *   - 운영 중이고
 *   - 만료까지 REFRESH_WINDOW_DAYS 이내로 남았고
 *   - 발급된 지 24시간이 지난 것
 */
export async function findAccountsNeedingRefresh(): Promise<ThreadsAccount[]> {
  const now = Date.now()
  const deadline = new Date(
    now + REFRESH_WINDOW_DAYS * 86_400_000,
  ).toISOString()
  const oldEnough = new Date(
    now - MIN_AGE_HOURS_BEFORE_REFRESH * 3_600_000,
  ).toISOString()

  const { data, error } = await getSupabase()
    .from('threads_accounts')
    .select('*')
    .eq('is_active', true)
    .lt('expires_at', deadline)
    .lt('obtained_at', oldEnough)

  if (error) throw new Error(`갱신 대상 조회 실패: ${error.message}`)
  return (data as Row[]).map(toAccount)
}

/** 갱신 성공. 새 토큰으로 바꾸고 만료 시각을 60일 뒤로 민다. */
export async function recordRefreshSuccess(
  id: string,
  accessToken: string,
): Promise<void> {
  const now = new Date()
  const { error } = await getSupabase()
    .from('threads_accounts')
    .update({
      access_token: accessToken,
      obtained_at: now.toISOString(),
      expires_at: expiryFrom(now),
      last_refresh_at: now.toISOString(),
      last_refresh_error: null,
    })
    .eq('id', id)

  if (error) throw new Error(`갱신 결과 저장 실패: ${error.message}`)
}

/**
 * 갱신 실패. 토큰은 그대로 두고 실패 사실만 남긴다.
 * 아직 만료 전이므로 다음 크론에서 다시 시도한다.
 */
export async function recordRefreshFailure(
  id: string,
  message: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('threads_accounts')
    .update({
      last_refresh_at: new Date().toISOString(),
      last_refresh_error: message.slice(0, 500),
    })
    .eq('id', id)

  if (error) throw new Error(`갱신 실패 기록 실패: ${error.message}`)
}

/** 계정을 끈다. 지우지 않는 이유는 지난 성과 기록을 남겨두기 위함이다. */
export async function deactivateAccount(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('threads_accounts')
    .update({ is_active: false })
    .eq('id', id)

  if (error) throw new Error(`계정 연결 해제 실패: ${error.message}`)
}

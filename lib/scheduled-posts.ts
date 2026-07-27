/**
 * 예약 발행 대기열.
 *
 * 5분마다 도는 크론이 "발행할 때가 된 글"을 집어서 스레드에 올린다.
 * (.github/workflows/publish-scheduled-posts.yml)
 *
 * 시간대 주의:
 *   DB에는 항상 UTC로 저장한다. 화면에 보여줄 때만 한국 시간으로 바꾼다.
 *   브라우저의 날짜 입력칸은 시간대 정보 없이 "2026-07-28T09:00" 같은 문자열을
 *   주기 때문에, 이를 한국 시간으로 해석해서 UTC로 바꾼다.
 *   대표님과 대상 고객이 모두 한국에 있으므로 서버·브라우저 위치와 무관하게
 *   항상 한국 시간 기준으로 동작해야 한다.
 */
import 'server-only'
import { getSupabase } from './supabase'
import type { ThreadsAccount } from './accounts'

/** 몇 번까지 다시 시도할지. 네트워크 오류 같은 일시적 실패를 넘기기 위함. */
export const MAX_ATTEMPTS = 3

/** 크론 한 번에 처리할 최대 건수. 함수 실행 시간 제한에 걸리지 않도록 둔다. */
export const BATCH_SIZE = 20

export type ScheduledPostStatus =
  | 'pending'
  | 'publishing'
  | 'published'
  | 'failed'
  | 'canceled'

export type ScheduledPost = {
  id: string
  accountId: string
  body: string
  scheduledAt: string
  status: ScheduledPostStatus
  publishedPostId: string | null
  errorMessage: string | null
  attempts: number
  createdAt: string
  /** 목록 화면에서 어느 계정인지 보여주기 위한 값. */
  accountUsername: string | null
}

type Row = {
  id: string
  account_id: string
  body: string
  scheduled_at: string
  status: ScheduledPostStatus
  published_post_id: string | null
  error_message: string | null
  attempts: number
  created_at: string
  account?: { username: string | null } | null
}

function toPost(row: Row): ScheduledPost {
  return {
    id: row.id,
    accountId: row.account_id,
    body: row.body,
    scheduledAt: row.scheduled_at,
    status: row.status,
    publishedPostId: row.published_post_id,
    errorMessage: row.error_message,
    attempts: row.attempts,
    createdAt: row.created_at,
    accountUsername: row.account?.username ?? null,
  }
}

const SELECT_WITH_ACCOUNT = '*, account:threads_accounts(username)'

// ── 시간대 변환 ────────────────────────────────────────────────

/**
 * 브라우저 날짜 입력칸 값("2026-07-28T09:00")을 한국 시간으로 읽어 UTC로 바꾼다.
 * 형식이 이상하면 null을 돌려준다 — 잘못된 시각으로 예약이 잡히면
 * 엉뚱한 때에 글이 올라가므로 저장 전에 걸러낸다.
 */
export function kstInputToUtc(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/.test(value)) return null
  const withSeconds = value.length === 16 ? `${value}:00` : value
  const date = new Date(`${withSeconds}+09:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

/** 화면 표시용. "7월 28일 (화) 오전 9:00" 처럼 보여준다. */
export function formatKst(iso: string): string {
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(iso))
}

/** 날짜 입력칸의 최솟값(지금). 과거 시각을 고르지 못하게 막는 용도. */
export function nowAsKstInputValue(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date())

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  // en-CA 는 24시 표기에서 자정을 "24"로 주는 경우가 있어 "00"으로 맞춘다.
  const hour = get('hour') === '24' ? '00' : get('hour')
  return `${get('year')}-${get('month')}-${get('day')}T${hour}:${get('minute')}`
}

// ── 조회·생성 ──────────────────────────────────────────────────

export async function createScheduledPost(input: {
  accountId: string
  body: string
  scheduledAtUtc: string
}): Promise<ScheduledPost> {
  const { data, error } = await getSupabase()
    .from('scheduled_posts')
    .insert({
      account_id: input.accountId,
      body: input.body,
      scheduled_at: input.scheduledAtUtc,
      status: 'pending',
    })
    .select(SELECT_WITH_ACCOUNT)
    .single()

  if (error) throw new Error(`예약 저장 실패: ${error.message}`)
  return toPost(data as Row)
}

/** 아직 안 올라간 글. 시간이 이른 순. */
export async function listPendingPosts(): Promise<ScheduledPost[]> {
  const { data, error } = await getSupabase()
    .from('scheduled_posts')
    .select(SELECT_WITH_ACCOUNT)
    .in('status', ['pending', 'publishing'])
    .order('scheduled_at', { ascending: true })
    .limit(50)

  if (error) throw new Error(`예약 목록 조회 실패: ${error.message}`)
  return (data as Row[]).map(toPost)
}

/** 이미 처리된 글. 최근 순. 발행 결과와 실패 사유를 확인하는 용도. */
export async function listFinishedPosts(): Promise<ScheduledPost[]> {
  const { data, error } = await getSupabase()
    .from('scheduled_posts')
    .select(SELECT_WITH_ACCOUNT)
    .in('status', ['published', 'failed', 'canceled'])
    .order('scheduled_at', { ascending: false })
    .limit(20)

  if (error) throw new Error(`발행 기록 조회 실패: ${error.message}`)
  return (data as Row[]).map(toPost)
}

/** 아직 안 올라간 글만 취소할 수 있다. 이미 올라간 글은 스레드 앱에서 지워야 한다. */
export async function cancelScheduledPost(id: string): Promise<void> {
  const { error } = await getSupabase()
    .from('scheduled_posts')
    .update({ status: 'canceled' })
    .eq('id', id)
    .eq('status', 'pending')

  if (error) throw new Error(`예약 취소 실패: ${error.message}`)
}

// ── 크론이 쓰는 함수들 ─────────────────────────────────────────

/** 발행 대상 한 건. 계정 정보(토큰 포함)가 붙어 있다. */
export type DuePost = {
  id: string
  body: string
  scheduledAt: string
  attempts: number
  account: Pick<
    ThreadsAccount,
    'id' | 'threadsUserId' | 'username' | 'accessToken' | 'isActive'
  >
}

type DueRow = {
  id: string
  body: string
  scheduled_at: string
  attempts: number
  account: {
    id: string
    threads_user_id: string
    username: string | null
    access_token: string
    is_active: boolean
  } | null
}

/**
 * 발행할 때가 된 글을 하나씩 "내가 집었다"고 표시하면서 가져온다.
 *
 * 크론이 겹쳐 돌아도 같은 글이 두 번 올라가면 안 된다. 그래서 단순히 조회하지 않고,
 * status가 pending인 줄만 publishing으로 바꾸는 조건부 수정을 쓴다.
 * 이미 다른 실행이 가져갔다면 바뀐 줄이 0개라 건너뛴다.
 */
export async function claimDuePosts(): Promise<DuePost[]> {
  const sb = getSupabase()

  const { data, error } = await sb
    .from('scheduled_posts')
    .select(
      'id, body, scheduled_at, attempts, account:threads_accounts(id, threads_user_id, username, access_token, is_active)',
    )
    .eq('status', 'pending')
    .lte('scheduled_at', new Date().toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(BATCH_SIZE)

  if (error) throw new Error(`발행 대상 조회 실패: ${error.message}`)

  const claimed: DuePost[] = []

  for (const row of data as unknown as DueRow[]) {
    const { data: locked, error: lockError } = await sb
      .from('scheduled_posts')
      .update({ status: 'publishing' })
      .eq('id', row.id)
      .eq('status', 'pending')
      .select('id')

    if (lockError) throw new Error(`발행 잠금 실패: ${lockError.message}`)
    if (!locked || locked.length === 0) continue // 다른 실행이 먼저 가져갔다

    if (!row.account) {
      await markFailed(row.id, '계정을 찾을 수 없습니다. 연결이 해제된 것 같습니다.')
      continue
    }
    if (!row.account.is_active) {
      await markFailed(row.id, '연결이 해제된 계정입니다.')
      continue
    }

    claimed.push({
      id: row.id,
      body: row.body,
      scheduledAt: row.scheduled_at,
      attempts: row.attempts,
      account: {
        id: row.account.id,
        threadsUserId: row.account.threads_user_id,
        username: row.account.username,
        accessToken: row.account.access_token,
        isActive: row.account.is_active,
      },
    })
  }

  return claimed
}

export async function markPublished(
  id: string,
  publishedPostId: string,
): Promise<void> {
  const { error } = await getSupabase()
    .from('scheduled_posts')
    .update({
      status: 'published',
      published_post_id: publishedPostId,
      error_message: null,
    })
    .eq('id', id)

  if (error) throw new Error(`발행 결과 저장 실패: ${error.message}`)
}

async function markFailed(id: string, message: string): Promise<void> {
  const { error } = await getSupabase()
    .from('scheduled_posts')
    .update({ status: 'failed', error_message: message.slice(0, 500) })
    .eq('id', id)

  if (error) throw new Error(`실패 기록 저장 실패: ${error.message}`)
}

/**
 * 발행에 실패했을 때.
 * 아직 시도 횟수가 남았으면 pending으로 되돌려 다음 크론에서 다시 시도하고,
 * 다 썼으면 failed로 확정한다.
 */
export async function markAttemptFailed(
  post: DuePost,
  message: string,
): Promise<{ willRetry: boolean }> {
  const attempts = post.attempts + 1
  const willRetry = attempts < MAX_ATTEMPTS

  const { error } = await getSupabase()
    .from('scheduled_posts')
    .update({
      status: willRetry ? 'pending' : 'failed',
      attempts,
      error_message: message.slice(0, 500),
    })
    .eq('id', post.id)

  if (error) throw new Error(`재시도 기록 실패: ${error.message}`)
  return { willRetry }
}

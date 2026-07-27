import { listAccountSummaries, type AccountSummary } from '@/lib/accounts'
import {
  formatKst,
  listFinishedPosts,
  listPendingPosts,
  nowAsKstInputValue,
  type ScheduledPost,
} from '@/lib/scheduled-posts'
import { missingSupabaseEnv } from '@/lib/supabase'
import { THREADS_SCOPES } from '@/lib/threads'
import {
  cancelScheduleAction,
  disconnectAction,
  publishAction,
  scheduleAction,
} from './actions'

// Next.js 15+ 부터 searchParams는 Promise다. await 해서 써야 한다.
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** 토큰 만료가 임박했는지. 갱신 크론이 도는 구간과 같은 기준. */
function isExpiringSoon(days: number): boolean {
  return days <= 10
}

const STATUS_LABEL: Record<ScheduledPost['status'], string> = {
  pending: '대기 중',
  publishing: '발행 중',
  published: '발행됨',
  failed: '실패',
  canceled: '취소됨',
}

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams
  const error = one(sp.error)
  const published = one(sp.published)
  const connected = one(sp.connected)
  const scheduled = one(sp.scheduled)

  // 설정이 채워졌는지만 확인한다. 값 자체(특히 Secret)는 화면에 절대 출력하지 않는다.
  const missingThreadsEnv = (
    ['THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_REDIRECT_URI'] as const
  ).filter((k) => !process.env[k])
  const missingDbEnv = missingSupabaseEnv()
  const ready = missingThreadsEnv.length === 0 && missingDbEnv.length === 0

  let accounts: AccountSummary[] = []
  let pending: ScheduledPost[] = []
  let finished: ScheduledPost[] = []
  let loadError: string | null = null

  if (missingDbEnv.length === 0) {
    try {
      ;[accounts, pending, finished] = await Promise.all([
        listAccountSummaries(),
        listPendingPosts(),
        listFinishedPosts(),
      ])
    } catch (e) {
      loadError = e instanceof Error ? e.message : '데이터를 읽지 못했습니다.'
    }
  }

  const minDateTime = nowAsKstInputValue()

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 font-sans">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">스레드 자동화</h1>
        <p className="text-sm text-neutral-500">
          계정 연결 · 예약 발행 · 토큰 자동 갱신. 모든 시각은 한국 시간
          기준입니다.
        </p>
      </header>

      {/* ── 알림 ───────────────────────────────────────── */}
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-semibold">문제가 발생했습니다</div>
          <p className="mt-1 break-words whitespace-pre-wrap">{error}</p>
        </div>
      )}

      {connected && !error && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <span className="font-semibold">{connected}</span> 계정이 연결됐습니다.
        </div>
      )}

      {scheduled && !error && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <div className="font-semibold">예약 완료</div>
          <p className="mt-1">{scheduled} 에 자동으로 발행됩니다.</p>
        </div>
      )}

      {published && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <div className="font-semibold">발행 성공</div>
          <p className="mt-1">
            게시물 ID:{' '}
            <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
              {published}
            </code>
          </p>
        </div>
      )}

      {loadError && (
        <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-semibold">데이터베이스를 읽지 못했습니다</div>
          <p className="mt-1 break-words whitespace-pre-wrap">{loadError}</p>
          <p className="mt-2 text-xs">
            Supabase에서 <code>supabase/schema.sql</code> 을 실행했는지, 환경변수
            값이 맞는지 확인해주세요.
          </p>
        </div>
      )}

      {/* ── 1. 설정 상태 ───────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          1. 환경변수
        </h2>

        {ready ? (
          <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="font-medium text-green-700 dark:text-green-400">
              ✓ Threads 3개 · 데이터베이스 2개 모두 설정됨
            </p>
            <p className="mt-2 text-neutral-500">
              Meta 앱에 등록해야 할 Redirect URI:
            </p>
            <code className="mt-1 block rounded bg-neutral-100 p-2 font-mono text-xs break-all dark:bg-neutral-900">
              {process.env.THREADS_REDIRECT_URI}
            </code>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-medium">아직 비어 있는 값이 있습니다</p>
            <ul className="mt-2 list-inside list-disc font-mono text-xs">
              {[...missingThreadsEnv, ...missingDbEnv].map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              Vercel의 <strong>Settings → Environment Variables</strong> 에 넣고
              다시 배포(Redeploy)해주세요.
            </p>
          </div>
        )}
      </section>

      {/* ── 2. 계정 ────────────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          2. 계정 {accounts.length > 0 && `(${accounts.length}개)`}
        </h2>

        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <article
              key={account.id}
              className="flex flex-col gap-4 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-medium">
                  {account.username ? `@${account.username}` : '(이름 없음)'}
                </h3>
                <span
                  className={
                    isExpiringSoon(account.daysLeft)
                      ? 'text-xs font-medium text-amber-700 dark:text-amber-500'
                      : 'text-xs text-neutral-500'
                  }
                >
                  토큰 {account.daysLeft}일 남음
                  {isExpiringSoon(account.daysLeft) && ' · 곧 자동 갱신됩니다'}
                </span>
              </div>

              {account.lastRefreshError && (
                <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  마지막 갱신 시도 실패: {account.lastRefreshError}
                </p>
              )}

              {/* 예약 발행 */}
              <form action={scheduleAction} className="flex flex-col gap-2">
                <input type="hidden" name="accountId" value={account.id} />
                <label className="text-xs font-medium text-neutral-500">
                  예약 발행
                </label>
                <textarea
                  name="text"
                  required
                  rows={3}
                  maxLength={500}
                  placeholder="올릴 내용을 쓰세요. (최대 500자)"
                  className="w-full resize-y rounded-md border border-neutral-300 bg-transparent p-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
                />
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="datetime-local"
                    name="scheduledAt"
                    required
                    min={minDateTime}
                    className="rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
                  />
                  <button
                    type="submit"
                    className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                  >
                    예약하기
                  </button>
                </div>
              </form>

              {/* 즉시 발행 */}
              <details className="text-sm">
                <summary className="cursor-pointer text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-neutral-200">
                  지금 바로 올리기 / 연결 끊기
                </summary>

                <form
                  action={publishAction}
                  className="mt-3 flex flex-col gap-2"
                >
                  <input type="hidden" name="accountId" value={account.id} />
                  <textarea
                    name="text"
                    required
                    rows={2}
                    maxLength={500}
                    placeholder="즉시 발행할 내용"
                    className="w-full resize-y rounded-md border border-neutral-300 bg-transparent p-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
                  />
                  <div className="flex flex-wrap items-center gap-3">
                    <button
                      type="submit"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      실제로 발행하기
                    </button>
                    <span className="text-xs text-amber-700 dark:text-amber-500">
                      누르면 즉시 올라갑니다
                    </span>
                  </div>
                </form>

                <form action={disconnectAction} className="mt-3">
                  <input type="hidden" name="accountId" value={account.id} />
                  <button
                    type="submit"
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-neutral-700 dark:text-red-400 dark:hover:bg-red-950/40"
                  >
                    연결 끊기
                  </button>
                </form>
              </details>
            </article>
          ))}

          <div className="rounded-lg border border-dashed border-neutral-300 p-4 text-sm dark:border-neutral-700">
            {accounts.length === 0 && !loadError && (
              <p className="mb-3 text-neutral-500">
                아직 연결된 계정이 없습니다.
              </p>
            )}

            {ready ? (
              <a
                href="/api/threads/auth"
                className="inline-block rounded-md bg-black px-4 py-2 font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              >
                {accounts.length === 0
                  ? '스레드 계정 연결하기'
                  : '계정 더 연결하기'}
              </a>
            ) : (
              <p className="inline-block cursor-not-allowed rounded-md bg-neutral-200 px-4 py-2 font-medium text-neutral-500 dark:bg-neutral-800">
                스레드 계정 연결하기 (환경변수 먼저)
              </p>
            )}

            <p className="mt-3 text-xs text-neutral-500">
              계정을 추가할 때는 <strong>스레드에서 먼저 로그아웃</strong>한 뒤
              연결해야 다른 계정으로 인증할 수 있습니다.
              <br />
              요청 권한 {THREADS_SCOPES.length}개:{' '}
              <span className="font-mono">{THREADS_SCOPES.join(', ')}</span>
            </p>
          </div>
        </div>
      </section>

      {/* ── 3. 예약 목록 ───────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          3. 발행 대기 {pending.length > 0 && `(${pending.length}건)`}
        </h2>

        {pending.length === 0 ? (
          <p className="rounded-lg border border-neutral-200 p-4 text-sm text-neutral-500 dark:border-neutral-800">
            예약된 글이 없습니다. 위에서 시각을 정해 예약해보세요.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {pending.map((post) => (
              <li
                key={post.id}
                className="flex flex-col gap-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {formatKst(post.scheduledAt)}
                  </span>
                  <span className="text-xs text-neutral-500">
                    {post.accountUsername ? `@${post.accountUsername}` : ''}
                    {post.status === 'publishing' && ' · 발행 중'}
                    {post.attempts > 0 && ` · ${post.attempts}회 재시도`}
                  </span>
                </div>

                <p className="whitespace-pre-wrap text-neutral-700 dark:text-neutral-300">
                  {post.body}
                </p>

                {post.errorMessage && (
                  <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                    지난 시도 실패: {post.errorMessage} · 곧 다시 시도합니다
                  </p>
                )}

                {post.status === 'pending' && (
                  <form action={cancelScheduleAction}>
                    <input type="hidden" name="postId" value={post.id} />
                    <button
                      type="submit"
                      className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                    >
                      예약 취소
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── 4. 발행 기록 ───────────────────────────────── */}
      {finished.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
            4. 최근 기록
          </h2>
          <ul className="flex flex-col gap-2">
            {finished.map((post) => (
              <li
                key={post.id}
                className="flex flex-col gap-1 rounded-lg border border-neutral-200 p-3 text-sm dark:border-neutral-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-xs text-neutral-500">
                    {formatKst(post.scheduledAt)}
                    {post.accountUsername && ` · @${post.accountUsername}`}
                  </span>
                  <span
                    className={
                      post.status === 'published'
                        ? 'text-xs font-medium text-green-700 dark:text-green-400'
                        : post.status === 'failed'
                          ? 'text-xs font-medium text-red-700 dark:text-red-400'
                          : 'text-xs text-neutral-500'
                    }
                  >
                    {STATUS_LABEL[post.status]}
                  </span>
                </div>
                <p className="line-clamp-2 text-neutral-700 dark:text-neutral-300">
                  {post.body}
                </p>
                {post.errorMessage && post.status === 'failed' && (
                  <p className="text-xs text-red-700 dark:text-red-400">
                    {post.errorMessage}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ── 5. 자동화 상태 ─────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          5. 자동으로 도는 것
        </h2>
        <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            <dt className="text-neutral-500">예약 발행</dt>
            <dd>5분마다 확인 후 발행</dd>
            <dt className="text-neutral-500">토큰 갱신</dt>
            <dd>매일 새벽 3시, 만료 10일 전부터</dd>
          </dl>
          <p className="mt-3 text-xs text-neutral-500">
            GitHub Actions가 실행합니다. 예약 시각보다 몇 분 늦게 올라갈 수
            있습니다.
          </p>
        </div>
      </section>

      <p className="border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        다음 단계: 성과 수집 · 댓글 답글 검수 · 경쟁 계정 분석.
      </p>
    </main>
  )
}

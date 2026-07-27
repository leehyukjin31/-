import { listAccountSummaries, type AccountSummary } from '@/lib/accounts'
import { missingSupabaseEnv } from '@/lib/supabase'
import { THREADS_SCOPES } from '@/lib/threads'
import { disconnectAction, publishAction } from './actions'

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

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams
  const error = one(sp.error)
  const published = one(sp.published)
  const connected = one(sp.connected)

  // 설정이 채워졌는지만 확인한다. 값 자체(특히 Secret)는 화면에 절대 출력하지 않는다.
  const missingThreadsEnv = (
    ['THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_REDIRECT_URI'] as const
  ).filter((k) => !process.env[k])
  const missingDbEnv = missingSupabaseEnv()
  const ready = missingThreadsEnv.length === 0 && missingDbEnv.length === 0

  let accounts: AccountSummary[] = []
  let loadError: string | null = null

  if (missingDbEnv.length === 0) {
    try {
      accounts = await listAccountSummaries()
    } catch (e) {
      loadError = e instanceof Error ? e.message : '계정 목록을 읽지 못했습니다.'
    }
  }

  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-12 font-sans">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-bold tracking-tight">
          스레드 자동화 · 2단계
        </h1>
        <p className="text-sm text-neutral-500">
          계정을 데이터베이스에 저장합니다. 이제 브라우저를 꺼도 서버가 혼자
          토큰을 갱신하고 예약 발행을 할 수 있습니다.
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

      {published && (
        <div className="rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          <div className="font-semibold">발행 성공</div>
          <p className="mt-1">
            게시물 ID:{' '}
            <code className="rounded bg-black/10 px-1 py-0.5 font-mono text-xs dark:bg-white/10">
              {published}
            </code>
          </p>
          <p className="mt-1">스레드 앱에서 실제로 올라갔는지 확인해보세요.</p>
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
            <p className="mt-2 text-xs text-neutral-500">
              위 주소가 Meta 앱 설정의 Redirect Callback URL과{' '}
              <strong>한 글자도 다르지 않아야</strong> 합니다. 끝의 슬래시(/) 하나
              차이로도 실패합니다.
            </p>
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
              다시 배포(Redeploy)해주세요. 로컬에서 실행 중이라면{' '}
              <code>.env.local</code> 파일입니다.
            </p>
          </div>
        )}
      </section>

      {/* ── 2. 연결된 계정 ─────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          2. 연결된 계정 {accounts.length > 0 && `(${accounts.length}개)`}
        </h2>

        {loadError && (
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
            <div className="font-semibold">데이터베이스를 읽지 못했습니다</div>
            <p className="mt-1 break-words whitespace-pre-wrap">{loadError}</p>
            <p className="mt-2 text-xs">
              Supabase에서 <code>supabase/schema.sql</code> 을 실행했는지, 그리고
              환경변수 값이 맞는지 확인해주세요.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-3">
          {accounts.map((account) => (
            <article
              key={account.id}
              className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800"
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

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-neutral-500">
                <dt>사용자 ID</dt>
                <dd className="font-mono break-all">{account.threadsUserId}</dd>
              </dl>

              {account.lastRefreshError && (
                <p className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
                  마지막 갱신 시도 실패: {account.lastRefreshError}
                </p>
              )}

              {/* 테스트 발행 */}
              <form action={publishAction} className="flex flex-col gap-2">
                <input type="hidden" name="accountId" value={account.id} />
                <textarea
                  name="text"
                  required
                  rows={3}
                  maxLength={500}
                  placeholder="테스트 게시물입니다."
                  className="w-full resize-y rounded-md border border-neutral-300 bg-transparent p-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
                />
                <div className="flex flex-wrap items-center gap-3">
                  <button
                    type="submit"
                    className="rounded-md bg-black px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
                  >
                    실제로 발행하기
                  </button>
                  <span className="text-xs text-amber-700 dark:text-amber-500">
                    누르면 실제 스레드에 즉시 올라갑니다
                  </span>
                </div>
              </form>

              <form action={disconnectAction}>
                <input type="hidden" name="accountId" value={account.id} />
                <button
                  type="submit"
                  className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
                >
                  연결 끊기
                </button>
              </form>
            </article>
          ))}

          {/* 계정 추가 */}
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

      {/* ── 3. 자동 갱신 ───────────────────────────────── */}
      <section className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-neutral-500 uppercase">
          3. 토큰 자동 갱신
        </h2>
        <div className="rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
          <p>
            매일 새벽 3시에 GitHub Actions가 만료 임박한 토큰을 자동으로
            갱신합니다.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            장기 토큰은 60일짜리이고 <strong>만료되면 되살릴 수 없습니다.</strong>{' '}
            한 번 놓치면 계정을 전부 손으로 다시 인증해야 하므로, 만료 10일
            전부터 미리 갱신합니다.
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            GitHub 저장소의 <strong>Settings → Secrets and variables →
            Actions</strong> 에 <code>APP_URL</code> 과 <code>CRON_SECRET</code>{' '}
            두 개를 넣어야 동작합니다.
          </p>
        </div>
      </section>

      <p className="border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        다음 단계: 예약 발행 · 성과 수집 · 댓글 답글 검수.
      </p>
    </main>
  )
}

import { getConnection } from '@/lib/session'
import { THREADS_SCOPES } from '@/lib/threads'
import { disconnectAction, publishAction } from './actions'

// Next.js 15+ 부터 searchParams는 Promise다. await 해서 써야 한다.
type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

function one(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v
}

/** 만료까지 남은 일수. 장기 토큰은 발급/갱신 후 60일. */
function daysLeft(obtainedAt: string): number {
  const elapsed = Date.now() - new Date(obtainedAt).getTime()
  return Math.max(0, 60 - Math.floor(elapsed / 86_400_000))
}

export default async function Home({ searchParams }: PageProps) {
  const sp = await searchParams
  const error = one(sp.error)
  const published = one(sp.published)
  const justConnected = one(sp.connected) === '1'

  const connection = await getConnection()

  // 설정이 채워졌는지만 확인한다. 값 자체(특히 Secret)는 화면에 절대 출력하지 않는다.
  const missingEnv = (
    ['THREADS_APP_ID', 'THREADS_APP_SECRET', 'THREADS_REDIRECT_URI'] as const
  ).filter((k) => !process.env[k])
  const redirectUri = process.env.THREADS_REDIRECT_URI

  return (
    <main className="mx-auto max-w-2xl px-6 py-12 font-sans">
      <h1 className="text-2xl font-bold tracking-tight">스레드 자동화 · 1단계</h1>
      <p className="mt-2 text-sm text-neutral-500">
        계정 연결과 테스트 발행까지 확인하는 단계입니다.
      </p>

      {/* ── 알림 ───────────────────────────────────────── */}
      {error && (
        <div className="mt-6 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">
          <div className="font-semibold">문제가 발생했습니다</div>
          <p className="mt-1 whitespace-pre-wrap break-words">{error}</p>
        </div>
      )}

      {justConnected && !error && (
        <div className="mt-6 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
          계정이 연결됐습니다. 아래에서 테스트 발행을 해보세요.
        </div>
      )}

      {published && (
        <div className="mt-6 rounded-lg border border-green-300 bg-green-50 p-4 text-sm text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">
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
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          1. 환경변수
        </h2>
        {missingEnv.length === 0 ? (
          <div className="mt-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="font-medium text-green-700 dark:text-green-400">
              ✓ 3개 모두 설정됨
            </p>
            <p className="mt-2 text-neutral-500">
              Meta 앱에 등록해야 할 Redirect URI:
            </p>
            <code className="mt-1 block break-all rounded bg-neutral-100 p-2 font-mono text-xs dark:bg-neutral-900">
              {redirectUri}
            </code>
            <p className="mt-2 text-xs text-neutral-500">
              위 주소가 Meta 앱 설정의 Redirect Callback URL과{' '}
              <strong>한 글자도 다르지 않아야</strong> 합니다. 끝의 슬래시(/) 하나
              차이로도 실패합니다.
            </p>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm dark:border-amber-800 dark:bg-amber-950/40">
            <p className="font-medium">아직 비어 있는 값이 있습니다</p>
            <ul className="mt-2 list-inside list-disc font-mono text-xs">
              {missingEnv.map((k) => (
                <li key={k}>{k}</li>
              ))}
            </ul>
            <p className="mt-2 text-xs">
              프로젝트 폴더의 <code>.env.local</code> 파일에 채워주세요.{' '}
              <code>.env.local.example</code>을 복사해서 쓰시면 됩니다. 저장 후
              개발 서버를 껐다 켜야 반영됩니다.
            </p>
          </div>
        )}
      </section>

      {/* ── 2. 계정 연결 ───────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          2. 스레드 계정 연결
        </h2>

        {connection ? (
          <div className="mt-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="font-medium text-green-700 dark:text-green-400">
              ✓ 연결됨{connection.username ? ` · @${connection.username}` : ''}
            </p>
            <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-neutral-500">
              <dt>사용자 ID</dt>
              <dd className="break-all font-mono">{connection.userId}</dd>
              <dt>토큰 만료</dt>
              <dd>{daysLeft(connection.obtainedAt)}일 남음</dd>
            </dl>
            <form action={disconnectAction} className="mt-4">
              <button
                type="submit"
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-xs font-medium hover:bg-neutral-100 dark:border-neutral-700 dark:hover:bg-neutral-800"
              >
                연결 끊기
              </button>
            </form>
          </div>
        ) : (
          <div className="mt-2 rounded-lg border border-neutral-200 p-4 text-sm dark:border-neutral-800">
            <p className="text-neutral-500">아직 연결된 계정이 없습니다.</p>
            {missingEnv.length > 0 ? (
              <p className="mt-3 inline-block cursor-not-allowed rounded-md bg-neutral-200 px-4 py-2 font-medium text-neutral-500 dark:bg-neutral-800">
                스레드 계정 연결하기 (환경변수 먼저)
              </p>
            ) : (
              <a
                href="/api/threads/auth"
                className="mt-3 inline-block rounded-md bg-black px-4 py-2 font-medium text-white hover:bg-neutral-800 dark:bg-white dark:text-black dark:hover:bg-neutral-200"
              >
                스레드 계정 연결하기
              </a>
            )}
            <p className="mt-3 text-xs text-neutral-500">
              요청할 권한 {THREADS_SCOPES.length}개:{' '}
              <span className="font-mono">{THREADS_SCOPES.join(', ')}</span>
              <br />
              나중에 댓글·인사이트 기능을 붙일 때 다시 인증하지 않도록 처음부터
              함께 받습니다.
            </p>
          </div>
        )}
      </section>

      {/* ── 3. 테스트 발행 ─────────────────────────────── */}
      <section className="mt-8">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          3. 테스트 발행
        </h2>
        <div className="mt-2 rounded-lg border border-neutral-200 p-4 dark:border-neutral-800">
          {connection ? (
            <form action={publishAction}>
              <textarea
                name="text"
                required
                rows={4}
                maxLength={500}
                placeholder="테스트 게시물입니다."
                className="w-full resize-y rounded-md border border-neutral-300 bg-transparent p-3 text-sm outline-none focus:border-neutral-900 dark:border-neutral-700 dark:focus:border-neutral-300"
              />
              <div className="mt-3 flex flex-wrap items-center gap-3">
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
          ) : (
            <p className="text-sm text-neutral-500">
              계정을 먼저 연결하면 이 자리에 발행 폼이 나타납니다.
            </p>
          )}
        </div>
      </section>

      <p className="mt-10 border-t border-neutral-200 pt-4 text-xs text-neutral-400 dark:border-neutral-800">
        이 화면은 1단계 검증용입니다. 이후 예약 발행 · 댓글 답글 검수 · 7계정
        대시보드로 확장합니다.
      </p>
    </main>
  )
}

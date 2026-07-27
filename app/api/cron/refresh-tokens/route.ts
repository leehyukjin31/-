/**
 * 스레드 장기 토큰 자동 갱신.
 *
 * ⚠️ 이 프로젝트에서 가장 중요한 자동화다.
 *    장기 토큰은 60일짜리이고, 만료되면 되살릴 수 없다.
 *    한 번 놓치면 계정 7개를 전부 손으로 다시 인증해야 한다.
 *
 * 하루 한 번 GitHub Actions가 이 주소를 호출한다
 * (.github/workflows/refresh-threads-tokens.yml).
 * 만료 10일 전부터 시도하므로, 크론이 며칠 실패해도 만료 전에 복구된다.
 *
 * Vercel 무료(Hobby) 플랜은 크론이 하루 1회로 제한되고 실행 시각도 부정확해서
 * GitHub Actions를 쓴다. 월 0원이고 분 단위 스케줄이 가능하다.
 */
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import {
  findAccountsNeedingRefresh,
  recordRefreshFailure,
  recordRefreshSuccess,
  REFRESH_WINDOW_DAYS,
  daysUntil,
} from '@/lib/accounts'
import { refreshLongLivedToken } from '@/lib/threads'
import { ConfigError } from '@/lib/supabase'

/** 길이가 달라도 정보가 새지 않게 비교한다. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '알 수 없는 오류'
}

export async function GET(request: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (!expected) {
    return Response.json(
      {
        ok: false,
        error:
          'CRON_SECRET 환경변수가 비어 있습니다. Vercel의 Environment Variables 에 넣어주세요.',
      },
      { status: 500 },
    )
  }

  // GitHub Actions가 Authorization 헤더에 담아 보낸다.
  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!secretMatches(provided, expected)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let targets: Awaited<ReturnType<typeof findAccountsNeedingRefresh>>
  try {
    targets = await findAccountsNeedingRefresh()
  } catch (error) {
    const status = error instanceof ConfigError ? 500 : 502
    return Response.json(
      { ok: false, error: errorMessage(error) },
      { status },
    )
  }

  const results: Array<{
    account: string
    ok: boolean
    daysLeftBefore: number
    error?: string
  }> = []

  for (const account of targets) {
    const label = account.username ?? account.threadsUserId
    const daysLeftBefore = daysUntil(account.expiresAt)

    try {
      const refreshed = await refreshLongLivedToken(account.accessToken)
      await recordRefreshSuccess(account.id, refreshed.access_token)
      results.push({ account: label, ok: true, daysLeftBefore })
    } catch (error) {
      const message = errorMessage(error)
      // 기록 자체가 실패해도 나머지 계정 갱신은 계속한다.
      try {
        await recordRefreshFailure(account.id, message)
      } catch {
        // 무시: 아래 응답에 실패 사실이 이미 담긴다.
      }
      results.push({
        account: label,
        ok: false,
        daysLeftBefore,
        error: message,
      })
    }
  }

  const failed = results.filter((r) => !r.ok)

  return Response.json(
    {
      ok: failed.length === 0,
      checkedAt: new Date().toISOString(),
      windowDays: REFRESH_WINDOW_DAYS,
      // 갱신 대상이 0개인 것은 정상이다. 만료가 아직 멀었다는 뜻이다.
      refreshed: results.filter((r) => r.ok).length,
      failed: failed.length,
      results,
    },
    // 실패가 있으면 GitHub Actions가 빨간불로 알려주도록 5xx를 낸다.
    { status: failed.length === 0 ? 200 : 502 },
  )
}

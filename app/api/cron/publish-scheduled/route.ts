/**
 * 예약된 글을 발행한다.
 *
 * 5분마다 GitHub Actions가 이 주소를 호출한다
 * (.github/workflows/publish-scheduled-posts.yml).
 *
 * 같은 글이 두 번 올라가는 것이 가장 나쁜 실패다. 대행 계정에 중복 글이 올라가면
 * 대표님이 손으로 지워야 하고 병원 쪽 신뢰도 깎인다.
 * 그래서 claimDuePosts()가 조건부 수정으로 한 번에 하나만 집어가도록 했다.
 */
import { timingSafeEqual } from 'node:crypto'
import type { NextRequest } from 'next/server'
import {
  claimDuePosts,
  markAttemptFailed,
  markPublished,
  MAX_ATTEMPTS,
} from '@/lib/scheduled-posts'
import { publishTextPost } from '@/lib/threads'
import { ConfigError } from '@/lib/supabase'

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

  const header = request.headers.get('authorization') ?? ''
  const provided = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!secretMatches(provided, expected)) {
    return Response.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  }

  let due: Awaited<ReturnType<typeof claimDuePosts>>
  try {
    due = await claimDuePosts()
  } catch (error) {
    const status = error instanceof ConfigError ? 500 : 502
    return Response.json({ ok: false, error: errorMessage(error) }, { status })
  }

  const results: Array<{
    account: string
    scheduledAt: string
    ok: boolean
    postId?: string
    error?: string
    willRetry?: boolean
  }> = []

  for (const post of due) {
    const label = post.account.username ?? post.account.threadsUserId

    try {
      const published = await publishTextPost(
        post.body,
        post.account.accessToken,
        post.account.threadsUserId,
      )
      await markPublished(post.id, published.id)
      results.push({
        account: label,
        scheduledAt: post.scheduledAt,
        ok: true,
        postId: published.id,
      })
    } catch (error) {
      const message = errorMessage(error)
      let willRetry = false
      try {
        ;({ willRetry } = await markAttemptFailed(post, message))
      } catch {
        // 기록에 실패해도 나머지 글은 계속 처리한다.
      }
      results.push({
        account: label,
        scheduledAt: post.scheduledAt,
        ok: false,
        error: message,
        willRetry,
      })
    }
  }

  // 재시도가 남은 실패는 아직 진짜 실패가 아니다. 빨간불을 띄우지 않는다.
  const givenUp = results.filter((r) => !r.ok && !r.willRetry)

  return Response.json(
    {
      ok: givenUp.length === 0,
      ranAt: new Date().toISOString(),
      maxAttempts: MAX_ATTEMPTS,
      // 0건은 정상이다. 지금 올릴 때가 된 글이 없다는 뜻이다.
      claimed: due.length,
      published: results.filter((r) => r.ok).length,
      results,
    },
    { status: givenUp.length === 0 ? 200 : 502 },
  )
}

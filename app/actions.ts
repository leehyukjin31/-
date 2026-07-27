'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { deactivateAccount, getAccountById } from '@/lib/accounts'
import {
  cancelScheduledPost,
  createScheduledPost,
  formatKst,
  kstInputToUtc,
} from '@/lib/scheduled-posts'
import { publishTextPost, ThreadsApiError } from '@/lib/threads'
import { ConfigError } from '@/lib/supabase'

function errorMessage(error: unknown): string {
  if (
    error instanceof ThreadsApiError ||
    error instanceof ConfigError ||
    error instanceof Error
  ) {
    return error.message
  }
  return '알 수 없는 오류'
}

/**
 * 테스트 발행.
 *
 * 주의: Server Action은 UI를 거치지 않고 직접 POST로도 호출될 수 있다.
 * 그래서 함수 안에서 매번 계정을 다시 조회하고 상태를 확인한다.
 */
export async function publishAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '')
  const text = String(formData.get('text') ?? '')

  let postId: string

  try {
    const account = await getAccountById(accountId)

    if (!account || !account.isActive) {
      redirect(
        '/?error=' + encodeURIComponent('연결된 계정을 찾을 수 없습니다.'),
      )
    }

    const result = await publishTextPost(
      text,
      account.accessToken,
      account.threadsUserId,
    )
    postId = result.id
  } catch (error) {
    // redirect()는 내부적으로 예외를 던져서 동작한다. 여기서 삼키면 안 된다.
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
    redirect('/?error=' + encodeURIComponent(`발행 실패: ${errorMessage(error)}`))
  }

  revalidatePath('/')
  redirect('/?published=' + encodeURIComponent(postId))
}

/**
 * 예약 발행 등록.
 *
 * 시각은 항상 한국 시간으로 해석한다. 대표님과 대상 고객이 모두 한국에 있고,
 * 서버(Vercel)는 UTC로 돌기 때문에 여기서 한 번 확실히 변환해둔다.
 */
export async function scheduleAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '')
  const body = String(formData.get('text') ?? '').trim()
  const when = String(formData.get('scheduledAt') ?? '')

  let confirmation: string

  try {
    if (!body) {
      redirect('/?error=' + encodeURIComponent('예약할 내용이 비어 있습니다.'))
    }

    const scheduledAtUtc = kstInputToUtc(when)
    if (!scheduledAtUtc) {
      redirect(
        '/?error=' +
          encodeURIComponent('발행 시각을 다시 선택해주세요. (날짜와 시간 모두)'),
      )
    }

    // 이미 지난 시각이면 크론이 다음 실행 때 바로 올려버린다.
    // 실수로 과거를 고른 것과 구분되지 않으므로 미리 막는다.
    // 1분의 여유는 폼을 채우는 동안 흐른 시간을 감안한 것이다.
    if (new Date(scheduledAtUtc).getTime() < Date.now() - 60_000) {
      redirect(
        '/?error=' +
          encodeURIComponent('지난 시각으로는 예약할 수 없습니다. 앞으로의 시각을 골라주세요.'),
      )
    }

    const account = await getAccountById(accountId)
    if (!account || !account.isActive) {
      redirect(
        '/?error=' + encodeURIComponent('연결된 계정을 찾을 수 없습니다.'),
      )
    }

    await createScheduledPost({ accountId, body, scheduledAtUtc })
    confirmation = formatKst(scheduledAtUtc)
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
    redirect('/?error=' + encodeURIComponent(`예약 실패: ${errorMessage(error)}`))
  }

  revalidatePath('/')
  redirect('/?scheduled=' + encodeURIComponent(confirmation))
}

/** 아직 안 올라간 예약을 취소한다. 이미 올라간 글은 스레드 앱에서 지워야 한다. */
export async function cancelScheduleAction(formData: FormData): Promise<void> {
  const postId = String(formData.get('postId') ?? '')

  try {
    await cancelScheduledPost(postId)
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
    redirect(
      '/?error=' + encodeURIComponent(`예약 취소 실패: ${errorMessage(error)}`),
    )
  }

  revalidatePath('/')
  redirect('/')
}

/** 계정을 목록에서 내린다. 지우지 않고 꺼두므로 지난 성과 기록은 남는다. */
export async function disconnectAction(formData: FormData): Promise<void> {
  const accountId = String(formData.get('accountId') ?? '')

  try {
    await deactivateAccount(accountId)
  } catch (error) {
    if (error instanceof Error && error.message === 'NEXT_REDIRECT') throw error
    redirect(
      '/?error=' + encodeURIComponent(`연결 해제 실패: ${errorMessage(error)}`),
    )
  }

  revalidatePath('/')
  redirect('/')
}

'use server'

import { redirect } from 'next/navigation'
import { revalidatePath } from 'next/cache'
import { deactivateAccount, getAccountById } from '@/lib/accounts'
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

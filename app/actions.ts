'use server'

import { redirect } from 'next/navigation'
import { clearConnection, getConnection } from '@/lib/session'
import { publishTextPost, ThreadsApiError } from '@/lib/threads'

/**
 * 테스트 발행. 1단계 완료 확인용.
 *
 * 주의: Server Action은 UI를 거치지 않고 직접 POST로도 호출될 수 있다.
 * 그래서 함수 안에서 매번 연결 상태를 다시 확인한다.
 */
export async function publishAction(formData: FormData): Promise<void> {
  const text = String(formData.get('text') ?? '')

  const conn = await getConnection()
  if (!conn) {
    redirect('/?error=' + encodeURIComponent('먼저 스레드 계정을 연결해주세요.'))
  }

  let postId: string

  try {
    const result = await publishTextPost(conn.userId, text, conn.accessToken)
    postId = result.id
  } catch (error) {
    const message =
      error instanceof ThreadsApiError
        ? error.message
        : error instanceof Error
          ? error.message
          : '알 수 없는 오류'
    redirect('/?error=' + encodeURIComponent(`발행 실패: ${message}`))
  }

  redirect('/?published=' + encodeURIComponent(postId))
}

export async function disconnectAction(): Promise<void> {
  await clearConnection()
  redirect('/')
}

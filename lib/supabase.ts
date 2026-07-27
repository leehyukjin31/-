/**
 * Supabase 연결.
 *
 * service_role 키를 사용하므로 이 파일은 서버에서만 실행돼야 한다.
 * 클라이언트 컴포넌트에서 import 하면 키가 브라우저에 노출된다.
 *
 * schema.sql 에서 모든 테이블에 RLS를 켜고 정책을 만들지 않았기 때문에,
 * service_role 키를 쓰는 이 클라이언트만 데이터에 접근할 수 있다.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/** 사람이 읽을 수 있는 메시지를 담은 설정 오류. 화면에 그대로 띄워도 되는 수준. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigError'
  }
}

let cached: SupabaseClient | null = null

/**
 * 환경변수가 채워졌는지만 확인한다. 값 자체는 절대 반환하지 않는다.
 * 화면에서 "설정이 덜 됐다"를 안내할 때 쓴다.
 */
export function missingSupabaseEnv(): string[] {
  return (['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'] as const).filter(
    (k) => !process.env[k],
  )
}

/**
 * 지연 생성한다. 모듈을 불러오는 시점이 아니라 실제로 쓸 때 만든다.
 * 그래야 환경변수가 아직 없는 상태에서도 빌드가 통과한다.
 */
export function getSupabase(): SupabaseClient {
  if (cached) return cached

  const missing = missingSupabaseEnv()
  if (missing.length > 0) {
    throw new ConfigError(
      `Supabase 설정이 비어 있습니다: ${missing.join(', ')}\n` +
        `Vercel의 Settings > Environment Variables 에 값을 넣고 다시 배포해주세요. ` +
        `(로컬에서 실행 중이라면 .env.local 파일)`,
    )
  }

  cached = createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      // 서버에서만 도는 클라이언트라 로그인 세션을 저장할 필요가 없다.
      auth: { persistSession: false, autoRefreshToken: false },
    },
  )
  return cached
}

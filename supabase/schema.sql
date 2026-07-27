-- ─────────────────────────────────────────────────────────────
-- 디비투 스레드 자동화 · 데이터베이스 설계도
--
-- 사용법:
--   1. supabase.com 에서 프로젝트를 만든다
--   2. 왼쪽 메뉴 "SQL Editor" → "New query"
--   3. 이 파일 전체를 복사해서 붙여넣고 "Run"
--   4. "Success. No rows returned" 이 나오면 성공
--
-- 여러 번 실행해도 안전하다 (이미 있으면 건너뛴다).
-- ─────────────────────────────────────────────────────────────


-- ═════════════════════════════════════════════════════════════
-- 1. threads_accounts — 연결된 스레드 계정
--
-- 지금까지는 토큰을 브라우저 쿠키에 넣었다. 쿠키는 두 가지가 안 된다:
--   - 계정 여러 개를 못 담는다
--   - 대표님이 브라우저를 안 열면 서버가 못 읽는다 → 예약 발행 불가
-- 그래서 여기로 옮긴다.
-- ═════════════════════════════════════════════════════════════
create table if not exists threads_accounts (
  id uuid primary key default gen_random_uuid(),

  -- Threads가 부여한 계정 고유 번호. 같은 계정을 두 번 연결해도 한 줄만 남는다.
  threads_user_id text not null unique,

  -- @핸들. 계정 이름을 바꾸면 달라질 수 있어서 식별자로는 쓰지 않는다.
  username text,

  -- 대표님이 알아보기 위한 이름. 예: "OO피부과 본원"
  label text,

  -- 장기 토큰(60일). ⚠️ 비밀번호와 동일한 값이다.
  --    이 테이블은 아래 RLS 설정으로 서버만 읽을 수 있게 잠가둔다.
  access_token text not null,

  -- 토큰을 받거나 갱신한 시각
  obtained_at timestamptz not null default now(),

  -- 만료 시각 (= obtained_at + 60일).
  -- 갱신 크론이 "만료 7일 전" 계정을 이 컬럼으로 찾아낸다.
  expires_at timestamptz not null,

  -- 마지막 갱신 결과. 실패가 쌓이면 대시보드에 경고를 띄운다.
  last_refresh_at timestamptz,
  last_refresh_error text,

  -- 잠시 운영을 멈춘 계정은 false. 지우지 않고 꺼둔다.
  is_active boolean not null default true,

  created_at timestamptz not null default now()
);

-- 갱신 크론이 "곧 만료되는 활성 계정"을 빠르게 찾기 위한 색인
create index if not exists threads_accounts_expiry_idx
  on threads_accounts (expires_at)
  where is_active;


-- ═════════════════════════════════════════════════════════════
-- 2. scheduled_posts — 예약 발행 대기열
--
-- 5분마다 도는 크론이 "지금 시각이 지났는데 아직 pending 인 글"을 찾아 발행한다.
-- ═════════════════════════════════════════════════════════════
create table if not exists scheduled_posts (
  id uuid primary key default gen_random_uuid(),

  -- 계정을 삭제하면 그 계정의 예약 글도 함께 사라진다
  account_id uuid not null references threads_accounts(id) on delete cascade,

  -- 발행할 본문 (스레드 한 글 최대 500자)
  body text not null,

  -- 언제 올릴지. 반드시 시간대(timezone) 포함해서 저장한다.
  -- 한국 시간 오전 9시 = '2026-07-28 09:00:00+09'
  scheduled_at timestamptz not null,

  -- pending    : 대기 중
  -- publishing : 크론이 집어감 (중복 발행 방지용 잠금)
  -- published  : 발행 완료
  -- failed     : 3회 시도 후 실패
  -- canceled   : 대표님이 취소
  status text not null default 'pending'
    check (status in ('pending', 'publishing', 'published', 'failed', 'canceled')),

  -- 발행 성공 시 Threads가 돌려준 게시물 ID. 나중에 성과 수집에 쓴다.
  published_post_id text,

  -- 실패 시 원인. 화면에 그대로 보여줄 수 있게 사람이 읽는 문장으로 넣는다.
  error_message text,

  -- 재시도 횟수. 일시적 오류(네트워크 등)와 진짜 실패를 구분하기 위함.
  attempts int not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 크론이 매번 던지는 질문: "발행할 때가 된 pending 글 있나?"
create index if not exists scheduled_posts_due_idx
  on scheduled_posts (scheduled_at)
  where status = 'pending';

-- 대시보드에서 계정별 일정을 볼 때 쓴다
create index if not exists scheduled_posts_account_idx
  on scheduled_posts (account_id, scheduled_at desc);


-- ═════════════════════════════════════════════════════════════
-- 3. post_metrics — 게시물 성과 (하루 1회 스냅샷)
--
-- 조회수는 시간이 지나며 계속 오른다. 덮어쓰지 않고 날짜별로 쌓아야
-- "이 글은 3일차에 터졌다" 같은 걸 알 수 있다.
-- ═════════════════════════════════════════════════════════════
create table if not exists post_metrics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references threads_accounts(id) on delete cascade,

  -- Threads 게시물 ID
  post_id text not null,

  -- 수집한 날짜 (한국 시간 기준 날짜만)
  collected_on date not null,

  -- 본문/링크는 나중에 바뀌거나 지워질 수 있으니 수집 시점 값을 남겨둔다
  body_snapshot text,
  permalink text,
  posted_at timestamptz,

  -- Threads 인사이트 지표. 권한이 없거나 아직 집계 전이면 null.
  views bigint,
  likes bigint,
  replies bigint,
  reposts bigint,
  quotes bigint,
  shares bigint,

  created_at timestamptz not null default now(),

  -- 같은 글을 같은 날 두 번 수집해도 한 줄만 남는다 (크론이 두 번 돌아도 안전)
  unique (post_id, collected_on)
);

create index if not exists post_metrics_account_day_idx
  on post_metrics (account_id, collected_on desc);


-- ═════════════════════════════════════════════════════════════
-- 4. account_metrics — 계정 성과 (하루 1회 스냅샷)
--
-- ⚠️ 팔로워 수·인구통계는 조건이 있다:
--    - 해당 Threads 계정이 인스타그램과 연동되어 있어야 한다
--    - 크리에이터/개인 계정은 팔로워 100명 이상 (비즈니스 계정은 제한 없음)
--    조건 미달이면 null 로 들어온다. 오류가 아니다.
-- ═════════════════════════════════════════════════════════════
create table if not exists account_metrics (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references threads_accounts(id) on delete cascade,

  collected_on date not null,

  followers_count bigint,

  -- 계정 전체 조회수 등, 그날의 계정 단위 지표
  views bigint,

  -- 인구통계는 국가/도시/나이/성별 4종류가 각각 다른 모양으로 온다.
  -- 컬럼으로 쪼개면 Meta가 항목을 추가할 때마다 테이블을 고쳐야 하므로
  -- 받은 그대로 JSON 으로 보관하고, 화면에서 해석한다.
  demographics jsonb,

  created_at timestamptz not null default now(),

  unique (account_id, collected_on)
);


-- ═════════════════════════════════════════════════════════════
-- 5. 보안 잠금 (RLS · Row Level Security)
--
-- access_token 이 들어 있는 테이블이다. 반드시 잠근다.
--
-- Supabase 키는 두 종류다:
--   anon key         : 브라우저에 노출돼도 되는 공개 키
--   service_role key : 모든 잠금을 통과하는 마스터 키 (서버 전용)
--
-- 아래처럼 RLS 를 켜고 정책(policy)을 하나도 만들지 않으면
-- → anon key 로는 아무것도 못 읽는다 (혹시 키가 유출돼도 토큰은 안전)
-- → service_role key 를 쓰는 우리 서버 코드만 읽고 쓸 수 있다
--
-- ❗ 그래서 service_role key 는 절대 NEXT_PUBLIC_ 접두사를 붙이면 안 된다.
-- ═════════════════════════════════════════════════════════════
alter table threads_accounts enable row level security;
alter table scheduled_posts  enable row level security;
alter table post_metrics     enable row level security;
alter table account_metrics  enable row level security;


-- ═════════════════════════════════════════════════════════════
-- 6. updated_at 자동 갱신
--
-- scheduled_posts 를 수정할 때마다 updated_at 을 손으로 넣는 걸 잊기 쉬워서
-- 데이터베이스가 알아서 채우게 한다.
-- ═════════════════════════════════════════════════════════════
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists scheduled_posts_updated_at on scheduled_posts;
create trigger scheduled_posts_updated_at
  before update on scheduled_posts
  for each row execute function set_updated_at();

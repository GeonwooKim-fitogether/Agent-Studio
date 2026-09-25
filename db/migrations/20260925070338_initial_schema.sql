-- 첫 스키마 — Agent Studio 1단계 (docs/plan/02-persistence-and-unlink.md)
--
-- 두 종류의 표를 둔다.
--   GitHub 에서 받아 적는 것(읽기 전용 거울): repository, pr_snapshot
--   Studio 가 소유하는 것: project, work, pr_link, pr_unlink, review_decision, preview_record
-- PR 의 동일성은 (저장소 숫자 ID, PR 번호) 쌍이다. 저장소 이름으로 PR 을 가리키는 칸은 없다.
-- 적용 이력은 적용 명령(db/migrate.mjs)이 schema_migrations 표에 남긴다.

create table project (
  id text primary key,
  name text not null,
  repo_ids bigint[] not null,
  -- 목록을 만든 순서대로 보여 주기 위한 순번
  ord bigint generated always as identity
);

create table work (
  id text primary key check (id ~ '^[a-z0-9]+$'),
  project_id text not null references project (id),
  title text not null,
  status text not null check (status in ('draft', 'in_progress', 'needs_review', 'done')),
  created_at timestamptz not null
);

create table repository (
  id bigint primary key,
  full_name text not null
);

create table pr_snapshot (
  repo_id bigint not null,
  number integer not null check (number > 0),
  title text not null,
  body text not null,
  branch text not null,
  -- PR 의 브랜치가 있는 저장소. 복제본이면 repo_id 와 다르고, 알 수 없으면 null (결정 10)
  head_repo_id bigint,
  head_sha text not null,
  url text not null,
  author text not null,
  state text not null check (state in ('open', 'merged', 'closed')),
  checks text not null check (checks in ('passing', 'failing', 'pending', 'none')),
  review text not null check (review in ('approved', 'changes_requested', 'none')),
  updated_at timestamptz not null,
  primary key (repo_id, number)
);

-- 업무와 PR 의 연결. 기본 키가 (repo_id, number) 라서 PR 하나에 연결은 하나뿐이다.
create table pr_link (
  repo_id bigint not null,
  number integer not null,
  work_id text not null references work (id),
  origin text not null check (origin in ('marker', 'user')),
  -- 표식으로 연결됐을 때 표식을 찾은 자리. 사람이 연결했으면 null
  marker_found_in text[],
  linked_at timestamptz not null,
  primary key (repo_id, number),
  check ((origin = 'marker') = (marker_found_in is not null)),
  check (marker_found_in is null or marker_found_in <@ array['body', 'branch']::text[])
);

-- 사람이 연결을 푼 기록 (결정 9). 이 행이 있는 PR 은 표식으로 자동 연결하지 않는다.
create table pr_unlink (
  repo_id bigint not null,
  number integer not null,
  work_id text not null references work (id),
  unlinked_at timestamptz not null,
  primary key (repo_id, number)
);

create table review_decision (
  id text primary key,
  work_id text not null references work (id),
  repo_id bigint not null,
  number integer not null,
  commit_sha text not null,
  verdict text not null check (verdict in ('changes_requested', 'internal_review_done')),
  decided_at timestamptz not null
);

create table preview_record (
  id text primary key,
  repo_id bigint not null,
  number integer not null,
  commit_sha text not null,
  started_at timestamptz not null
);

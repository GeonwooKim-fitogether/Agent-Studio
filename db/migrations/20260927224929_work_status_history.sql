-- 업무 상태 자동 변화 (docs/product/feature-plan.md F3, 계약 §5-1, 결정 14 · 16)
--
-- 1. 업무 상태에 "완료 후보"(done_candidate) 를 더한다. 규칙 R4 가 붙이고, 사람이 Mark as Done 을 눌러야 완료가 된다.
-- 2. work.status_pin: 사람이 상태를 손으로 바꾼 순간 연결돼 있던 PR 들의 모습(PR 열쇠 → "상태:최신 커밋").
--    다음 PR 변화가 올 때까지 규칙이 사람의 상태를 덮지 않게 하는 기준점이다(R6). 규칙이 다시 판정하면 null 로 돌아간다.
-- 3. work_status_change: 상태 이력. 누가(사람) 또는 어느 규칙이, 언제, 무엇에서 무엇으로, 어느 PR 을 근거로 바꿨나.
--
-- 기존 행은 바꾸지 않는다(status_pin 은 null 로 시작한다). 되돌리려면 표 하나와 칸 하나를 지우고 check 를 옛 목록으로 돌린다
-- — 단 그 전에 done_candidate 인 업무를 다른 상태로 옮겨야 한다.

alter table work drop constraint work_status_check;
alter table work add constraint work_status_check
  check (status in ('draft', 'in_progress', 'needs_review', 'done_candidate', 'done'));

alter table work add column status_pin jsonb;

create table work_status_change (
  id text primary key,
  work_id text not null references work (id),
  from_status text not null check (from_status in ('draft', 'in_progress', 'needs_review', 'done_candidate', 'done')),
  to_status text not null check (to_status in ('draft', 'in_progress', 'needs_review', 'done_candidate', 'done')),
  -- 'rule' 이면 rule 과 evidence(근거 PR: [{repoId, number, commitSha}]) 가 있고, 'person' 이면 action 이 있다
  actor text not null check (actor in ('rule', 'person')),
  rule text check (rule in ('R1', 'R2', 'R3', 'R3b', 'R4', 'R5')),
  evidence jsonb,
  action text check (action in ('mark_done', 'set_status')),
  changed_at timestamptz not null,
  -- 같은 시각에 이어서 걸린 규칙(예: R1 다음 R4)의 순서를 지키기 위한 순번
  ord bigint generated always as identity,
  check ((actor = 'rule') = (rule is not null and evidence is not null and action is null)),
  check ((actor = 'person') = (action is not null and rule is null and evidence is null))
);

create index work_status_change_work on work_status_change (work_id, ord);

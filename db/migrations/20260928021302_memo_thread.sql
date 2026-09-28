-- 스레드 (docs/product/feature-plan.md F9 · §5, 메모와 PR 카드에 다는 답글)
--
-- 답글도 메모다. 기획서 §5 대로 메모 표에 "답글이 어느 항목에 달렸는지" 칸을 더한다. 규칙은 src/domain/memo.ts 에 있다.
--
-- - 최상위 메모는 네 칸이 모두 비어 있다(지금까지의 모든 행이 그렇다 — 기존 행은 바뀌지 않는다).
-- - 메모에 단 답글은 thread_memo_id 만 찬다. PR 카드에 단 답글은 thread_repo_id · thread_number · thread_commit_sha 셋이 함께 찬다.
--   PR 카드의 스레드는 그 커밋의 카드에 붙으므로 커밋 SHA 까지 적는다(계약 §3-2 "이 PR 의 이 커밋").
-- - 스레드는 한 단계만이다. 메모에 단 답글의 대상은 **같은 업무의 최상위 메모**여야 한다. 이것을 외래 키 하나로 막는다:
--   (thread_memo_id, work_id, thread_parent_is_reply) 가 memo 의 (id, work_id, is_reply) 를 가리키고,
--   thread_parent_is_reply 는 언제나 false 다. 그래서 대상이 없거나, 다른 업무의 것이거나, 그 자신이 답글이면 넣을 수 없다.
--   (thread_memo_id 가 비어 있으면 외래 키는 확인하지 않는다 — 최상위 메모와 PR 카드 답글이 그렇다.)
-- - 답글이 달린 메모를 지워도 행은 남으므로(deleted_at) 외래 키가 걸리지 않는다. 메모 행을 실제로 지우는 코드는 없다.
--
-- 기존 표에 칸 · 제약 · 색인만 더한다. is_reply 는 저장되는 계산 칸이라 표를 한 번 다시 쓴다(지금 메모 표는 작다).
-- 되돌리려면 아래에서 더한 제약 · 색인 · 칸을 지운다(alter table memo drop constraint memo_thread_top, drop constraint memo_top_key,
-- drop constraint memo_thread_shape, drop column thread_parent_is_reply, drop column is_reply, drop column thread_commit_sha,
-- drop column thread_number, drop column thread_repo_id, drop column thread_memo_id). 되돌리면 답글은 사라진다.

alter table memo
  add column thread_memo_id text,
  add column thread_repo_id bigint check (thread_repo_id > 0),
  add column thread_number integer check (thread_number > 0),
  add column thread_commit_sha text check (thread_commit_sha ~ '^[0-9a-f]{7,64}$'),
  add column is_reply boolean not null generated always as (thread_memo_id is not null or thread_repo_id is not null) stored,
  add column thread_parent_is_reply boolean not null default false check (not thread_parent_is_reply),
  -- 대상은 하나뿐이다: 메모이거나, PR 카드(세 칸이 함께)이거나, 아무것도 아니다
  add constraint memo_thread_shape check (
    (thread_repo_id is null) = (thread_number is null)
    and (thread_number is null) = (thread_commit_sha is null)
    and (thread_memo_id is null or thread_repo_id is null)
  ),
  add constraint memo_top_key unique (id, work_id, is_reply);

alter table memo
  add constraint memo_thread_top foreign key (thread_memo_id, work_id, thread_parent_is_reply) references memo (id, work_id, is_reply);

create index memo_thread_memo on memo (thread_memo_id) where thread_memo_id is not null;

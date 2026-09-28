-- PR 이벤트 (docs/product/feature-plan.md F7 · §5, 업무 Chat 의 타임라인)
--
-- 지금까지는 PR 의 현재 모습(pr_snapshot)만 저장하고 변화는 저장하지 않았다. Sync 가 스냅샷을 새로 받아 적을 때 앞 모습과 비교해
-- 바뀐 것(새 커밋 · 검사 결과 · 병합 · 닫힘 · 다시 열림)을, 그리고 Studio 의 연결 · 연결 해제를 이 표에 쌓는다.
-- 규칙은 src/domain/pr-event.ts 에 있다.
--
-- - id 는 변화의 내용에서 만든다. 같은 변화를 두 번 읽어도 같은 id 라 한 번만 남는다(저장소가 on conflict do nothing).
-- - work_id 는 그때 그 PR 이 연결돼 있던 업무다. 연결되지 않은 PR 의 변화는 남기지 않는다.
-- - at 은 Studio 가 그 변화를 읽은 시각이다(GitHub 에서 바뀐 시각이 아니다).
--
-- 새 표 하나만 더한다. 기존 표와 행은 바꾸지 않는다 — 이 표가 생기기 전의 변화는 없고, 타임라인은 "지금 모습" 에서 시작한다.
-- 되돌리려면 이 표를 지운다(drop table pr_event). 다른 표가 이 표를 가리키지 않는다.

create table pr_event (
  id text primary key,
  repo_id bigint not null,
  number integer not null check (number > 0),
  work_id text not null references work (id),
  kind text not null check (kind in ('linked', 'unlinked', 'new_commit', 'checks', 'merged', 'closed', 'reopened')),
  commit_sha text not null,
  -- linked 일 때만: 표식으로 연결됐나(marker), 사람이 연결했나(user)
  origin text check (origin in ('marker', 'user')),
  -- new_commit 일 때만: 앞 커밋 SHA
  previous_sha text,
  -- checks 일 때만: 그 커밋의 검사 결과
  checks text check (checks in ('passing', 'failing', 'pending', 'none')),
  at timestamptz not null,
  -- 같은 시각에 쌓인 이벤트의 순서를 지키기 위한 순번
  ord bigint generated always as identity,
  check ((kind = 'linked') = (origin is not null)),
  check ((kind = 'new_commit') = (previous_sha is not null)),
  check ((kind = 'checks') = (checks is not null))
);

create index pr_event_work on pr_event (work_id, ord);

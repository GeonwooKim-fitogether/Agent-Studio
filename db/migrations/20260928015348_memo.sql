-- 메모 (docs/product/feature-plan.md F8 · §5, 업무 Chat 에 사람이 남기는 판단의 이유)
--
-- 칸은 기획서 §5 그대로다: 업무, 작성자, 본문, 시각, 고친 시각, 지움 여부. 규칙은 src/domain/memo.ts 에 있다.
--
-- - author 는 첫 버전에서 늘 'me' 다(결정 15: 작성자는 "나" 한 명). 로그인이 붙으면 이 칸을 사람마다 채운다.
-- - 지우면 deleted_at 이 차고 body 는 빈 글이 된다. 행은 남겨 타임라인에 "지워진 메모" 자리를 지킨다.
-- - 스레드(F9)가 붙으면 "답글이 어느 항목에 달렸는지" 칸을 이 표에 더한다. 지금 칸들은 그것을 막지 않는다.
--
-- 새 표 하나만 더한다. 기존 표와 행은 바꾸지 않는다. 되돌리려면 이 표를 지운다(drop table memo). 다른 표가 이 표를 가리키지 않는다.

create table memo (
  id text primary key,
  work_id text not null references work (id),
  author text not null check (author <> ''),
  body text not null check (char_length(body) <= 4000),
  created_at timestamptz not null,
  edited_at timestamptz,
  deleted_at timestamptz,
  -- 같은 시각에 쓴 메모의 순서를 지키기 위한 순번
  ord bigint generated always as identity,
  -- 지우지 않은 메모에는 본문이 있고, 지운 메모의 본문은 비어 있다
  check ((deleted_at is null) = (body <> ''))
);

create index memo_work on memo (work_id, ord);

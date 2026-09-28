-- Agent 초안 (결정 20 — Flow · Agents 를 Demo 로 메뉴에 둔다)
--
-- Agents 화면에서 사람이 적어 두는 초안이다. 저장만 되고 아무것도 실행하지 않는다(실행 · 모델 연결은 3단계).
-- 칸 규칙은 src/domain/agent-draft.ts 에 있고, 여기의 제약은 그 규칙의 바깥 경계(길이 · 빈 이름 · Skill 목록)를 표에서도 지킨다.
--
-- - 모델 칸은 두지 않는다. 연결 · 확인된 모델이 없으므로 저장할 값이 없다.
-- - skills 는 이미 정의된 Skill 의 id 목록이다(read_context · code_review). 새 Skill 을 정의하는 기능은 없다.
-- - fixture 모드는 이 표가 비어 있을 때만 Planner · Builder · Reviewer 세 초안을 심는다(조립부, seedIfEmpty).
--
-- 새 표 하나만 더한다. 기존 표와 행은 바꾸지 않는다. 되돌리려면 이 표를 지운다(drop table agent_draft). 다른 표가 이 표를 가리키지 않는다.

create table agent_draft (
  id text primary key check (id ~ '^[a-z0-9]{1,40}$'),
  name text not null check (char_length(name) between 1 and 40),
  summary text not null default '' check (char_length(summary) <= 120),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  skills text[] not null default '{}' check (skills <@ array['read_context', 'code_review']::text[]),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

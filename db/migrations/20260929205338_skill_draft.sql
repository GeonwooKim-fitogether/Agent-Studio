-- 사용자 Skill 초안 (결정 21 — Skill 을 정의하는 화면을 Agents 의 Skills 탭(Demo)으로 둔다)
--
-- Skills 탭에서 사람이 만들고 고치는 Skill 이다. 저장만 되고 아무것도 실행하지 않는다(실행 · 모델 연결은 3단계).
-- 칸 규칙은 src/domain/skill-draft.ts 에 있고, 여기의 제약은 그 규칙의 바깥 경계(길이 · 빈 이름 · 같은 이름)를 표에서도 지킨다.
--
-- - 기본 Skill 둘(read_context · code_review)은 코드에 고정돼 있어 이 표에 없다. 이 표의 id 에는 밑줄이 없어 기본 Skill 과 겹치지 않는다.
-- - 이름은 대소문자를 무시하고 겹치지 않는다(유일 색인). 기본 Skill 의 이름과 겹치지 않는 것은 저장 코드가 본다.
-- - "어느 Agent 가 쓰나" 는 저장하지 않는다 — agent_draft.skills 에서 거꾸로 계산한다.
-- - 지우는 기능은 없다. 그래서 agent_draft.skills 가 가리키는 Skill 이 사라지는 일이 없다.
-- - fixture 모드는 이 표가 비어 있을 때만 Release notes 하나를 심는다(조립부, seedIfEmpty).
--
-- agent_draft.skills 의 제약도 넓힌다. 전에는 기본 Skill 두 id 만 받았고, 이제 사용자 Skill 의 id 모양도 받는다
-- (그 id 가 실제로 있는지는 저장 코드가 본다 — 배열 칸에는 외래 키를 걸 수 없다). 기존 행은 모두 새 제약도 지킨다.
--
-- 되돌리려면: agent_draft 에서 사용자 Skill id 를 뺀 뒤 drop table skill_draft, 그리고 agent_draft 의 옛 제약을 다시 건다.

create table skill_draft (
  id text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,39}$'),
  name text not null check (char_length(name) between 1 and 40),
  summary text not null default '' check (char_length(summary) <= 120),
  instructions text not null default '' check (char_length(instructions) <= 4000),
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index skill_draft_name_key on skill_draft (lower(name));

-- 배열의 모든 원소가 기본 Skill id 이거나 사용자 Skill id 의 모양인가 (check 제약은 부분 질의를 못 쓰므로 불변 함수로 둔다)
create function skill_ids_well_formed(ids text[]) returns boolean
  language sql immutable
  return coalesce((select bool_and(i in ('read_context', 'code_review') or i ~ '^[a-z0-9][a-z0-9-]{0,39}$') from unnest(ids) as i), true);

alter table agent_draft drop constraint agent_draft_skills_check;
alter table agent_draft add constraint agent_draft_skills_check check (skill_ids_well_formed(skills));

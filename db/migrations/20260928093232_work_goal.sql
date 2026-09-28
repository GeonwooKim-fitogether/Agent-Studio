-- 업무의 목표 (결정 18 — Focus 시안을 UX 기준으로 삼는다)
--
-- 업무 화면의 대화 위에 고정되는 한두 문장이다. 규칙은 src/domain/work-goal.ts 에 있다.
-- New Work 는 목표를 반드시 받는다. 이미 있던 업무와 Inbox 의 PR 로 만든 업무는 빈 목표('')로 시작하고,
-- 업무 화면의 Set goal 로 적는다. 그래서 기본값이 빈 글이다(not null).
--
-- 칸 하나를 더할 뿐 기존 행의 값은 바꾸지 않는다(모두 '' 가 된다). 되돌리려면 이 칸을 지운다(alter table work drop column goal).

alter table work
  add column goal text not null default ''
  check (char_length(goal) <= 500);

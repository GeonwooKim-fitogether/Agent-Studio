-- 결정 17 (2026-09-28): 검토 필요인 업무에서 PR 이 모두 빠지면 진행 중으로 내리는 규칙 R1b 를 이력에 남길 수 있게 한다.
-- 20260927224929_work_status_history.sql 의 rule check 에 'R1b' 를 더한다. 기존 행은 바뀌지 않는다.
alter table work_status_change drop constraint work_status_change_rule_check;
alter table work_status_change
  add constraint work_status_change_rule_check check (rule in ('R1', 'R1b', 'R2', 'R3', 'R3b', 'R4', 'R5'));

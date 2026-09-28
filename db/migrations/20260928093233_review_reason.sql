-- 내부 검토 결정의 이유와 수정 기준 (결정 18, 계약 §5)
--
-- Request changes 는 두 칸이 모두 있어야 남는다 — reason(무엇이 왜 문제인가), done_when(무엇이 되면 수정이 끝나나).
-- Approve in Studio 는 reason 을 선택 메모로 쓰고 done_when 은 남기지 않는다.
-- "두 칸이 다 있어야 한다" 는 유스케이스(src/application/review.ts)가 검사한다. 이 칸이 생기기 전의 수정 요청 기록에는
-- 이유가 없으므로, 표의 제약은 새 칸의 모양(비지 않은 글, 길이 상한)과 "수정 기준은 수정 요청에만" 까지만 건다.
--
-- 칸 둘을 더할 뿐 기존 행은 바꾸지 않는다(모두 null). 되돌리려면 두 칸을 지운다.

alter table review_decision
  add column reason text check (reason is null or char_length(reason) between 1 and 2000),
  add column done_when text check (done_when is null or char_length(done_when) between 1 and 2000),
  add constraint review_done_when_only_for_changes check (done_when is null or verdict = 'changes_requested');

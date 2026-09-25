/**
 * 내부 검토 결정을 남긴다 (계약 §5). 이번 단위에는 이것을 부르는 버튼이 없다 — 규칙과 테스트만 있다.
 *
 * 이 함수는 저장소(store)만 받는다. GitHub 읽기 포트조차 쓰지 않으므로
 * "내부 검토 완료" 가 GitHub 의 PR 상태를 바꿀 경로가 없다.
 */
import { isValidPrRef, type PrRef, type ReviewDecision, type ReviewVerdict, StudioError } from "../domain/model";
import type { AppDeps } from "./deps";

export async function recordReviewDecision(
  deps: Pick<AppDeps, "store" | "now" | "newId">,
  input: PrRef & { readonly workId: string; readonly verdict: ReviewVerdict },
): Promise<ReviewDecision> {
  if (!isValidPrRef(input)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
  const link = await deps.store.getLink(input);
  if (link === undefined || link.workId !== input.workId) {
    throw new StudioError("not_linked", "이 PR 은 이 업무에 연결돼 있지 않다.");
  }
  const pr = await deps.store.getSnapshot(input);
  if (pr === undefined) throw new StudioError("not_found", "그 PR 을 찾을 수 없다.");

  // 어느 커밋을 보고 내린 결정인지 함께 남긴다. 결정의 단위는 "이 PR" 이 아니라 "이 PR 의 이 커밋" 이다.
  const decision: ReviewDecision = {
    id: deps.newId(),
    workId: input.workId,
    repoId: pr.repoId,
    number: pr.number,
    commitSha: pr.headSha,
    verdict: input.verdict,
    decidedAt: deps.now().toISOString(),
  };
  await deps.store.addReviewDecision(decision);
  return decision;
}

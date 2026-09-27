/**
 * 내부 검토 결정을 남긴다 (계약 §5). 업무 화면 PR 카드의 Approve · Request Changes 가 부른다(docs/product/feature-plan.md F2).
 *
 * 이 함수는 저장소(store)만 받는다. GitHub 읽기 포트조차 쓰지 않으므로
 * "내부 검토 완료" 가 GitHub 의 PR 상태를 바꿀 경로가 없다.
 *
 * 규칙은 셋이다.
 *   1. 결정은 저장된 PR 스냅샷의 **지금** 최신 커밋에 대해 남긴다. 화면에서 온 커밋 SHA 는 받지 않는다(미리보기와 같은 방식).
 *   2. GitHub 에서 이미 병합됐거나 닫힌 PR 에는 새 결정을 남기지 않는다. 화면은 버튼을 숨기지 않고 비활성으로 두고 이유를 보인다(결정 7).
 *   3. 기록은 지우지 않고 쌓는다. 같은 커밋에 여러 번 누르면 마지막 결정이 그 커밋의 결정이다(visibleReviews).
 */
import { isValidPrRef, type PrRef, type PrState, type ReviewDecision, type ReviewVerdict, StudioError } from "../domain/model";
import { isValidWorkId } from "../domain/work-marker";
import type { AppDeps } from "./deps";

const VERDICTS: readonly ReviewVerdict[] = ["internal_review_done", "changes_requested"];

export function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** 이 PR 에 지금 내부 검토 결정을 남길 수 없는 이유. 남길 수 있으면 null */
export type ReviewBlock = "merged" | "closed";

export function reviewBlockOf(pr: { readonly state: PrState }): ReviewBlock | null {
  return pr.state === "open" ? null : pr.state;
}

export async function recordReviewDecision(
  deps: Pick<AppDeps, "store" | "now" | "newId">,
  input: PrRef & { readonly workId: string; readonly verdict: ReviewVerdict },
): Promise<ReviewDecision> {
  if (!isValidPrRef(input)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
  if (!isValidWorkId(input.workId)) throw new StudioError("invalid_input", "업무 ID 가 올바르지 않다.");
  if (!isReviewVerdict(input.verdict)) throw new StudioError("invalid_input", "검토 결정 값이 올바르지 않다.");
  const link = await deps.store.getLink(input);
  if (link === undefined || link.workId !== input.workId) {
    throw new StudioError("not_linked", "이 PR 은 이 업무에 연결돼 있지 않다.");
  }
  const pr = await deps.store.getSnapshot(input);
  if (pr === undefined) throw new StudioError("not_found", "그 PR 을 찾을 수 없다.");
  if (reviewBlockOf(pr) !== null) throw new StudioError("invalid_input", "병합됐거나 닫힌 PR 에는 내부 검토 결정을 새로 남기지 않는다.");

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

/**
 * 카드에 보일 결정. 커밋마다 마지막 결정 하나만 남긴다 — 같은 커밋에 Approve 뒤 Request Changes 를 누르면
 * 그 커밋의 결정은 Request Changes 다(GitHub 리뷰와 같은 관행). 다른 커밋의 결정은 지우지 않으므로,
 * 이전 커밋에 대한 결정은 "이전 커밋에 대한 결정" 으로 계속 보인다(계약 §6).
 * 입력은 시간순(오래된 것부터)이어야 하고, 돌려주는 것도 시간순이다.
 */
export function visibleReviews<T extends { readonly commitSha: string }>(reviews: readonly T[]): T[] {
  const lastIndexOf = new Map<string, number>();
  reviews.forEach((r, i) => lastIndexOf.set(r.commitSha, i));
  return reviews.filter((r, i) => lastIndexOf.get(r.commitSha) === i);
}

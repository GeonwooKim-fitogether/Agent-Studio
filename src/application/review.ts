/**
 * 내부 검토 결정을 남긴다 (계약 §5). 업무 화면 Review 패널의 Approve in Studio · Request changes 가 부른다(결정 18, feature-plan F2).
 *
 * 이 함수는 저장소(store)만 받는다. GitHub 읽기 포트조차 쓰지 않으므로
 * "내부 검토 완료" 가 GitHub 의 PR 상태를 바꿀 경로가 없다. (저장 직전에 PR 하나의 최신 커밋을 GitHub 에서 다시 읽는 것은
 * 따로 있는 readFreshHead 이고, 그것도 GET 하나뿐이다.)
 *
 * 규칙은 다섯이다.
 *   1. 결정은 사람이 **실제로 본** 커밋(viewedSha, 화면이 폼에 실어 보낸 것)으로 남긴다. 그 커밋이 저장된 PR 스냅샷의
 *      지금 최신 커밋과 다르면 저장하지 않고 stale_commit 으로 거절한다 — 그사이 새 커밋이 왔으니 다시 보고 판단한다(결정 18).
 *      그래서 기록되는 커밋은 언제나 "본 커밋 = 그 순간의 최신 커밋" 이다.
 *   2. Request changes 는 이유(reason)와 수정 기준(doneWhen)이 모두 있어야 남는다. Approve in Studio 는 이유 칸을 선택 메모로 쓴다(review-note.ts).
 *   3. GitHub 에서 이미 병합됐거나 닫힌 PR 에는 새 결정을 남기지 않는다. 화면은 버튼을 숨기지 않고 비활성으로 두고 이유를 보인다(결정 7).
 *   4. 이 PR 의 미리보기가 이전 커밋을 실행 중이면(오래됨) 결정을 남기지 않는다 — 오래된 화면을 보고 최신 커밋을 승인하는 것을 막는다(Q10).
 *      미리보기 기기가 꺼져 있거나 미리보기가 없는 것은 막지 않는다 — 미리보기 없이 GitHub 에서 확인할 수 있다.
 *   5. 기록은 지우지 않고 쌓는다. 같은 커밋에 여러 번 누르면 마지막 결정이 그 커밋의 결정이다(visibleReviews).
 */
import { freshnessOf } from "../domain/freshness";
import { isValidPrRef, type PrRef, type PrState, type ReviewDecision, type ReviewVerdict, samePr, StudioError } from "../domain/model";
import { checkReviewNote } from "../domain/review-note";
import { isValidWorkId } from "../domain/work-marker";
import type { RunningPreview } from "./attention";
import type { AppDeps } from "./deps";
import { refreshWorkStatuses } from "./work-status";

const VERDICTS: readonly ReviewVerdict[] = ["internal_review_done", "changes_requested"];

export function isReviewVerdict(value: unknown): value is ReviewVerdict {
  return typeof value === "string" && (VERDICTS as readonly string[]).includes(value);
}

/** 이 PR 에 지금 내부 검토 결정을 남길 수 없는 PR 쪽 이유. 남길 수 있으면 null */
export type ReviewBlock = "merged" | "closed";

export function reviewBlockOf(pr: { readonly state: PrState }): ReviewBlock | null {
  return pr.state === "open" ? null : pr.state;
}

/** 결정 버튼을 막는 이유 전부 — PR 쪽 이유(병합 · 닫힘)에 더해, 이 PR 의 미리보기가 이전 커밋을 실행 중인 경우(Q10) */
export type DecisionBlock = ReviewBlock | "outdated_preview";

/**
 * 지금 이 PR 에 결정을 남길 수 없는 이유. 화면(버튼 비활성 + 이유)과 서버(recordReviewDecision)가 같은 판정을 쓴다.
 * 미리보기는 "실행 중" 일 때만 본다 — 준비 중 · 실패 · 종료된 것은 열어 볼 화면이 없으니 검토 근거로 오해될 일도 없다(attention.ts 와 같은 기준).
 */
export function decisionBlockOf(
  pr: PrRef & { readonly state: PrState; readonly headSha: string },
  preview: RunningPreview | null,
): DecisionBlock | null {
  const block = reviewBlockOf(pr);
  if (block !== null) return block;
  if (preview !== null && preview.phase === "running" && samePr(preview.target, pr) && freshnessOf(preview.target, pr.headSha) === "outdated") {
    return "outdated_preview";
  }
  return null;
}

export async function recordReviewDecision(
  deps: Pick<AppDeps, "store" | "now" | "newId">,
  input: PrRef & {
    readonly workId: string;
    readonly verdict: ReviewVerdict;
    /** 사람이 화면에서 본 커밋 (Review 패널 폼의 숨은 칸) */
    readonly viewedSha: string;
    readonly reason?: string | null;
    readonly doneWhen?: string | null;
    /** 실행기가 지금 들고 있는 미리보기. 모르면 null */
    readonly preview?: RunningPreview | null;
  },
): Promise<ReviewDecision> {
  if (!isValidPrRef(input)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
  if (!isValidWorkId(input.workId)) throw new StudioError("invalid_input", "업무 ID 가 올바르지 않다.");
  if (!isReviewVerdict(input.verdict)) throw new StudioError("invalid_input", "검토 결정 값이 올바르지 않다.");
  if (typeof input.viewedSha !== "string" || !/^[0-9a-f]{7,64}$/.test(input.viewedSha)) {
    throw new StudioError("invalid_input", "어느 커밋을 보고 내린 결정인지 알 수 없다.");
  }
  const note = checkReviewNote(input.verdict, { reason: input.reason ?? null, doneWhen: input.doneWhen ?? null });
  if (!note.ok) throw new StudioError("invalid_input", "Request changes 에는 이유와 수정 기준이 모두 있어야 한다.");
  const link = await deps.store.getLink(input);
  if (link === undefined || link.workId !== input.workId) {
    throw new StudioError("not_linked", "이 PR 은 이 업무에 연결돼 있지 않다.");
  }
  const pr = await deps.store.getSnapshot(input);
  if (pr === undefined) throw new StudioError("not_found", "그 PR 을 찾을 수 없다.");
  if (reviewBlockOf(pr) !== null) throw new StudioError("invalid_input", "병합됐거나 닫힌 PR 에는 내부 검토 결정을 새로 남기지 않는다.");
  // 본 커밋이 지금 최신 커밋이 아니면 남기지 않는다 — 결정의 단위는 "이 PR" 이 아니라 "이 PR 의 이 커밋" 이다 (계약 §3-2)
  if (input.viewedSha !== pr.headSha) throw new StudioError("stale_commit", "본 커밋 뒤에 새 커밋이 도착해 결정을 남기지 않았다.");
  if (decisionBlockOf(pr, input.preview ?? null) === "outdated_preview") {
    throw new StudioError("invalid_input", "이 PR 의 미리보기가 이전 커밋을 실행 중이라 결정을 남기지 않는다.");
  }

  const decision: ReviewDecision = {
    id: deps.newId(),
    workId: input.workId,
    repoId: pr.repoId,
    number: pr.number,
    commitSha: input.viewedSha,
    verdict: input.verdict,
    decidedAt: deps.now().toISOString(),
    reason: note.reason,
    doneWhen: note.doneWhen,
  };
  await deps.store.addReviewDecision(decision);
  // 결정은 업무 상태의 재료다 — Request changes 는 R3, Approve 는 R3b (계약 §5-1)
  await refreshWorkStatuses(deps, [input.workId]);
  return decision;
}

/**
 * 저장 직전에 PR 하나의 최신 커밋을 GitHub 에서 다시 읽는다(GET 하나, 결정 18 · Q9). 저장된 스냅샷은 마지막 Sync 의 모습이라
 * 그 뒤에 올라온 커밋을 모를 수 있기 때문이다. 리더가 단건 읽기를 모르거나 · 저장소를 모르거나 · 읽다가 실패하면 null 이다 —
 * 그때는 스냅샷 비교(recordReviewDecision 의 규칙 1)만으로 판단한다. 읽지 못했다고 검토를 막지는 않는다.
 */
export async function readFreshHead(deps: Pick<AppDeps, "reader" | "store">, ref: PrRef): Promise<string | null> {
  const read = deps.reader.readPullRequestHead;
  if (read === undefined || !isValidPrRef(ref)) return null;
  const repository = (await deps.store.listRepositories()).find((r) => r.id === ref.repoId);
  if (repository === undefined) return null;
  try {
    return await read.call(deps.reader, repository, ref.number);
  } catch {
    return null;
  }
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

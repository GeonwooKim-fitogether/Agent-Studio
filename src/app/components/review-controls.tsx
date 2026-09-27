import { reviewBlockOf } from "../../application/review";
import type { PrState } from "../../domain/model";
import { reviewAction } from "../actions";
import { APPROVE_NOTE, REVIEW_BLOCK } from "./labels";

/**
 * PR 카드 안의 내부 검토 칸 (feature-plan F2). Approve · Request Changes 는 Studio 에만 결정을 남기고 GitHub 에는 아무것도 보내지 않는다.
 *
 * 폼은 커밋 SHA 를 싣지 않는다 — 서버가 저장된 PR 스냅샷의 지금 최신 커밋으로 남긴다.
 * 남길 수 없는 PR(병합됨 · 닫힘)이면 버튼을 없애지 않고 비활성으로 두고 바로 옆에 이유를 보인다(결정 7).
 */
export function ReviewControls({
  pr,
  workId,
}: {
  pr: { readonly repoId: number; readonly number: number; readonly github: { readonly state: PrState } };
  workId: string;
}) {
  const block = reviewBlockOf(pr.github);
  const reasonId = `review-reason-${pr.repoId}-${pr.number}`;
  const button = (verdict: "internal_review_done" | "changes_requested", label: string) =>
    block === null ? (
      <form action={reviewAction}>
        <input type="hidden" name="repoId" value={pr.repoId} />
        <input type="hidden" name="number" value={pr.number} />
        <input type="hidden" name="workId" value={workId} />
        <input type="hidden" name="verdict" value={verdict} />
        <button type="submit" className="btn">
          {label}
        </button>
      </form>
    ) : (
      <button type="button" className="btn" disabled aria-describedby={reasonId}>
        {label}
      </button>
    );

  return (
    <section className="review-box" data-testid="review-box" aria-label="Internal review">
      <div className="review-actions">
        {button("internal_review_done", "Approve")}
        <small className="muted" data-testid="approve-note">
          {APPROVE_NOTE}
        </small>
        {button("changes_requested", "Request Changes")}
        {block !== null && (
          <span className="muted" id={reasonId} data-testid="review-blocked-reason">
            {REVIEW_BLOCK[block]}
          </span>
        )}
      </div>
    </section>
  );
}

import type { PreviewCardView } from "../../application/preview";
import type { PrCardView } from "../../application/queries";
import { type DecisionBlock, visibleReviews } from "../../application/review";
import type { Work } from "../../domain/model";
import { MAX_REVIEW_NOTE_LENGTH } from "../../domain/review-note";
import type { DataSource } from "../../ports/github-reader";
import { reviewAction, unlinkAction } from "../actions";
import { cardAnchor, DecisionPill } from "./chat";
import { Icon } from "./glyph";
import { APPROVE_NOTE, linkLabel, prRef, REVIEW_BLOCK, type ReviewProblem, reviewProblemText, shortSha } from "./labels";
import { PreviewControls } from "./preview-controls";
import { PrIcons } from "./pr-icons";

/**
 * Review 패널 (결정 18 · 19, Q8 · Q9 · Q10). 결과 카드의 Open review 가 같은 주소를 ?review=<저장소 ID>:<PR 번호> 로 다시 그려 연다.
 * 넓은 화면에서는 오른쪽 칸(Work details 자리), 휴대전화 폭에서는 화면 전체다. Close 는 파라미터 없는 주소로 돌아간다 — 자바스크립트 없이 동작한다.
 *
 * 머리: PR 제목, `#12 · 3c4d5e6`(사람이 지금 보고 있는 커밋), 아이콘 줄 하나, 그 커밋에 결정이 있으면 Studio 알약. GITHUB · STUDIO · PREVIEW 절은 두지 않는다 —
 * 같은 사실이 아이콘 줄에 있고, 이전 커밋에 대한 결정은 타임라인의 한 줄("… 남김 · PR #12 · 이전 커밋")에 있다.
 * 몸: Reason · Done when · Approve in Studio · Request changes · 한 줄 안내 · 미리보기 칸 · Link(연결 방식과 Unlink, 접혀 있다).
 *
 * 폼은 사람이 **지금 보고 있는 커밋**을 숨은 칸(viewedSha)에 싣는다. 저장하는 순간 PR 의 최신 커밋이 그것과 다르면 서버가 거절하고,
 * 이 패널을 새 커밋으로 다시 그린다(적어 둔 Reason · Done when 은 되살린다).
 * Request changes 는 Reason 과 Done when 이 모두 있어야 남는다(서버가 검사한다). Approve in Studio 는 Reason 칸을 선택 메모로 쓴다.
 * 결정은 Studio 에만 기록된다 — GitHub 리뷰 · 병합은 GitHub 에서 한다.
 */
export function ReviewPanel({
  work,
  pr,
  preview,
  sameRepo,
  block,
  problem,
  draft,
  source,
}: {
  work: Work;
  pr: PrCardView;
  preview: PreviewCardView | undefined;
  /** 이 업무의 PR 이 모두 같은 저장소인가 (그러면 `#12` 로만 적는다) */
  sameRepo: boolean;
  block: DecisionBlock | null;
  problem: ReviewProblem | null;
  draft: { readonly reason: string; readonly doneWhen: string } | null;
  source: DataSource;
}) {
  const key = `${pr.repoId}:${pr.number}`;
  const workPath = `/works/${encodeURIComponent(work.id)}`;
  const current = visibleReviews(pr.studio.reviews).filter((r) => r.freshness === "current").at(-1);
  const reasonId = `review-reason-${pr.repoId}-${pr.number}`;
  const decide = (verdict: "internal_review_done" | "changes_requested", label: string, primary: boolean) =>
    block === null ? (
      <button type="submit" name="verdict" value={verdict} className={primary ? "btn accent wide" : "btn wide"}>
        {primary && <Icon name="check" />}
        {label}
      </button>
    ) : (
      <button type="button" className={primary ? "btn accent wide" : "btn wide"} disabled aria-describedby={reasonId}>
        {label}
      </button>
    );

  return (
    <aside className="side-panel review-panel" id="review" aria-label="Review" data-testid="review-panel">
      <div className="panel-head">
        <div className="grow">
          <h2 data-testid="review-title">{pr.title}</h2>
          <small>
            {prRef(pr.repoName, pr.number, sameRepo)} ·{" "}
            <code data-testid="review-commit" title={pr.headSha}>
              {shortSha(pr.headSha)}
            </code>
            {source !== "fixture" && (
              <>
                {" "}
                <a className="text-link" href={pr.url} target="_blank" rel="noreferrer" title="Open on GitHub" aria-label="Open on GitHub">
                  <Icon name="external" />
                </a>
              </>
            )}
          </small>
          <span className="panel-state">
            <PrIcons github={pr.github} preview={preview} />
            {current !== undefined && <DecisionPill verdict={current.verdict} commitSha={current.commitSha} />}
          </span>
        </div>
        <a className="iconbtn" href={`${workPath}#${cardAnchor(pr.repoId, pr.number, pr.headSha)}`} aria-label="Close" data-testid="review-close">
          <Icon name="close" />
        </a>
      </div>
      <div className="panel-body">
        {problem !== null && (
          <p className={problem === "stale" ? "form-error stale" : "form-error"} role="alert" data-testid="review-problem" data-problem={problem}>
            {reviewProblemText(problem)}
          </p>
        )}

        <form action={reviewAction} className="decision-form" data-testid="decision-form">
          <input type="hidden" name="repoId" value={pr.repoId} />
          <input type="hidden" name="number" value={pr.number} />
          <input type="hidden" name="workId" value={work.id} />
          <input type="hidden" name="viewedSha" value={pr.headSha} data-testid="viewed-sha" />
          <label className="field">
            <span>
              Reason <small className="muted">무엇이 왜 문제인가 · Approve 에는 선택 메모</small>
            </span>
            <textarea name="reason" rows={3} maxLength={MAX_REVIEW_NOTE_LENGTH} defaultValue={draft?.reason ?? ""} aria-label="Reason" />
          </label>
          <label className="field">
            <span>
              Done when <small className="muted">무엇이 되면 수정이 끝나나 · Request changes 에 필수</small>
            </span>
            <textarea name="doneWhen" rows={2} maxLength={MAX_REVIEW_NOTE_LENGTH} defaultValue={draft?.doneWhen ?? ""} aria-label="Done when" />
          </label>
          {block !== null && (
            <p className="blocked" id={reasonId} data-testid="review-blocked-reason">
              {REVIEW_BLOCK[block]}
            </p>
          )}
          <div className="decision-buttons">
            {decide("internal_review_done", "Approve in Studio", true)}
            {decide("changes_requested", "Request changes", false)}
          </div>
          <p className="hint" data-testid="approve-note">
            {APPROVE_NOTE}
          </p>
        </form>

        {preview !== undefined && <PreviewControls view={preview} pr={pr} workId={work.id} review={key} />}

        <details className="link-section" aria-label="Link">
          <summary>
            <Icon name="chevron" />
            Link
          </summary>
          <p className="muted">
            <span className="chip" data-testid="link-origin">
              {linkLabel(pr.studio.linkOrigin, pr.studio.markerFoundIn)}
            </span>
          </p>
          {/* 오조작을 막는 확인 한 단계: 체크박스를 체크해야 제출된다. 자바스크립트 없이도 브라우저가 막는다(required). */}
          <form action={unlinkAction} className="unlink-form" data-testid="unlink-form">
            <input type="hidden" name="repoId" value={pr.repoId} />
            <input type="hidden" name="number" value={pr.number} />
            <input type="hidden" name="workId" value={work.id} />
            <label className="check-row">
              <input type="checkbox" name="confirm" value="yes" required /> Inbox 로 돌려보낸다 · 자동으로 다시 붙지 않는다
            </label>
            <button type="submit" className="btn small">
              Unlink
            </button>
          </form>
        </details>
      </div>
    </aside>
  );
}

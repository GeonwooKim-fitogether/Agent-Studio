import type { PreviewCardView } from "../../application/preview";
import type { PrCardView } from "../../application/queries";
import { type DecisionBlock, visibleReviews } from "../../application/review";
import type { Work } from "../../domain/model";
import { MAX_REVIEW_NOTE_LENGTH } from "../../domain/review-note";
import type { DataSource } from "../../ports/github-reader";
import { reviewAction, unlinkAction } from "../actions";
import { cardAnchor } from "./chat";
import { Icon } from "./glyph";
import {
  APPROVE_NOTE,
  CHECKS,
  GITHUB_REVIEW,
  linkLabel,
  NO_INTERNAL_REVIEW,
  PR_STATE,
  PREVIEW_HOST_OFFLINE,
  REVIEW_BLOCK,
  REVIEW_PANEL_NOTE,
  type ReviewProblem,
  reviewProblemText,
  shortSha,
  VERDICT,
  VERDICT_MEANING,
} from "./labels";
import { PreviewControls } from "./preview-controls";

/**
 * Review 패널 (결정 18, Q8 · Q9 · Q10). 결과 카드의 Open review 가 같은 주소를 ?review=<저장소 ID>:<PR 번호> 로 다시 그려 연다.
 * 넓은 화면에서는 오른쪽 칸(Work details 자리), 휴대전화 폭에서는 화면 전체다. Close 는 파라미터 없는 주소로 돌아간다 — 자바스크립트 없이 동작한다.
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
  hostOnline,
  block,
  problem,
  draft,
  source,
}: {
  work: Work;
  pr: PrCardView;
  preview: PreviewCardView | undefined;
  hostOnline: boolean;
  block: DecisionBlock | null;
  problem: ReviewProblem | null;
  draft: { readonly reason: string; readonly doneWhen: string } | null;
  source: DataSource;
}) {
  const key = `${pr.repoId}:${pr.number}`;
  const workPath = `/works/${encodeURIComponent(work.id)}`;
  const reviews = visibleReviews(pr.studio.reviews);
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
        <div>
          <h2>Review work</h2>
          <small>
            {pr.repoName}#{pr.number}
          </small>
        </div>
        <a className="iconbtn" href={`${workPath}#${cardAnchor(pr.repoId, pr.number, pr.headSha)}`} aria-label="Close" data-testid="review-close">
          <Icon name="close" />
        </a>
      </div>
      <div className="panel-body">
        <p className="eyebrow">Your decision</p>
        <h3 className="panel-title">{pr.title}</h3>
        <dl className="properties">
          <div className="property">
            <dt>Work</dt>
            <dd>{work.title}</dd>
          </div>
          <div className="property">
            <dt>Pull request</dt>
            <dd>
              {pr.repoName}#{pr.number}
              {source !== "fixture" && (
                <>
                  {" "}
                  <a className="text-link" href={pr.url} target="_blank" rel="noreferrer">
                    Open on GitHub <Icon name="external" />
                  </a>
                </>
              )}
            </dd>
          </div>
          <div className="property">
            <dt>Reviewing</dt>
            <dd>
              <code data-testid="review-commit" title={pr.headSha}>
                {shortSha(pr.headSha)}
              </code>{" "}
              <small className="muted">지금 보고 있는 커밋</small>
            </dd>
          </div>
        </dl>

        {problem !== null && (
          <p className={problem === "stale" ? "form-error stale" : "form-error"} role="alert" data-testid="review-problem" data-problem={problem}>
            {reviewProblemText(problem, pr.headSha)}
          </p>
        )}

        <section className="panel-section" aria-label="GitHub" data-testid="github-status">
          <h4>GitHub</h4>
          <div className="chip-line">
            <span className={`chip pr-${pr.github.state}`}>{PR_STATE[pr.github.state]}</span>
            <span className={`chip checks-${pr.github.checks}`}>{CHECKS[pr.github.checks]}</span>
            <span className="chip">{GITHUB_REVIEW[pr.github.review]}</span>
          </div>
        </section>

        <section className="panel-section" aria-label="Studio" data-testid="studio-status">
          <h4>Studio</h4>
          <div className="chip-line">
            {reviews.length === 0 && <span className="chip quiet">{NO_INTERNAL_REVIEW}</span>}
            {/* 커밋마다 마지막 결정 하나만 보인다. 이전 커밋에 대한 결정은 지우지 않고 그렇다고 표시한다 (계약 §6) */}
            {reviews.map((r) => (
              <span key={r.id} className={`chip ${r.freshness}`} data-testid="review-decision" data-freshness={r.freshness} data-verdict={r.verdict}>
                {VERDICT[r.verdict]} · {VERDICT_MEANING[r.verdict]} · 커밋 {shortSha(r.commitSha)}
                {r.freshness === "outdated" && " · 이전 커밋에 대한 결정"}
              </span>
            ))}
          </div>
        </section>

        <section className="panel-section" aria-label="Preview">
          <h4>Preview</h4>
          {!hostOnline && (
            <p className="host-offline" data-testid="host-offline-note">
              <Icon name="off" />
              {PREVIEW_HOST_OFFLINE}
            </p>
          )}
          {preview !== undefined && <PreviewControls view={preview} pr={pr} workId={work.id} review={key} />}
        </section>

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
            {APPROVE_NOTE}. {REVIEW_PANEL_NOTE}
          </p>
        </form>

        <section className="panel-section link-section" aria-label="Link">
          <h4>Link</h4>
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
              <input type="checkbox" name="confirm" value="yes" required /> 이 PR 을 업무에서 떼어 Inbox 로 돌려보낸다 (표식이 있어도 다시 자동으로 붙지
              않는다)
            </label>
            <button type="submit" className="btn small">
              Unlink
            </button>
          </form>
        </section>
      </div>
    </aside>
  );
}

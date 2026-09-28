import type { ReactNode } from "react";
import { currentDecisionOf, type NextAction } from "../../application/focus";
import type { PreviewCardView } from "../../application/preview";
import type { PrCardView, WorkSummaryView } from "../../application/queries";
import { MAX_WORK_GOAL_LENGTH } from "../../domain/work-goal";
import type { Work } from "../../domain/model";
import { markDoneAction, setGoalAction } from "../actions";
import { CopyButton } from "./copy-button";
import { Icon } from "./glyph";
import { DONE_CANDIDATE_NOTE, githubLine, linkLabel, MARKER_HINT, NO_INTERNAL_REVIEW, PREVIEW_HOST_OFFLINE, shortSha, VERDICT } from "./labels";
import { PreviewStatus, previewSummary } from "./preview-status";
import { WorkStatusPanel } from "./work-status";

/**
 * 업무 화면의 조각들 (결정 18, Q6 · Q7). 무엇을 할 차례인지(Next action)는 application/focus.ts 가 정한다.
 * 모두 서버 액션 폼과 링크라 자바스크립트 없이 동작한다.
 */

export const reviewHref = (workId: string, pr: { readonly repoId: number; readonly number: number }) =>
  `/works/${encodeURIComponent(workId)}?review=${pr.repoId}:${pr.number}#review`;

/** 대화 위에 고정되는 목표 (Q4). 비었으면 Set goal, 있으면 Edit goal. 고치기 칸은 ?goal=edit 로 연다 */
export function GoalCard({ work, editing, problem }: { work: Work; editing: boolean; problem: string | null }) {
  const path = `/works/${encodeURIComponent(work.id)}`;
  if (editing) {
    return (
      <section className="goal editing" id="goal" aria-label="Goal" data-testid="goal">
        <p className="eyebrow">The goal</p>
        {problem !== null && (
          <p className="form-error" data-testid="goal-problem">
            목표를 저장하지 않았다 — {problem}
          </p>
        )}
        <form action={setGoalAction} className="goal-form">
          <input type="hidden" name="workId" value={work.id} />
          <textarea
            name="goal"
            rows={2}
            required
            maxLength={MAX_WORK_GOAL_LENGTH}
            defaultValue={work.goal}
            aria-label="Goal"
            autoFocus
            placeholder="이 업무가 끝나면 무엇이 달라지나 (한두 문장)"
          />
          <div className="goal-actions">
            <a className="btn small ghost" href={path}>
              Cancel
            </a>
            <button type="submit" className="btn small primary">
              Save goal
            </button>
          </div>
        </form>
      </section>
    );
  }
  return (
    <section className="goal" id="goal" aria-label="Goal" data-testid="goal">
      <div className="goal-head">
        <p className="eyebrow">The goal</p>
        <a className="text-link" href={`${path}?goal=edit#goal`} data-testid="goal-edit">
          {work.goal === "" ? "Set goal" : "Edit goal"}
        </a>
      </div>
      {work.goal === "" ? (
        <p className="goal-empty" data-testid="goal-text">
          아직 목표가 없다.
        </p>
      ) : (
        <p data-testid="goal-text">{work.goal}</p>
      )}
    </section>
  );
}

/** Next action 카드 (Q6). 상황마다 제목 · 한 구절(없을 수도 있다) · 주 버튼 하나. 규칙 설명은 두지 않는다(결정 18) */
export function NextActionCard({
  action,
  work,
  marker,
  previews,
  hostOnline,
}: {
  action: NextAction;
  work: Work;
  marker: string;
  previews: ReadonlyMap<string, PreviewCardView>;
  hostOnline: boolean;
}) {
  const path = `/works/${encodeURIComponent(work.id)}`;
  const button = (href: string, label: string, testid = "next-action-button") => (
    <a className="btn accent wide" href={href} data-testid={testid}>
      {label}
      <Icon name="arrow" />
    </a>
  );
  const prLine = (pr: PrCardView) => `${pr.repoName}#${pr.number} · 커밋 ${shortSha(pr.headSha)}`;
  let title: string;
  let text: ReactNode = null;
  let primary: ReactNode = null;
  switch (action.kind) {
    case "done":
      title = "완료된 업무다";
      break;
    case "mark_done":
      title = "끝났는지 확인한다";
      text = <span data-testid="done-candidate-note">{DONE_CANDIDATE_NOTE}</span>;
      primary = (
        <form action={markDoneAction}>
          <input type="hidden" name="workId" value={work.id} />
          <button type="submit" className="btn accent wide">
            <Icon name="check" />
            Mark as Done
          </button>
        </form>
      );
      break;
    case "review":
      title = "결과를 확인한다";
      text = `${prLine(action.pr)} · 검사 끝남, 판단 전`;
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "outdated_preview":
      title = "미리보기를 최신 커밋으로 다시 연다";
      text = `미리보기는 커밋 ${shortSha(action.previewCommitSha)}, 최신은 ${shortSha(action.pr.headSha)}`;
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "checks_failing":
      title = "검사 실패 — 작성자가 고칠 차례";
      text = prLine(action.pr);
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "set_goal":
      title = "목표를 적는다";
      primary = button(`${path}?goal=edit#goal`, "Set goal");
      break;
    case "link_pr":
      title = "PR 을 연결한다";
      text = (
        <>
          표식 <code title={MARKER_HINT}>{marker}</code> 을 PR 본문이나 브랜치 이름에 넣는다
        </>
      );
      primary = button("#link-pr", "Show marker");
      break;
    case "changes_requested":
      title = "수정을 기다린다";
      text = `${prLine(action.pr)} · Request changes 남김`;
      primary = button(reviewHref(work.id, action.pr), "View decision");
      break;
    case "await_merge":
      title = "GitHub 병합을 기다린다";
      text = `${prLine(action.pr)} · Studio 승인`;
      primary = button(reviewHref(work.id, action.pr), "View decision");
      break;
    case "checks_pending":
      title = "검사가 끝나길 기다린다";
      text = prLine(action.pr);
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "open_review":
      title = "결과를 본다";
      text = prLine(action.pr);
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
  }
  const reviewing = "pr" in action;
  const preview = "pr" in action ? previews.get(action.pr.key) : undefined;
  return (
    <section className="next-action" aria-label="Next action" data-testid="next-action" data-kind={action.kind}>
      <p className="eyebrow">Next action</p>
      <h3>{title}</h3>
      {text !== null && <p className="next-text">{text}</p>}
      {reviewing && !hostOnline && (
        <p className="host-offline" data-testid="host-offline-note">
          <Icon name="off" />
          {PREVIEW_HOST_OFFLINE}
        </p>
      )}
      {reviewing && hostOnline && preview !== undefined && (
        <p className="next-preview">
          Preview · <PreviewStatus view={preview} />
        </p>
      )}
      {primary}
    </section>
  );
}

/** Work details (Q6) — 속성, 상태, "Link a PR"(표식 · Copy). 휴대전화 폭에서는 Details 로 접힌다 */
export function WorkDetails({
  summary,
  projectName,
  primary,
  previews,
  open,
}: {
  summary: WorkSummaryView;
  projectName: string;
  primary: PrCardView | null;
  previews: ReadonlyMap<string, PreviewCardView>;
  /** 휴대전화 폭에서 속성을 펼쳤나 (?details=1). 넓은 화면에서는 늘 펼쳐 보인다 */
  open: boolean;
}) {
  const { work, prs, marker } = summary;
  const decision = primary === null ? null : currentDecisionOf(primary);
  const body = (
    <>
      <dl className="properties" data-testid="work-properties">
        <div className="property">
          <dt>Project</dt>
          <dd>{projectName}</dd>
        </div>
        <div className="property">
          <dt>Pull request</dt>
          <dd data-testid="prop-prs">
            {prs.length === 0
              ? "Not linked"
              : prs.map((p) => (
                  <span key={p.key} className="pr-ref">
                    {p.repoName}#{p.number}
                  </span>
                ))}
          </dd>
        </div>
        {primary !== null && (
          <>
            <div className="property">
              <dt>Commit</dt>
              <dd>
                <code>{shortSha(primary.headSha)}</code>
              </dd>
            </div>
            <div className="property">
              <dt>GitHub</dt>
              <dd>
                {githubLine(primary.github)}
              </dd>
            </div>
            <div className="property">
              <dt>Studio</dt>
              <dd>{decision === null ? NO_INTERNAL_REVIEW : `${VERDICT[decision.verdict]} · ${shortSha(decision.commitSha)}`}</dd>
            </div>
            {previews.get(primary.key) !== undefined && previewSummary(previews.get(primary.key)).tone !== "quiet" && (
              <div className="property">
                <dt>Preview</dt>
                <dd>
                  <PreviewStatus view={previews.get(primary.key)} />
                </dd>
              </div>
            )}
          </>
        )}
      </dl>
      <WorkStatusPanel summary={summary} />
      <details className="link-pr" id="link-pr" open={prs.length === 0}>
        <summary>Link a PR</summary>
        <div className="marker">
          <code id="work-marker" data-testid="work-marker" title={MARKER_HINT}>
            {marker}
          </code>
          <CopyButton text={marker} targetId="work-marker" />
        </div>
        {prs.length > 0 && (
          <ul className="link-list">
            {prs.map((p) => (
              <li key={p.key}>
                {p.repoName}#{p.number} · <span data-testid="link-origin-summary">{linkLabel(p.studio.linkOrigin, p.studio.markerFoundIn)}</span>
              </li>
            ))}
          </ul>
        )}
      </details>
    </>
  );
  const path = `/works/${encodeURIComponent(work.id)}`;
  return (
    <section className={open ? "work-details open" : "work-details"} aria-label="Work details" data-testid="work-details">
      <h2 className="details-title desk-only">Work details</h2>
      {/* 휴대전화 폭: 속성은 Details 로 접는다 — 같은 주소를 ?details=1 로 다시 그려 펼친다(자바스크립트 없이 동작한다) */}
      <a className="details-toggle mobile-only" href={open ? path : `${path}?details=1#work-details`} data-testid="details-toggle">
        <Icon name="info" />
        {open ? "Hide details" : "Details"}
      </a>
      <div className="details-body" id="work-details">
        {body}
      </div>
    </section>
  );
}

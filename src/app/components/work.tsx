import type { ReactNode } from "react";
import type { NextAction } from "../../application/focus";
import type { PreviewCardView } from "../../application/preview";
import type { WorkSummaryView } from "../../application/queries";
import { MAX_WORK_GOAL_LENGTH } from "../../domain/work-goal";
import type { Work } from "../../domain/model";
import { markDoneAction, setGoalAction } from "../actions";
import { CopyButton } from "./copy-button";
import { Icon } from "./glyph";
import { allSameRepo, DONE_CANDIDATE_NOTE, MARKER_HINT, prRef, shortSha } from "./labels";
import { PrIcons } from "./pr-icons";
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

/**
 * Next action 카드 (Q6). 상황마다 제목 · 주 버튼 하나. 규칙 설명은 두지 않는다(결정 18).
 * PR 을 두고 결정하는 상황에서는 **결정의 대상인 커밋**을 크게 한 번 보인다(서명 — 결정 18 "본 커밋으로 결정한다") 그 아래 `#12` 와 아이콘 줄 (결정 19).
 * 미리보기 기기가 꺼져 있다는 것은 아이콘 줄의 회색 칸과 사이드바 한 곳이 말한다 — 여기에 문장을 되풀이하지 않는다.
 */
export function NextActionCard({
  action,
  work,
  marker,
  previews,
  sameRepo,
}: {
  action: NextAction;
  work: Work;
  marker: string;
  previews: ReadonlyMap<string, PreviewCardView>;
  /** 이 업무의 PR 이 모두 같은 저장소인가 (그러면 `#12` 로만 적는다) */
  sameRepo: boolean;
}) {
  const path = `/works/${encodeURIComponent(work.id)}`;
  const button = (href: string, label: string, testid = "next-action-button") => (
    <a className="btn accent wide" href={href} data-testid={testid}>
      {label}
      <Icon name="arrow" />
    </a>
  );
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
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "outdated_preview":
      title = "미리보기를 최신 커밋으로 다시 연다";
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "checks_failing":
      title = "검사 실패 — 작성자가 고칠 차례";
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
      primary = button(reviewHref(work.id, action.pr), "View decision");
      break;
    case "await_merge":
      title = "GitHub 병합을 기다린다";
      primary = button(reviewHref(work.id, action.pr), "View decision");
      break;
    case "checks_pending":
      title = "검사가 끝나길 기다린다";
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
    case "open_review":
      title = "결과를 본다";
      primary = button(reviewHref(work.id, action.pr), "Open review");
      break;
  }
  const reviewing = "pr" in action;
  return (
    <section className="next-action" aria-label="Next action" data-testid="next-action" data-kind={action.kind}>
      <p className="eyebrow">Next action</p>
      <h3>{title}</h3>
      {reviewing && (
        <>
          <code className="sha-big" data-testid="next-action-sha" title={action.pr.headSha}>
            {shortSha(action.pr.headSha)}
          </code>
          <p className="sha-line" data-testid="next-action-pr">
            <span className="pr-no">{prRef(action.pr.repoName, action.pr.number, sameRepo)}</span>{" "}
            <PrIcons github={action.pr.github} preview={previews.get(action.pr.key)} />
          </p>
        </>
      )}
      {text !== null && <p className="next-text">{text}</p>}
      {primary}
    </section>
  );
}

/**
 * Work path — Brief · Build · Review · Done 네 점 (Focus 시안). 실제 상태로만 채운다:
 * draft = Brief, in_progress(PR 연결) = Build, needs_review = Review, done_candidate = Review 끝 · Done 대기, done = Done.
 */
const PATH_STEPS = ["Brief", "Build", "Review", "Done"] as const;
const PATH_INDEX: Record<Work["status"], number> = { draft: 0, in_progress: 1, needs_review: 2, done_candidate: 3, done: 4 };

export function WorkPath({ status }: { status: Work["status"] }) {
  const at = PATH_INDEX[status];
  const state = (i: number) => (i < at ? "complete" : i === at ? "current" : "");
  const dots: ReactNode[] = [];
  PATH_STEPS.forEach((step, i) => {
    if (i > 0) dots.push(<i key={`line-${i}`} className={i <= at ? "complete" : ""} />);
    dots.push(<span key={step} className={state(i)} />);
  });
  return (
    <div className="work-path" data-testid="work-path" data-step={at >= PATH_STEPS.length ? "done" : PATH_STEPS[at]!.toLowerCase()} aria-label="Work path">
      <div className="path-steps" aria-hidden="true">
        {dots}
      </div>
      <div className="path-caption">
        {PATH_STEPS.map((step, i) => (
          <span key={step} className={state(i)}>
            {step}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Work details (Q6, 결정 19) — Project · Pull requests(PR 마다 `#12 제목` 과 세 칸 아이콘 줄, 누르면 그 PR 의 Review 패널) · Work path · 상태 · Link a PR(표식 · Copy).
 * 커밋 · GitHub · Studio · Preview 행은 두지 않는다 — 같은 사실이 Next action 과 카드의 아이콘 줄에 이미 있다. 휴대전화 폭에서는 Details 로 접힌다.
 */
export function WorkDetails({
  summary,
  projectName,
  open,
}: {
  summary: WorkSummaryView;
  projectName: string;
  /** 휴대전화 폭에서 속성을 펼쳤나 (?details=1). 넓은 화면에서는 늘 펼쳐 보인다 */
  open: boolean;
}) {
  const { work, prs, marker } = summary;
  const sameRepo = allSameRepo(prs.map((p) => p.repoName));
  const body = (
    <>
      <dl className="properties" data-testid="work-properties">
        <div className="property">
          <dt>Project</dt>
          <dd>{projectName}</dd>
        </div>
        <div className="property stack">
          <dt>Pull requests</dt>
          <dd className="pr-list" data-testid="prop-prs">
            {prs.length === 0
              ? "Not linked"
              : prs.map((p) => (
                  <a key={p.key} className="pr-line" href={reviewHref(work.id, p)} data-testid={`prop-pr-${p.repoId}-${p.number}`}>
                    <span className="pr-no">{prRef(p.repoName, p.number, sameRepo)}</span>
                    <span className="t">{p.title}</span>
                    <PrIcons github={p.github} withPreview={false} />
                  </a>
                ))}
          </dd>
        </div>
      </dl>
      <WorkPath status={work.status} />
      <WorkStatusPanel summary={summary} />
      <details className="link-pr" id="link-pr" open={prs.length === 0}>
        <summary>
          <Icon name="chevron" />
          Link a PR
        </summary>
        <div className="marker">
          <code id="work-marker" data-testid="work-marker" title={MARKER_HINT}>
            {marker}
          </code>
          <CopyButton text={marker} targetId="work-marker" />
        </div>
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

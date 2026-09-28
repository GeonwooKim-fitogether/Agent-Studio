import type { ReactNode } from "react";
import type { FlowView } from "../../application/flow";
import type { PreviewCardView } from "../../application/preview";
import { FLOW_STEP_NAMES, FLOW_STEPS, type FlowStep } from "../../domain/work-path";
import { DemoTag } from "./demo";
import { kstMonthDay, prRef, REVIEW_BUTTON } from "./labels";
import { PrIcons } from "./pr-icons";
import { reviewHref } from "./work";

/**
 * Flow 화면의 조각들 (결정 20 — Demo). 읽기 전용 흐름도다: 끌기 · 노드 더하기 · Run 이 없다(결정 2 · 7).
 * 네 노드의 상태는 workPathOf 하나에서 오고(Work details 의 Work path 와 같다), 노드를 누르면 같은 주소를 ?node= 로 다시 그려
 * 오른쪽(휴대전화는 아래) 설명 칸을 바꾼다 — 자바스크립트 없이 동작한다.
 */

export function isFlowStep(value: unknown): value is FlowStep {
  return typeof value === "string" && (FLOW_STEPS as readonly string[]).includes(value);
}

const flowHref = (workId: string, step: FlowStep) => `/works/${encodeURIComponent(workId)}/flow?node=${step}#step`;

function Node({
  flow,
  step,
  selected,
  who,
  hasRecord,
  children,
}: {
  flow: FlowView;
  step: FlowStep;
  selected: boolean;
  who: ReactNode;
  /** 이 단계에 이미 기록이 있나 — 없는 대기 단계는 점선이다 */
  hasRecord: boolean;
  children: ReactNode;
}) {
  const state = flow.path.steps[step];
  const cls = ["fnode", selected ? "selected" : "", state === "todo" && !hasRecord ? "dashed" : ""].filter(Boolean).join(" ");
  return (
    <a
      className={cls}
      href={flowHref(flow.work.id, step)}
      aria-current={selected ? "true" : undefined}
      data-testid={`flow-node-${step}`}
      data-state={state}
    >
      <span className="fnode-top">
        <span className="num">0{FLOW_STEPS.indexOf(step) + 1}</span>
        <b>{FLOW_STEP_NAMES[step]}</b>
        {state === "current" && <span className="now-tag">지금</span>}
        {state === "done" && <span className="sr-only">끝남</span>}
      </span>
      <span className="who">{who}</span>
      <span className="state">{children}</span>
    </a>
  );
}

const dot = (state: "done" | "current" | "todo" | "studio") => <i className={`pdot ${state === "todo" ? "" : state}`} aria-hidden="true" />;

/** 흐름도 — Goal → Build → Review → Finish on GitHub. Request changes 고리와 Approve in Studio 선은 지나간 적이 있으면 실선이다 */
export function FlowCanvas({ flow, selected, preview }: { flow: FlowView; selected: FlowStep; preview: PreviewCardView | undefined }) {
  const { work, path, buildPr, buildAgent } = flow;
  const sameRepo = new Set(flow.prs.map((p) => p.repoName)).size <= 1;
  const stateDot = (step: FlowStep) => dot(path.steps[step]);
  return (
    <section className="flow-canvas" aria-label="Flow" data-testid="flow-canvas">
      <p className="canvas-note">읽기 전용 · 단계의 상태는 이 업무의 실제 기록에서 온다</p>
      <div className="flow-col">
        <Node flow={flow} step="goal" selected={selected === "goal"} who="사람" hasRecord={work.goal !== ""}>
          {stateDot("goal")}
          {work.goal === "" ? "목표 없음" : <span className="goal-line">{work.goal}</span>}
        </Node>
        <div className="fedge" aria-hidden="true" />
        <div className="loop-span">
          <Node
            flow={flow}
            step="build"
            selected={selected === "build"}
            who={
              <>
                Agent {buildAgent?.name ?? "없음"}
                <DemoTag />
              </>
            }
            hasRecord={buildPr !== null}
          >
            {stateDot("build")}
            {buildPr === null ? (
              "PR 없음"
            ) : (
              <>
                <span className="pr-no" data-testid="flow-build-pr">
                  {prRef(buildPr.repoName, buildPr.number, sameRepo)}
                </span>
                <PrIcons github={buildPr.github} preview={preview} />
              </>
            )}
          </Node>
          <div className="fedge long" aria-hidden="true" />
          <Node flow={flow} step="review" selected={selected === "review"} who="사람 · Studio decision" hasRecord={path.decision !== null}>
            {path.decision === null ? (
              <>
                {stateDot("review")}
                결정 없음
              </>
            ) : (
              <>
                {dot("studio")}
                <b data-testid="flow-review-decision">{REVIEW_BUTTON[path.decision.verdict]}</b>
                {!path.decision.onLatestCommit && (
                  <span className="old-tag" data-testid="flow-review-old">
                    이전 커밋
                  </span>
                )}
                <span className="when">{kstMonthDay(path.decision.decidedAt)}</span>
              </>
            )}
          </Node>
          <div className={path.requestedChanges ? "floop" : "floop dashed"} aria-hidden="true" data-testid="flow-loop" data-passed={path.requestedChanges}>
            <span className="elabel">Request changes</span>
          </div>
        </div>
        <div className={path.approved ? "fedge long" : "fedge long dashed"} aria-hidden="true" data-testid="flow-approve" data-passed={path.approved}>
          <span className="elabel">Approve in Studio</span>
        </div>
        <Node flow={flow} step="finish" selected={selected === "finish"} who="공식 리뷰 · 병합은 GitHub" hasRecord={path.merged}>
          {stateDot("finish")}
          {path.merged ? "병합됨" : "대기"}
        </Node>
      </div>
    </section>
  );
}

function Property({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="property">
      <dt>{name}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** 고른 단계의 설명 칸 — Owner · (Build 는 Agent) · Input · Output 과 버튼 하나. 버튼은 이미 있는 화면으로 가는 링크뿐이다 */
export function FlowInspector({ flow, selected }: { flow: FlowView; selected: FlowStep }) {
  const { work, path, buildPr, buildAgent } = flow;
  const workPath = `/works/${encodeURIComponent(work.id)}`;
  const sameRepo = new Set(flow.prs.map((p) => p.repoName)).size <= 1;
  const prName = buildPr === null ? null : `PR ${prRef(buildPr.repoName, buildPr.number, sameRepo)}`;
  let lead: string;
  let rows: ReactNode;
  let action: ReactNode = null;
  switch (selected) {
    case "goal":
      lead = "사람이 적는 이 업무의 목표. Build 가 받는 첫 입력이다.";
      rows = (
        <>
          <Property name="Owner">사람</Property>
          <Property name="Input">업무를 만든 사람이 적는 글</Property>
          <Property name="Output">Build 에 전달되는 목표</Property>
        </>
      );
      action = (
        <a className="btn small" href={`${workPath}?goal=edit#goal`} data-testid="flow-action">
          {work.goal === "" ? "Set goal" : "Edit goal"}
        </a>
      );
      break;
    case "build":
      lead = "목표와 수정 기준을 받아 PR 에 커밋을 올리는 단계.";
      rows = (
        <>
          <Property name="Owner">PR 작성자 — 지금은 Studio 밖에서 커밋한다</Property>
          <Property name="Agent">
            {buildAgent?.name ?? "없음"}
            <DemoTag />
          </Property>
          <Property name="Input">목표, 마지막 Request changes 의 이유와 수정 기준</Property>
          <Property name="Output">{prName === null ? "연결될 PR 의 새 커밋" : `${prName} 의 새 커밋`}</Property>
        </>
      );
      action = (
        <a className="btn small" href={buildAgent === undefined ? "/agents" : `/agents?agent=${encodeURIComponent(buildAgent.id)}`} data-testid="flow-action">
          Open in Agents
        </a>
      );
      break;
    case "review":
      lead = "사람이 최신 커밋을 보고 Studio 에 결정을 남긴다. GitHub 리뷰가 아니다.";
      rows = (
        <>
          <Property name="Owner">사람</Property>
          <Property name="Input">{prName === null ? "연결된 PR 의 최신 커밋" : `${prName} 의 최신 커밋 — Next action 이 가리키는 커밋`}</Property>
          <Property name="Output">Approve in Studio 는 Finish 로, Request changes 는 이유 · 수정 기준과 함께 Build 로</Property>
        </>
      );
      action =
        buildPr === null ? null : (
          <a className="btn small" href={reviewHref(work.id, buildPr)} data-testid="flow-action">
            Open review
          </a>
        );
      break;
    case "finish":
      lead = "공식 리뷰와 병합은 GitHub 에서 한다. Studio 는 병합하지 않고 그 상태를 비춘다.";
      rows = (
        <>
          <Property name="Owner">사람 · GitHub</Property>
          <Property name="Input">Approve in Studio 를 받은 커밋</Property>
          <Property name="Output">GitHub 의 리뷰 · 병합</Property>
        </>
      );
      break;
  }
  return (
    <aside className="flow-inspector" aria-label="Selected step" id="step" data-testid="flow-inspector" data-step={selected}>
      <section className="insp">
        <p className="eyebrow">Step 0{FLOW_STEPS.indexOf(selected) + 1}</p>
        <h2>{FLOW_STEP_NAMES[selected]}</h2>
        <p className="lead">{lead}</p>
        <dl className="properties">{rows}</dl>
        {action !== null && <div className="actions">{action}</div>}
        {path.current === null && selected === "finish" && <p className="why">이 업무의 단계는 모두 지나갔다.</p>}
      </section>
    </aside>
  );
}

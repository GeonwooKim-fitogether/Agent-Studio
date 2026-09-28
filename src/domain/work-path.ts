/**
 * 업무의 단계 — Goal · Build · Review · Finish on GitHub (결정 20). 업무 화면 Work details 의 Work path 와 Flow 화면의 네 노드가
 * **이 함수 하나**에서 상태를 받는다. 같은 사실을 두 화면이 다르게 말하지 않게 하려는 것이다.
 * 순수 규칙만 있다. 저장소 · 화면을 모른다. 이 규칙은 아무것도 실행하지 않는다 — 이미 있는 기록(목표 · PR · 검토 결정)을 읽을 뿐이다.
 *
 * 단계의 뜻
 *   goal    사람이 적는 목표. 목표가 **있을 때만** 끝난 것으로 친다(다른 단계가 끝나도 목표가 비어 있으면 끝나지 않았다)
 *   build   PR 에 커밋이 올라오는 단계. 지금은 PR 작성자가 Studio 밖에서 커밋한다
 *   review  사람이 최신 커밋을 보고 Studio 에 결정(Approve in Studio · Request changes)을 남기는 단계
 *   finish  GitHub 의 공식 리뷰 · 병합. Studio 는 병합하지 않고 그 상태를 비춘다
 *
 * 어느 PR 을 보나 — 업무의 **최신 PR**: 열린 PR 이 있으면 주어진 순서의 첫 열린 PR, 없으면 주어진 순서의 마지막 PR.
 *
 * 지금 단계 (앞선 것이 이긴다)
 *   1. 업무가 완료(done)이거나 그 PR 이 병합됐다 → 없음(모두 지나감)
 *   2. 그 PR 의 최신 커밋에 Approve in Studio 가 있다 → finish
 *   3. 목표도 PR 도 없다 → goal
 *   4. PR 이 없다 · 닫혔다 · 검사가 실패했다 · 최신 커밋에 Request changes 가 있다 → build (작성자가 커밋할 차례)
 *   5. 그 밖 → review (사람이 볼 차례)
 * 지금 단계보다 앞의 build · review · finish 는 끝남, 뒤는 대기다. goal 은 위 규칙과 따로 목표가 있는지로만 정한다(3 일 때만 지금).
 */
import type { ChecksState, PrState, ReviewVerdict, WorkStatus } from "./model";

export const FLOW_STEPS = ["goal", "build", "review", "finish"] as const;
export type FlowStep = (typeof FLOW_STEPS)[number];

/** 화면에 보이는 단계 이름 (버튼 · 기능 이름은 영어, 결정 2) */
export const FLOW_STEP_NAMES: Readonly<Record<FlowStep, string>> = {
  goal: "Goal",
  build: "Build",
  review: "Review",
  finish: "Finish on GitHub",
};

export type StepState = "done" | "current" | "todo";

/**
 * Build 단계에 이름을 붙여 둔 Agent 초안의 ID (Demo). 지금은 Build 노드가 늘 이 초안을 가리킨다 —
 * 단계마다 Agent 를 고르는 기능은 실행이 연결될 때(3단계) 붙는다.
 */
export const BUILD_STEP_AGENT_ID = "builder";

/** 이 규칙이 읽는 PR 의 모습 — GitHub 가 알려 준 것 */
export interface PathPr {
  readonly repoId: number;
  readonly number: number;
  readonly headSha: string;
  readonly state: PrState;
  readonly checks: ChecksState;
}

/** 이 규칙이 읽는 검토 결정 — Studio 가 남긴 것 */
export interface PathDecision {
  readonly repoId: number;
  readonly number: number;
  readonly commitSha: string;
  readonly verdict: ReviewVerdict;
  readonly decidedAt: string;
}

export interface WorkPath {
  readonly steps: Readonly<Record<FlowStep, StepState>>;
  /** 지금 단계. 모두 지나갔으면 null */
  readonly current: FlowStep | null;
  /** 업무의 최신 PR. 연결된 PR 이 없으면 null */
  readonly pr: PathPr | null;
  /** 그 PR 의 마지막 결정. onLatestCommit 이 false 면 이전 커밋에 대한 결정이다 */
  readonly decision: (PathDecision & { readonly onLatestCommit: boolean }) | null;
  /** 그 PR 이 GitHub 에서 병합됐다 */
  readonly merged: boolean;
  /** 이 업무에 Request changes 가 한 번이라도 있었다 — Review 에서 Build 로 되돌아가는 고리를 지나간 적이 있다 */
  readonly requestedChanges: boolean;
  /** 이 업무에 Approve in Studio 가 한 번이라도 있었다 — Review 에서 Finish 로 가는 선을 지나간 적이 있다 */
  readonly approved: boolean;
}

const LATER: readonly FlowStep[] = ["build", "review", "finish"];

export function workPathOf(
  work: { readonly goal: string; readonly status: WorkStatus },
  prs: readonly PathPr[],
  decisions: readonly PathDecision[],
): WorkPath {
  const pr = prs.find((p) => p.state === "open") ?? prs.at(-1) ?? null;
  const own =
    pr === null
      ? []
      : decisions
          .filter((d) => d.repoId === pr.repoId && d.number === pr.number)
          .map((d, i) => ({ d, i }))
          .sort((a, b) => a.d.decidedAt.localeCompare(b.d.decidedAt) || a.i - b.i)
          .map(({ d }) => d);
  const last = own.at(-1);
  const decision = pr === null || last === undefined ? null : { ...last, onLatestCommit: last.commitSha === pr.headSha };
  const merged = pr?.state === "merged";
  const goalSet = work.goal !== "";

  let current: FlowStep | null;
  if (work.status === "done" || merged) current = null;
  else if (decision !== null && decision.onLatestCommit && decision.verdict === "internal_review_done") current = "finish";
  else if (!goalSet && pr === null) current = "goal";
  else if (
    pr === null ||
    pr.state !== "open" ||
    pr.checks === "failing" ||
    (decision !== null && decision.onLatestCommit && decision.verdict === "changes_requested")
  ) {
    current = "build";
  } else current = "review";

  const at = current === null ? LATER.length : current === "goal" ? -1 : LATER.indexOf(current);
  const later = (i: number): StepState => (i < at ? "done" : i === at ? "current" : "todo");
  return {
    steps: {
      goal: current === "goal" ? "current" : goalSet ? "done" : "todo",
      build: later(0),
      review: later(1),
      finish: later(2),
    },
    current,
    pr,
    decision,
    merged,
    requestedChanges: decisions.some((d) => d.verdict === "changes_requested"),
    approved: decisions.some((d) => d.verdict === "internal_review_done"),
  };
}

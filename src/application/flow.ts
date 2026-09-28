/**
 * Flow 화면과 Work path 의 읽기 (결정 20 — Flow 는 Demo). 업무의 네 단계(Goal · Build · Review · Finish on GitHub)는
 * src/domain/work-path.ts 의 workPathOf 하나가 정한다. 이 파일은 화면이 읽는 모양(PR 카드)을 그 함수의 입력으로 옮길 뿐이다.
 * 아무것도 실행하지 않는다 — Flow 는 기록을 보여 줄 뿐이다.
 */
import type { AgentDraft } from "../domain/agent-draft";
import { BUILD_STEP_AGENT_ID, workPathOf, type WorkPath } from "../domain/work-path";
import type { AppDeps } from "./deps";
import { getWorkDetail, pickChatWork, type PrCardView, type WorkDetailView, type WorkSummaryView } from "./queries";

/** 업무 요약에서 네 단계의 상태를 얻는다. Work details 의 Work path 와 Flow 가 둘 다 이것을 부른다 */
export function workPathOfSummary(summary: Pick<WorkSummaryView, "work" | "prs">): WorkPath {
  return workPathOf(
    summary.work,
    summary.prs.map((p) => ({ repoId: p.repoId, number: p.number, headSha: p.headSha, state: p.github.state, checks: p.github.checks })),
    summary.prs.flatMap((p) =>
      p.studio.reviews.map((r) => ({ repoId: p.repoId, number: p.number, commitSha: r.commitSha, verdict: r.verdict, decidedAt: r.at })),
    ),
  );
}

export interface FlowView extends WorkDetailView {
  readonly path: WorkPath;
  /** Build 노드의 PR 카드 (업무의 최신 PR). 없으면 null */
  readonly buildPr: PrCardView | null;
  /** Build 노드가 가리키는 Agent 초안 (Demo). 없으면 undefined */
  readonly buildAgent: AgentDraft | undefined;
}

export async function getFlow(deps: Pick<AppDeps, "store">, workId: string): Promise<FlowView | undefined> {
  const detail = await getWorkDetail(deps, workId);
  if (detail === undefined) return undefined;
  const path = workPathOfSummary(detail);
  const buildPr = path.pr === null ? null : (detail.prs.find((p) => p.repoId === path.pr!.repoId && p.number === path.pr!.number) ?? null);
  return { ...detail, path, buildPr, buildAgent: await deps.store.getAgentDraft(BUILD_STEP_AGENT_ID) };
}

/**
 * Agent 초안이 Flow 에서 쓰이는 곳 — 지금은 Build 노드가 늘 Builder 초안을 가리키므로, Builder 에게만 업무 하나를 돌려준다.
 * 어느 업무인가는 메뉴의 Flow 와 같은 규칙이다(마지막으로 연 업무, 없으면 Workspace 의 첫 업무). 업무가 없으면 null.
 */
export async function flowUsageOf(
  deps: Pick<AppDeps, "store">,
  agentId: string,
  remembered: string | null,
): Promise<{ readonly workId: string; readonly workTitle: string } | null> {
  if (agentId !== BUILD_STEP_AGENT_ID) return null;
  const workId = await pickChatWork(deps, remembered);
  if (workId === null) return null;
  const work = await deps.store.getWork(workId);
  return work === undefined ? null : { workId, workTitle: work.title };
}

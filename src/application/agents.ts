/**
 * Agents 화면의 유스케이스 (결정 20 — Demo). Agent 초안을 만들고 고친다. Studio 의 저장소에만 쓰고, 아무것도 실행하지 않는다 —
 * 지시문은 저장만 되고 아직 AI 에게 가지 않는다(실행 · 모델 연결은 3단계, 결정 5 · 7).
 * 규칙에 걸리면 던지지 않고 칸마다의 이유(problems)를 돌려준다. 화면은 그 칸 옆에 한 줄씩 보인다.
 */
import { type AgentDraft, type AgentDraftProblems, checkAgentDraft } from "../domain/agent-draft";
import { StudioError } from "../domain/model";
import type { AppDeps } from "./deps";

export type AgentResult =
  | { readonly ok: true; readonly agent: AgentDraft }
  | { readonly ok: false; readonly problems: AgentDraftProblems }
  | { readonly ok: false; readonly problems?: undefined; readonly missing: true };

export async function listAgents(deps: Pick<AppDeps, "store">): Promise<AgentDraft[]> {
  return deps.store.listAgentDrafts();
}

/** Add Agent — 이름만 받아 빈 초안을 만든다. 소개 · 지시문 · Skill 은 편집 칸에서 적는다 */
export async function addAgent(deps: Pick<AppDeps, "store" | "now" | "newId">, input: { readonly name: string }): Promise<AgentResult> {
  const checked = checkAgentDraft({ name: input.name, summary: "", instructions: "", skills: [] });
  if (!checked.ok) return { ok: false, problems: checked.problems };
  const at = deps.now().toISOString();
  const agent: AgentDraft = { id: deps.newId(), ...checked.fields, createdAt: at, updatedAt: at };
  await deps.store.createAgentDraft(agent);
  return { ok: true, agent };
}

/** Save draft — 칸 넷(이름 · 소개 · 지시문 · Skill)을 고친다. 모델 칸은 없다(연결된 모델이 없으므로 저장하지 않는다) */
export async function saveAgent(
  deps: Pick<AppDeps, "store" | "now">,
  input: { readonly id: string; readonly name: string; readonly summary: string; readonly instructions: string; readonly skills: readonly string[] },
): Promise<AgentResult> {
  const checked = checkAgentDraft(input);
  if (!checked.ok) return { ok: false, problems: checked.problems };
  try {
    await deps.store.saveAgentDraft({ id: input.id, ...checked.fields, updatedAt: deps.now().toISOString() });
  } catch (error) {
    if (error instanceof StudioError && (error.code === "not_found" || error.code === "invalid_input")) return { ok: false, missing: true };
    throw error;
  }
  const agent = await deps.store.getAgentDraft(input.id);
  return agent === undefined ? { ok: false, missing: true } : { ok: true, agent };
}

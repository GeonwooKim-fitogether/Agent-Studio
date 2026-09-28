/**
 * 업무의 목표를 적거나 고친다 (결정 18 — 업무 화면의 Set goal · Edit goal). Studio 의 저장소에만 쓰고 GitHub 에는 아무것도 보내지 않는다.
 * 규칙에 걸리면 던지지 않고 이유(problem)를 돌려준다. 화면은 이 코드로 문장을 고른다.
 */
import { StudioError, type Work } from "../domain/model";
import { checkWorkGoal, type WorkGoalProblem } from "../domain/work-goal";
import type { AppDeps } from "./deps";

export type SetGoalProblem = WorkGoalProblem | "no_work";

export type SetGoalResult = { readonly ok: true; readonly work: Work } | { readonly ok: false; readonly problem: SetGoalProblem };

export async function setWorkGoal(deps: Pick<AppDeps, "store">, input: { readonly workId: string; readonly goal: string }): Promise<SetGoalResult> {
  const checked = checkWorkGoal(input.goal);
  if (!checked.ok) return checked;
  try {
    await deps.store.setWorkGoal({ workId: input.workId, goal: checked.goal });
  } catch (error) {
    if (error instanceof StudioError && error.code === "not_found") return { ok: false, problem: "no_work" };
    throw error;
  }
  const work = await deps.store.getWork(input.workId);
  if (work === undefined) return { ok: false, problem: "no_work" };
  return { ok: true, work };
}

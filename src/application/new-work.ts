/**
 * Workspace 의 New Work (feature-plan F5) — PR 없이 빈 업무(Draft)를 만들고 표식을 돌려준다.
 *
 * 사용자는 그 표식(`studio-work-<ID>`)을 Claude 에게 주는 지시나 PR 본문 · 브랜치 이름에 넣는다.
 * 그 PR 은 다음 Sync 에서 계약 §4 의 자동 연결 규칙으로 이 업무에 붙는다 — 이 파일은 연결에 관여하지 않는다.
 * Studio 의 저장소에만 쓰고 GitHub 에는 아무것도 보내지 않는다.
 */
import { StudioError, type Work } from "../domain/model";
import { markerFor } from "../domain/work-marker";
import { checkWorkTitle, type WorkTitleProblem } from "../domain/work-title";
import type { AppDeps } from "./deps";
import { newUniqueWorkId } from "./inbox-actions";

/** 빈 업무를 만들지 않은 이유. 화면은 이 코드로 문장을 고른다 */
export type NewWorkProblem = WorkTitleProblem | "no_project";

export type NewWorkResult =
  | { readonly ok: true; readonly work: Work; readonly marker: string }
  | { readonly ok: false; readonly problem: NewWorkProblem };

export async function createEmptyWork(
  deps: AppDeps,
  input: { readonly projectId: string; readonly title: string },
): Promise<NewWorkResult> {
  const checked = checkWorkTitle(input.title);
  if (!checked.ok) return checked;
  const projects = await deps.store.listProjects();
  if (!projects.some((p) => p.id === input.projectId)) return { ok: false, problem: "no_project" };

  const work: Work = {
    id: await newUniqueWorkId(deps),
    projectId: input.projectId,
    title: checked.title,
    status: "draft",
    createdAt: deps.now().toISOString(),
  };
  try {
    await deps.store.createWork(work);
  } catch (error) {
    // 확인과 쓰기 사이에 프로젝트가 사라진 경우. 다른 오류는 그대로 던진다
    if (error instanceof StudioError && error.code === "not_found") return { ok: false, problem: "no_project" };
    throw error;
  }
  return { ok: true, work, marker: markerFor(work.id) };
}

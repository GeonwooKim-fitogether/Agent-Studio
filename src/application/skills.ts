/**
 * Skills 탭의 유스케이스 (결정 21 — Demo). 사용자 Skill 초안을 만들고 고친다. Studio 의 저장소에만 쓰고, 아무것도 실행하지 않는다 —
 * Skill 은 저장만 되고 아직 AI 에게 가지 않는다(실행 · 모델 연결은 3단계, 결정 5 · 7). 기본 Skill 둘은 코드에 고정돼 있어 고치지 않는다.
 * 규칙에 걸리면 던지지 않고 칸마다의 이유(problems)를 돌려준다. 화면은 그 칸 옆에 한 줄씩 보인다.
 */
import { StudioError } from "../domain/model";
import { checkSkillDraft, isBuiltInSkillId, newSkillName, type SkillDraft, type SkillDraftProblems } from "../domain/skill-draft";
import type { AppDeps } from "./deps";

export type SkillResult =
  | { readonly ok: true; readonly skill: SkillDraft }
  | { readonly ok: false; readonly problems: SkillDraftProblems }
  | { readonly ok: false; readonly problems?: undefined; readonly missing: true };

export async function listSkillDrafts(deps: Pick<AppDeps, "store">): Promise<SkillDraft[]> {
  return deps.store.listSkillDrafts();
}

const isDuplicate = (error: unknown) => error instanceof StudioError && error.code === "duplicate_name";

/**
 * New Skill — 이름을 묻지 않고 "새 Skill" 초안을 만든다(시안대로). 같은 이름이 있으면 "새 Skill 2" 처럼 번호를 붙인다.
 * 그사이 다른 요청이 같은 이름을 가져갔으면 다음 번호로 몇 번 더 해 본다.
 */
export async function addSkill(deps: Pick<AppDeps, "store" | "now" | "newId">): Promise<SkillDraft> {
  for (let attempt = 0; ; attempt++) {
    const at = deps.now().toISOString();
    const skill: SkillDraft = { id: deps.newId(), name: newSkillName(await deps.store.listSkillDrafts()), summary: "", instructions: "", createdAt: at, updatedAt: at };
    try {
      await deps.store.createSkillDraft(skill);
      return skill;
    } catch (error) {
      if (!isDuplicate(error) || attempt >= 2) throw error;
    }
  }
}

/** Save draft — 칸 셋(이름 · 소개 · 지시문)을 고친다. 기본 Skill 은 저장소에 없으므로 missing 이다 */
export async function saveSkill(
  deps: Pick<AppDeps, "store" | "now">,
  input: { readonly id: string; readonly name: string; readonly summary: string; readonly instructions: string },
): Promise<SkillResult> {
  if (isBuiltInSkillId(input.id)) return { ok: false, missing: true }; // 기본 Skill 은 고칠 수 없다
  const others = (await deps.store.listSkillDrafts()).filter((d) => d.id !== input.id);
  const checked = checkSkillDraft(input, others);
  if (!checked.ok) return { ok: false, problems: checked.problems };
  try {
    await deps.store.saveSkillDraft({ id: input.id, ...checked.fields, updatedAt: deps.now().toISOString() });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, problems: { name: "duplicate" } };
    if (error instanceof StudioError && (error.code === "not_found" || error.code === "invalid_input")) return { ok: false, missing: true };
    throw error;
  }
  const skill = await deps.store.getSkillDraft(input.id);
  return skill === undefined ? { ok: false, missing: true } : { ok: true, skill };
}

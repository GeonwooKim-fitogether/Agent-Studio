/**
 * 업무 Chat 의 메모 쓰기 · 고치기 · 지우기 (feature-plan F8). Studio 의 저장소에만 쓰고, GitHub 에도 AI 에게도 아무것도 보내지 않는다.
 *
 * 본문 규칙은 src/domain/memo.ts, 저장소가 지키는 약속은 src/ports/studio-store.ts 에 있다.
 * 규칙에 걸리면 던지지 않고 이유(problem)를 돌려준다. 화면은 이 코드로 문장을 고른다.
 */
import { StudioError } from "../domain/model";
import { checkMemoBody, type Memo, MEMO_AUTHOR_ME, type MemoBodyProblem } from "../domain/memo";
import type { AppDeps } from "./deps";

/** 메모를 남기거나 고치지 않은 이유. no_memo 는 그 업무에 그 메모가 없거나 이미 지웠다는 뜻이다(오래된 화면) */
export type MemoProblem = MemoBodyProblem | "no_work" | "no_memo";

export type MemoResult = { readonly ok: true; readonly memo: Memo } | { readonly ok: false; readonly problem: MemoProblem };

export async function writeMemo(deps: AppDeps, input: { readonly workId: string; readonly body: string }): Promise<MemoResult> {
  const checked = checkMemoBody(input.body);
  if (!checked.ok) return checked;
  const now = deps.now();
  const memo: Memo = {
    // 같은 업무 ID 규칙(영문 소문자 · 숫자)의 조각에 시각을 붙여, 무작위 조각이 겹쳐도 ID 가 겹치지 않게 한다
    id: `m${now.getTime().toString(36)}${deps.newId()}`,
    workId: input.workId,
    author: MEMO_AUTHOR_ME,
    body: checked.body,
    createdAt: now.toISOString(),
    editedAt: null,
    deletedAt: null,
  };
  try {
    await deps.store.addMemo(memo);
  } catch (error) {
    if (error instanceof StudioError && error.code === "not_found") return { ok: false, problem: "no_work" };
    throw error;
  }
  return { ok: true, memo };
}

export async function editMemo(
  deps: AppDeps,
  input: { readonly workId: string; readonly id: string; readonly body: string },
): Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: MemoProblem }> {
  const checked = checkMemoBody(input.body);
  if (!checked.ok) return checked;
  try {
    await deps.store.editMemo({ workId: input.workId, id: input.id, body: checked.body, editedAt: deps.now().toISOString() });
  } catch (error) {
    // 본문은 위에서 이미 확인했으므로, 여기서의 거절은 메모가 없거나 지워졌다는 뜻이다
    if (error instanceof StudioError && (error.code === "not_found" || error.code === "invalid_input")) return { ok: false, problem: "no_memo" };
    throw error;
  }
  return { ok: true };
}

export async function deleteMemo(
  deps: AppDeps,
  input: { readonly workId: string; readonly id: string },
): Promise<{ readonly ok: true } | { readonly ok: false; readonly problem: "no_memo" }> {
  try {
    await deps.store.deleteMemo({ workId: input.workId, id: input.id, deletedAt: deps.now().toISOString() });
  } catch (error) {
    if (error instanceof StudioError && error.code === "not_found") return { ok: false, problem: "no_memo" };
    throw error;
  }
  return { ok: true };
}

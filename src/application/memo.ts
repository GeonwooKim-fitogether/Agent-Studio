/**
 * 업무 Chat 의 메모 쓰기 · 고치기 · 지우기 (feature-plan F8)와 답글 쓰기 (F9 스레드). 답글은 고치기 · 지우기가 메모와 같다. Studio 의 저장소에만 쓰고, GitHub 에도 AI 에게도 아무것도 보내지 않는다.
 *
 * 본문 규칙은 src/domain/memo.ts, 저장소가 지키는 약속은 src/ports/studio-store.ts 에 있다.
 * 규칙에 걸리면 던지지 않고 이유(problem)를 돌려준다. 화면은 이 코드로 문장을 고른다.
 */
import { StudioError } from "../domain/model";
import { checkMemoBody, type Memo, MEMO_AUTHOR_ME, type MemoBodyProblem, resolveThread, type ThreadTarget } from "../domain/memo";
import type { AppDeps } from "./deps";

/**
 * 메모를 남기거나 고치지 않은 이유. no_memo 는 그 업무에 그 메모가 없거나 이미 지웠다는 뜻이다(오래된 화면).
 * no_thread 는 답글을 달 스레드가 지금 열려 있지 않다는 뜻이다 — 대상 메모가 없거나 지워졌거나, PR 카드가 이 업무의 최신 카드가 아니다.
 */
export type MemoProblem = MemoBodyProblem | "no_work" | "no_memo" | "no_thread";

export type MemoResult = { readonly ok: true; readonly memo: Memo } | { readonly ok: false; readonly problem: MemoProblem };

export async function writeMemo(deps: AppDeps, input: { readonly workId: string; readonly body: string }): Promise<MemoResult> {
  return addMemo(deps, input.workId, input.body, null);
}

/**
 * 스레드에 답글을 단다 (F9). 스레드는 한 단계만이라, 대상이 답글이면 그 답글이 달린 항목의 스레드에 들어간다.
 * 새 답글은 지금 열려 있는 스레드에만 단다:
 *   - 메모의 스레드: 그 업무의 최상위 메모이고 지우지 않았다.
 *   - PR 카드의 스레드: 그 PR 이 지금 이 업무에 연결돼 있고, 그 커밋이 PR 의 지금 커밋이다(최신 카드).
 *     이전 커밋 카드의 스레드는 읽기만 한다 — 버튼은 최신 카드에서만 누른다(결정 16-5). 옛 답글은 옛 카드에 그대로 남는다.
 * 아니면 no_thread 를 돌려준다.
 */
export async function writeReply(
  deps: AppDeps,
  input: { readonly workId: string; readonly thread: ThreadTarget; readonly body: string },
): Promise<MemoResult> {
  const checked = checkMemoBody(input.body);
  if (!checked.ok) return checked;
  const work = await deps.store.getWork(input.workId);
  if (work === undefined) return { ok: false, problem: "no_work" };
  const memos = await deps.store.listMemos(input.workId);
  const thread = resolveThread(input.thread, memos);
  if (thread.kind === "memo") {
    const root = memos.find((m) => m.id === thread.memoId);
    if (root === undefined || root.thread !== null || root.deletedAt !== null) return { ok: false, problem: "no_thread" };
  } else {
    const [link, snapshot] = await Promise.all([deps.store.getLink(thread), deps.store.getSnapshot(thread)]);
    if (link?.workId !== input.workId || snapshot?.headSha !== thread.commitSha) return { ok: false, problem: "no_thread" };
  }
  try {
    return await addMemo(deps, input.workId, checked.body, thread);
  } catch (error) {
    // 확인과 쓰기 사이에 대상이 바뀐 경우(저장소가 한 단계 규칙으로 거절)
    if (error instanceof StudioError && error.code === "invalid_input") return { ok: false, problem: "no_thread" };
    throw error;
  }
}

async function addMemo(deps: AppDeps, workId: string, rawBody: string, thread: ThreadTarget | null): Promise<MemoResult> {
  const checked = checkMemoBody(rawBody);
  if (!checked.ok) return checked;
  const now = deps.now();
  const memo: Memo = {
    // 같은 업무 ID 규칙(영문 소문자 · 숫자)의 조각에 시각을 붙여, 무작위 조각이 겹쳐도 ID 가 겹치지 않게 한다
    id: `m${now.getTime().toString(36)}${deps.newId()}`,
    workId,
    author: MEMO_AUTHOR_ME,
    body: checked.body,
    createdAt: now.toISOString(),
    editedAt: null,
    deletedAt: null,
    thread,
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

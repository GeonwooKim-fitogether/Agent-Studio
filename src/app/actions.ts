"use server";

/**
 * 화면의 폼이 부르는 서버 액션. 모두 Studio 의 메모리 저장소만 바꾸고 GitHub 에는 아무것도 보내지 않는다.
 *
 * 도메인 규칙이 요청을 거절하면(StudioError: 이미 연결됨 · 다른 프로젝트 · 없는 PR 등) 500 오류 화면을 내지 않고
 * Inbox 로 돌아가 구체적인 사유를 보여 준다. 사유 문장은 주소에 싣지 않고, 정해진 코드만 실어 Inbox 가 지금 상태로 만든다.
 * 오래된 폼(자바스크립트를 끈 상태 포함)이나 빠른 이중 클릭도 같은 길로 간다.
 */
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createWorkFromPr, linkPrToWork, unlinkPr } from "../application/inbox-actions";
import { deleteMemo, editMemo, type MemoProblem, writeMemo, writeReply } from "../application/memo";
import { parseThreadKey, threadKey } from "../domain/memo";
import { createEmptyWork } from "../application/new-work";
import { startPreview, stopPreview } from "../application/preview";
import { decisionBlockOf, isReviewVerdict, readFreshHead, recordReviewDecision } from "../application/review";
import { setWorkGoal } from "../application/work-goal";
import { addAgent, saveAgent } from "../application/agents";
import { AGENT_DRAFT_COOKIE, problemsToParams } from "./agent-draft-cookie";
import { checkReviewNote } from "../domain/review-note";
import type { ReviewProblem } from "./components/labels";
import { REVIEW_DRAFT_COOKIE, reviewKeyOf } from "./review-draft";
import { setWorkStatusByPerson } from "../application/work-status";
import { isWorkStatus } from "../domain/work-status";
import { isValidPrRef, type PrRef, StudioError, type WorkStatus } from "../domain/model";
import { getContainer } from "../server/container";

function readPrRef(form: FormData): PrRef {
  const ref = { repoId: Number(form.get("repoId")), number: Number(form.get("number")) };
  // 양의 정수이고 저장 칸의 범위 안이어야 한다(PR 번호는 32비트). 벗어나면 데이터베이스에 닿기 전에 거절한다.
  if (!isValidPrRef(ref)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
  return ref;
}

/** 거절 사유를 보여 줄 Inbox 주소 */
function inboxNotice(error: StudioError, ref: PrRef | null): string {
  const params = new URLSearchParams({ notice: error.code });
  if (ref !== null) {
    params.set("repoId", String(ref.repoId));
    params.set("number", String(ref.number));
  }
  return `/inbox?${params.toString()}`;
}

/** 유스케이스를 돌리고 성공하면 그 주소로, 도메인 규칙에 걸리면 Inbox 의 사유 화면으로 보낸다. */
async function runThenRedirect(form: FormData, action: (ref: PrRef) => Promise<string>): Promise<never> {
  let ref: PrRef | null = null;
  let target: string;
  try {
    ref = readPrRef(form);
    const container = getContainer();
    await container.ensureSynced();
    target = await action(ref);
  } catch (error) {
    if (!(error instanceof StudioError)) throw error;
    target = inboxNotice(error, ref);
  }
  // redirect() 는 예외를 던져 이동시키므로 try 밖에서 부른다.
  revalidatePath("/", "layout");
  redirect(target);
}

export async function linkToWorkAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  await runThenRedirect(form, async (ref) => {
    await linkPrToWork(getContainer().deps, { ...ref, workId });
    return `/works/${encodeURIComponent(workId)}`;
  });
}

export async function newWorkFromPrAction(form: FormData): Promise<void> {
  await runThenRedirect(form, async (ref) => {
    const work = await createWorkFromPr(getContainer().deps, ref);
    return `/works/${encodeURIComponent(work.id)}`;
  });
}

/** 업무 화면의 Unlink. 확인 체크가 없으면 처리하지 않는다. 풀리면 Inbox 로 가서 그 PR 과 이유를 보여 준다. */
export async function unlinkAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const confirmed = form.get("confirm") === "yes";
  await runThenRedirect(form, async (ref) => {
    if (!confirmed) throw new StudioError("invalid_input", "확인 체크 없이 연결을 풀지 않는다.");
    await unlinkPr(getContainer().deps, { ...ref, workId });
    const params = new URLSearchParams({ notice: "unlinked", repoId: String(ref.repoId), number: String(ref.number) });
    return `/inbox?${params.toString()}`;
  });
}

/**
 * Workspace 의 New Work (feature-plan F5). 빈 업무를 만들고 Workspace 에 결과(표식 · Copy · Open Work)를 보인다.
 * 제목이나 프로젝트가 받아들여지지 않으면 폼을 다시 열고 이유를 보인다. 제목은 주소에 싣지 않는다.
 */
export async function newEmptyWorkAction(form: FormData): Promise<void> {
  const projectId = String(form.get("projectId") ?? "");
  const container = getContainer();
  await container.ensureSynced();
  const result = await createEmptyWork(container.deps, {
    projectId,
    title: String(form.get("title") ?? ""),
    goal: String(form.get("goal") ?? ""),
  });
  const params = result.ok ? new URLSearchParams({ created: result.work.id }) : new URLSearchParams({ newWork: "1", problem: result.problem, project: projectId });
  revalidatePath("/", "layout");
  redirect(`/?${params.toString()}`);
}

export async function syncAction(): Promise<void> {
  await getContainer().sync();
  revalidatePath("/", "layout");
}

/** 업무 화면으로 돌아갈 주소. 업무 ID 는 영문 소문자 · 숫자뿐이지만, 그래도 주소에 넣기 전에 인코딩한다. */
function workPath(form: FormData, notice?: { readonly preview: "refused" } | { readonly status: "refused" }): string {
  const path = `/works/${encodeURIComponent(String(form.get("workId") ?? ""))}`;
  // Review 패널 안의 폼(미리보기 열기 · 끄기)이면 패널을 연 채로 돌아간다
  const review = String(form.get("review") ?? "");
  const parts = [notice === undefined ? "" : new URLSearchParams(notice).toString(), /^\d+:\d+$/.test(review) ? `review=${review}` : ""].filter((p) => p !== "");
  return `${path}${parts.length === 0 ? "" : `?${parts.join("&")}`}${parts.some((p) => p.startsWith("review=")) ? "#review" : ""}`;
}

/**
 * Open Preview. PR 의 **지금** 최신 커밋으로 미리보기를 연다(화면에서 온 SHA 는 받지 않는다). 준비는 기다리지 않고 업무 화면으로 돌아가며,
 * 화면이 진행을 2초마다 다시 그린다. 실행기가 오프라인이거나 대상 제한에 걸리면(오래된 화면에서 누른 경우) 거절 알림과 함께 돌아간다.
 */
export async function startPreviewAction(form: FormData): Promise<void> {
  let target: string;
  try {
    const ref = readPrRef(form);
    const container = getContainer();
    await container.ensureSynced();
    await startPreview(container.deps, container.preview, ref);
    target = workPath(form);
  } catch (error) {
    if (!(error instanceof StudioError)) throw error;
    target = workPath(form, { preview: "refused" });
  }
  revalidatePath("/", "layout");
  redirect(target);
}

export async function stopPreviewAction(form: FormData): Promise<void> {
  await stopPreview(getContainer().preview);
  revalidatePath("/", "layout");
  redirect(workPath(form));
}

/**
 * Review 패널의 Approve in Studio · Request changes (결정 18, feature-plan F2). 내부 검토 결정을 Studio 저장소에만 남긴다.
 * GitHub 로는 아무것도 보내지 않는다(계약 §8-5). 폼은 사람이 본 커밋(viewedSha)을 싣는다.
 *
 * 저장하기 전에 차례로 본다. 걸리면 패널을 연 채로 돌아가 이유를 보이고, 적어 둔 Reason · Done when 은 짧은 쿠키에 담아 되살린다
 * (본문은 주소에 싣지 않는다).
 *   1. Request changes 의 Reason · Done when (서버에서도 검사한다)
 *   2. 이 PR 의 미리보기가 이전 커밋을 실행 중인가 (Q10)
 *   3. GitHub 에서 그 PR 하나의 최신 커밋을 GET 으로 다시 읽어, 본 커밋과 다르면 거절하고 Sync 해 새 커밋으로 다시 그린다 (Q9)
 *   4. recordReviewDecision — 저장된 스냅샷과 본 커밋을 비교해 다르면 stale_commit
 */
export async function reviewAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const reason = String(form.get("reason") ?? "");
  const doneWhen = String(form.get("doneWhen") ?? "");
  const viewedSha = String(form.get("viewedSha") ?? "");
  const key = reviewKeyOf({ repoId: Number(form.get("repoId")), number: Number(form.get("number")) });
  const base = `/works/${encodeURIComponent(workId)}`;
  let problem: ReviewProblem | null = null;
  let savedId: string | null = null;
  try {
    const ref = readPrRef(form);
    const verdict = form.get("verdict");
    if (!isReviewVerdict(verdict)) throw new StudioError("invalid_input", "검토 결정 값이 올바르지 않다.");
    const container = getContainer();
    await container.ensureSynced();
    const note = checkReviewNote(verdict, { reason, doneWhen });
    const snapshot = await container.deps.store.getSnapshot(ref);
    const preview = container.preview.current();
    const fresh = note.ok ? await readFreshHead(container.deps, ref) : null;
    if (!note.ok) problem = note.problem;
    else if (snapshot !== undefined && decisionBlockOf(snapshot, preview) === "outdated_preview") problem = "outdated_preview";
    else if (fresh !== null && fresh !== viewedSha) {
      // GitHub 에 새 커밋이 올라와 있다 — 받아 적은 뒤(GET 만) 새 커밋으로 다시 그린다
      await container.sync();
      problem = "stale";
    } else {
      const decision = await recordReviewDecision(container.deps, { ...ref, workId, verdict, viewedSha, reason, doneWhen, preview });
      savedId = decision.id;
    }
  } catch (error) {
    if (!(error instanceof StudioError)) throw error;
    problem = error.code === "stale_commit" ? "stale" : "refused";
  }
  const jar = await cookies();
  if (problem === null) {
    jar.delete(REVIEW_DRAFT_COOKIE);
  } else {
    const draft = encodeURIComponent(JSON.stringify({ key, workId, reason, doneWhen }));
    // 쿠키 하나는 4KB 안이어야 한다. 넘으면 되살리지 않는다(적은 글은 잃지만 결정은 남지 않았다는 사실은 그대로 보인다)
    if (draft.length < 3800) jar.set(REVIEW_DRAFT_COOKIE, draft, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
    else jar.delete(REVIEW_DRAFT_COOKIE);
  }
  revalidatePath("/", "layout");
  redirect(
    problem === null
      ? `${base}#decision-${savedId ?? ""}`
      : key === null
        ? `${base}?${new URLSearchParams({ status: "refused" }).toString()}`
        : `${base}?review=${key}&problem=${problem}#review`,
  );
}

/** 업무 화면의 Set goal · Edit goal (결정 18). 걸리면 고치기 칸을 연 채로 이유를 보인다(목표 글은 주소에 싣지 않는다) */
export async function setGoalAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const container = getContainer();
  await container.ensureSynced();
  const result = await setWorkGoal(container.deps, { workId, goal: String(form.get("goal") ?? "") });
  revalidatePath("/", "layout");
  const base = `/works/${encodeURIComponent(workId)}`;
  redirect(result.ok ? base : `${base}?${new URLSearchParams({ goal: "edit", goalProblem: result.problem }).toString()}#goal`);
}

/**
 * 사람이 업무 상태를 바꾼다 — 완료 후보의 Mark as Done, 또는 업무 화면의 상태 선택(R6). Studio 저장소만 바꾸고 GitHub 에는 아무것도 보내지 않는다.
 * 오래된 화면에서 눌러 거절되면(예: 그사이 PR 이 다시 열려 더는 완료 후보가 아니다) 업무 화면으로 돌아가 알린다.
 */
export async function markDoneAction(form: FormData): Promise<void> {
  await changeStatus(form, "mark_done", "done");
}

export async function setStatusAction(form: FormData): Promise<void> {
  const status = form.get("status");
  await changeStatus(form, "set_status", isWorkStatus(status) ? status : null);
}

async function changeStatus(form: FormData, action: "mark_done" | "set_status", status: WorkStatus | null): Promise<void> {
  let target: string;
  try {
    if (status === null) throw new StudioError("invalid_input", "업무 상태 값이 올바르지 않다.");
    const container = getContainer();
    await container.ensureSynced();
    await setWorkStatusByPerson(container.deps, { workId: String(form.get("workId") ?? ""), status, action });
    target = workPath(form);
  } catch (error) {
    if (!(error instanceof StudioError)) throw error;
    target = workPath(form, { status: "refused" });
  }
  revalidatePath("/", "layout");
  redirect(target);
}

/**
 * 업무 Chat 의 메모 (feature-plan F8) — Send · Save · Delete. Studio 저장소에만 쓰고 GitHub 에도 AI 에게도 보내지 않는다.
 * 성공하면 그 메모 자리로 돌아간다. 규칙에 걸리면 업무 화면에 이유를 보인다(본문은 주소에 싣지 않는다).
 * 고치기에서 걸리면 그 메모의 고치기 칸을 다시 연다.
 */
function memoPath(workId: string, params: Record<string, string>, anchor: string | null): string {
  const query = new URLSearchParams(params).toString();
  return `/works/${encodeURIComponent(workId)}${query === "" ? "" : `?${query}`}${anchor === null ? "" : `#${anchor}`}`;
}
const memoAnchor = (id: string) => `memo-${id}`;
/** 스레드 칸 안의 폼이면 그 스레드 이름. 돌아갈 때 스레드를 연 채로 돌아간다 */
const threadOf = (form: FormData): Record<string, string> => {
  const key = String(form.get("thread") ?? "");
  return parseThreadKey(key) === null ? {} : { thread: key };
};

export async function writeMemoAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const container = getContainer();
  await container.ensureSynced();
  const result = await writeMemo(container.deps, { workId, body: String(form.get("body") ?? "") });
  revalidatePath("/", "layout");
  redirect(result.ok ? memoPath(workId, {}, memoAnchor(result.memo.id)) : memoPath(workId, { memo: result.problem }, "composer"));
}

export async function editMemoAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const id = String(form.get("memoId") ?? "");
  const container = getContainer();
  await container.ensureSynced();
  const result = await editMemo(container.deps, { workId, id, body: String(form.get("body") ?? "") });
  const thread = threadOf(form);
  const failed = (problem: MemoProblem) =>
    problem === "no_memo" ? memoPath(workId, { ...thread, memo: problem }, null) : memoPath(workId, { ...thread, memo: problem, edit: id }, memoAnchor(id));
  revalidatePath("/", "layout");
  redirect(result.ok ? memoPath(workId, thread, memoAnchor(id)) : failed(result.problem));
}

export async function deleteMemoAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const id = String(form.get("memoId") ?? "");
  const container = getContainer();
  await container.ensureSynced();
  const result = await deleteMemo(container.deps, { workId, id });
  const thread = threadOf(form);
  revalidatePath("/", "layout");
  redirect(result.ok ? memoPath(workId, thread, memoAnchor(id)) : memoPath(workId, { ...thread, memo: result.problem }, null));
}

/**
 * 스레드의 Reply (feature-plan F9). 답글도 메모라 Studio 저장소에만 쓰고 GitHub 에도 AI 에게도 보내지 않는다.
 * 성공하면 스레드를 연 채로 그 답글 자리로, 걸리면 스레드 입력칸에 이유를 보인다(?reply=). 스레드 이름이 틀리면 업무 화면으로 돌아간다.
 */
export async function writeReplyAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const key = String(form.get("thread") ?? "");
  const target = parseThreadKey(key);
  const container = getContainer();
  await container.ensureSynced();
  const result = target === null ? ({ ok: false, problem: "no_thread" } as const) : await writeReply(container.deps, { workId, thread: target, body: String(form.get("body") ?? "") });
  revalidatePath("/", "layout");
  // 답글에 단 답글은 그 답글이 달린 스레드로 들어갔으므로(한 단계만), 돌아갈 스레드도 실제로 들어간 스레드다
  if (result.ok) redirect(memoPath(workId, { thread: threadKey(result.memo.thread!) }, memoAnchor(result.memo.id)));
  redirect(target === null ? memoPath(workId, {}, null) : memoPath(workId, { thread: key, reply: result.problem }, "thread"));
}

/**
 * Agents 화면의 Add Agent (결정 20 — Demo). 이름만 받아 초안을 만들고, 그 초안을 고른 채 Agents 로 돌아간다.
 * 걸리면 Add Agent 칸을 연 채로 이유를 보인다. 저장만 할 뿐 아무것도 실행하지 않는다.
 */
export async function addAgentAction(form: FormData): Promise<void> {
  const container = getContainer();
  await container.ensureSynced();
  const result = await addAgent(container.deps, { name: String(form.get("name") ?? "") });
  revalidatePath("/", "layout");
  if (result.ok) redirect(`/agents?${new URLSearchParams({ agent: result.agent.id, created: "1" }).toString()}`);
  const problem = result.problems?.name ?? "empty";
  redirect(`/agents?${new URLSearchParams({ add: problem }).toString()}#add-agent`);
}

/**
 * Agents 화면의 Save draft (결정 20 — Demo). 이름 · 소개 · 지시문 · Skill 을 저장한다. 모델 칸은 받지 않는다(연결된 모델이 없다).
 * 칸 규칙에 걸리면 적은 칸을 짧은 쿠키에 두고(주소에 싣지 않는다) 칸마다의 이유와 함께 같은 초안으로 돌아간다.
 */
export async function saveAgentDraftAction(form: FormData): Promise<void> {
  const input = {
    id: String(form.get("id") ?? ""),
    name: String(form.get("name") ?? ""),
    summary: String(form.get("summary") ?? ""),
    instructions: String(form.get("instructions") ?? ""),
    skills: form.getAll("skills").map(String),
  };
  const container = getContainer();
  await container.ensureSynced();
  const result = await saveAgent(container.deps, input);
  const jar = await cookies();
  revalidatePath("/", "layout");
  if (result.ok) {
    jar.delete(AGENT_DRAFT_COOKIE);
    redirect(`/agents?${new URLSearchParams({ agent: result.agent.id, saved: "1" }).toString()}`);
  }
  if (result.problems === undefined) {
    jar.delete(AGENT_DRAFT_COOKIE);
    redirect(`/agents?${new URLSearchParams({ missing: "1" }).toString()}`);
  }
  const draft = encodeURIComponent(JSON.stringify(input));
  // 쿠키 하나는 4KB 안이어야 한다. 넘으면 되살리지 않는다(적은 글은 잃지만 저장하지 않았다는 사실과 이유는 그대로 보인다)
  if (draft.length < 3800) jar.set(AGENT_DRAFT_COOKIE, draft, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 });
  else jar.delete(AGENT_DRAFT_COOKIE);
  const params = new URLSearchParams({ agent: input.id });
  for (const bad of problemsToParams(result.problems)) params.append("bad", bad);
  redirect(`/agents?${params.toString()}`);
}

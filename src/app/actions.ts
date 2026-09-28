"use server";

/**
 * 화면의 폼이 부르는 서버 액션. 모두 Studio 의 메모리 저장소만 바꾸고 GitHub 에는 아무것도 보내지 않는다.
 *
 * 도메인 규칙이 요청을 거절하면(StudioError: 이미 연결됨 · 다른 프로젝트 · 없는 PR 등) 500 오류 화면을 내지 않고
 * Inbox 로 돌아가 구체적인 사유를 보여 준다. 사유 문장은 주소에 싣지 않고, 정해진 코드만 실어 Inbox 가 지금 상태로 만든다.
 * 오래된 폼(자바스크립트를 끈 상태 포함)이나 빠른 이중 클릭도 같은 길로 간다.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createWorkFromPr, linkPrToWork, unlinkPr } from "../application/inbox-actions";
import { createEmptyWork } from "../application/new-work";
import { startPreview, stopPreview } from "../application/preview";
import { isReviewVerdict, recordReviewDecision } from "../application/review";
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
  const result = await createEmptyWork(container.deps, { projectId, title: String(form.get("title") ?? "") });
  const params = result.ok ? new URLSearchParams({ created: result.work.id }) : new URLSearchParams({ newWork: "1", problem: result.problem, project: projectId });
  revalidatePath("/", "layout");
  redirect(`/?${params.toString()}`);
}

export async function syncAction(): Promise<void> {
  await getContainer().sync();
  revalidatePath("/", "layout");
}

/** 업무 화면으로 돌아갈 주소. 업무 ID 는 영문 소문자 · 숫자뿐이지만, 그래도 주소에 넣기 전에 인코딩한다. */
function workPath(
  form: FormData,
  notice?: { readonly preview: "refused" } | { readonly review: "refused" } | { readonly status: "refused" },
): string {
  const path = `/works/${encodeURIComponent(String(form.get("workId") ?? ""))}`;
  return notice === undefined ? path : `${path}?${new URLSearchParams(notice).toString()}`;
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
 * Approve · Request Changes (feature-plan F2). 내부 검토 결정을 PR 의 **지금** 최신 커밋에 대해 Studio 저장소에만 남긴다.
 * 화면에서 온 커밋 SHA 는 받지 않는다. GitHub 로는 아무것도 보내지 않는다(계약 §8-5).
 * 오래된 화면에서 눌러 거절되면(PR 이 병합 · 닫힘 · 연결 해제됨) 업무 화면으로 돌아가 알린다.
 */
export async function reviewAction(form: FormData): Promise<void> {
  let target: string;
  try {
    const ref = readPrRef(form);
    const verdict = form.get("verdict");
    if (!isReviewVerdict(verdict)) throw new StudioError("invalid_input", "검토 결정 값이 올바르지 않다.");
    const container = getContainer();
    await container.ensureSynced();
    await recordReviewDecision(container.deps, { ...ref, workId: String(form.get("workId") ?? ""), verdict });
    target = workPath(form);
  } catch (error) {
    if (!(error instanceof StudioError)) throw error;
    target = workPath(form, { review: "refused" });
  }
  revalidatePath("/", "layout");
  redirect(target);
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

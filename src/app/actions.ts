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
import { type PrRef, StudioError } from "../domain/model";
import { getContainer } from "../server/container";

function readPrRef(form: FormData): PrRef {
  const repoId = Number(form.get("repoId"));
  const number = Number(form.get("number"));
  if (!Number.isSafeInteger(repoId) || repoId <= 0 || !Number.isSafeInteger(number) || number <= 0) {
    throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
  }
  return { repoId, number };
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

export async function syncAction(): Promise<void> {
  await getContainer().sync();
  revalidatePath("/", "layout");
}

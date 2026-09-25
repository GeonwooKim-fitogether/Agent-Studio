"use server";

/**
 * 화면의 폼이 부르는 서버 액션. 모두 Studio 의 메모리 저장소만 바꾸고 GitHub 에는 아무것도 보내지 않는다.
 */
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createWorkFromPr, linkPrToWork } from "../application/inbox-actions";
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

export async function linkToWorkAction(form: FormData): Promise<void> {
  const workId = String(form.get("workId") ?? "");
  const container = getContainer();
  await container.ensureSynced();
  await linkPrToWork(container.deps, { ...readPrRef(form), workId });
  revalidatePath("/", "layout");
  redirect(`/works/${encodeURIComponent(workId)}`);
}

export async function newWorkFromPrAction(form: FormData): Promise<void> {
  const container = getContainer();
  await container.ensureSynced();
  const work = await createWorkFromPr(container.deps, readPrRef(form));
  revalidatePath("/", "layout");
  redirect(`/works/${encodeURIComponent(work.id)}`);
}

export async function syncAction(): Promise<void> {
  await getContainer().sync();
  revalidatePath("/", "layout");
}

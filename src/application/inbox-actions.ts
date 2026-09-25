/**
 * Inbox 에서 사람이 하는 두 가지 — PR 을 기존 업무에 연결하기(Link to Work), PR 로 새 업무 만들기(New Work).
 * 둘 다 Studio 의 연결만 바꾸고, GitHub 에는 아무것도 보내지 않는다.
 */
import { isValidWorkId } from "../domain/work-marker";
import { type PrRef, type PrSnapshot, type Project, StudioError, type Work } from "../domain/model";
import type { AppDeps } from "./deps";

/** PR 을 같은 프로젝트의 기존 업무에 연결한다. */
export async function linkPrToWork(deps: AppDeps, input: PrRef & { readonly workId: string }): Promise<void> {
  const pr = await requireUnlinkedPr(deps, input);
  const project = await requireProjectOfRepo(deps, pr.repoId);
  const work = await deps.store.getWork(input.workId);
  if (work === undefined) throw new StudioError("not_found", "연결하려는 업무가 없다.");
  if (work.projectId !== project.id) {
    throw new StudioError("project_mismatch", "PR 은 같은 프로젝트의 업무에만 연결할 수 있다.");
  }
  await deps.store.addLink({
    repoId: pr.repoId,
    number: pr.number,
    workId: work.id,
    origin: "user",
    linkedAt: deps.now().toISOString(),
  });
}

/** PR 하나로 새 업무를 만들고 그 PR 을 연결한다. 업무 제목은 PR 제목을 그대로 쓴다. */
export async function createWorkFromPr(deps: AppDeps, ref: PrRef): Promise<Work> {
  const pr = await requireUnlinkedPr(deps, ref);
  const project = await requireProjectOfRepo(deps, pr.repoId);
  const createdAt = deps.now().toISOString();
  const work: Work = {
    id: await newUniqueWorkId(deps),
    projectId: project.id,
    title: pr.title.trim() === "" ? `PR #${pr.number}` : pr.title.trim(),
    status: "draft",
    createdAt,
  };
  await deps.store.saveWork(work);
  await deps.store.addLink({ repoId: pr.repoId, number: pr.number, workId: work.id, origin: "user", linkedAt: createdAt });
  return work;
}

async function requireUnlinkedPr(deps: AppDeps, ref: PrRef): Promise<PrSnapshot> {
  const pr = await deps.store.getSnapshot(ref);
  if (pr === undefined) throw new StudioError("not_found", "그 PR 을 찾을 수 없다. 동기화가 끝났는지 확인한다.");
  if ((await deps.store.getLink(ref)) !== undefined) {
    throw new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
  }
  return pr;
}

async function requireProjectOfRepo(deps: AppDeps, repoId: number): Promise<Project> {
  const project = (await deps.store.listProjects()).find((p) => p.repoIds.includes(repoId));
  if (project === undefined) throw new StudioError("not_found", "이 PR 의 저장소가 어느 프로젝트에도 연결돼 있지 않다.");
  return project;
}

async function newUniqueWorkId(deps: AppDeps): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = deps.newId();
    if (isValidWorkId(id) && (await deps.store.getWork(id)) === undefined) return id;
  }
  throw new StudioError("invalid_input", "새 업무 ID 를 만들지 못했다.");
}

/**
 * Inbox 에서 사람이 하는 두 가지 — PR 을 기존 업무에 연결하기(Link to Work), PR 로 새 업무 만들기(New Work).
 * 둘 다 Studio 의 연결만 바꾸고, GitHub 에는 아무것도 보내지 않는다.
 */
import { isValidWorkId } from "../domain/work-marker";
import { isValidPrRef, type PrRef, type PrSnapshot, type Project, StudioError, type Work } from "../domain/model";
import type { AppDeps } from "./deps";

/**
 * PR 을 같은 프로젝트의 기존 업무에 연결한다.
 * 이미 **같은 업무**에 연결돼 있으면 아무 일도 하지 않고 성공한다(버튼을 두 번 눌러도 같은 결과).
 * 다른 업무에 연결돼 있으면 already_linked 로 거절한다.
 */
export async function linkPrToWork(deps: AppDeps, input: PrRef & { readonly workId: string }): Promise<void> {
  const pr = await requireSnapshot(deps, input);
  const existing = await deps.store.getLink(input);
  if (existing !== undefined) {
    if (existing.workId === input.workId) return;
    throw alreadyLinked();
  }
  const project = await requireProjectOfRepo(deps, pr.repoId);
  const work = await deps.store.getWork(input.workId);
  if (work === undefined) throw new StudioError("not_found", "연결하려는 업무가 없다.");
  if (work.projectId !== project.id) {
    throw new StudioError("project_mismatch", "PR 은 같은 프로젝트의 업무에만 연결할 수 있다.");
  }
  try {
    await deps.store.addLink({
      repoId: pr.repoId,
      number: pr.number,
      workId: work.id,
      origin: "user",
      linkedAt: deps.now().toISOString(),
    });
  } catch (error) {
    // 동시에 들어온 같은 요청이 먼저 같은 업무에 연결했다면 성공으로 본다.
    if (isAlreadyLinked(error) && (await deps.store.getLink(input))?.workId === work.id) return;
    throw error;
  }
}

/**
 * 연결을 푼다(Unlink, 결정 9). 그 PR 은 Inbox 로 돌아가고, 사람이 다시 연결할 때까지 표식으로 자동 연결되지 않는다.
 * 그 업무에 연결돼 있지 않으면(이미 풀렸거나, 다른 탭에서 바뀌었거나) not_linked 로 거절한다.
 */
export async function unlinkPr(deps: AppDeps, input: PrRef & { readonly workId: string }): Promise<void> {
  requireValidRef(input);
  await deps.store.unlink(input, deps.now().toISOString());
}

/** PR 하나로 새 업무를 만들고 그 PR 을 연결한다. 업무 제목은 PR 제목을 그대로 쓴다. 업무와 연결은 한 번에 생긴다. */
export async function createWorkFromPr(deps: AppDeps, ref: PrRef): Promise<Work> {
  const pr = await requireSnapshot(deps, ref);
  if ((await deps.store.getLink(ref)) !== undefined) throw alreadyLinked();
  const project = await requireProjectOfRepo(deps, pr.repoId);
  const createdAt = deps.now().toISOString();
  const work: Work = {
    id: await newUniqueWorkId(deps),
    projectId: project.id,
    title: pr.title.trim() === "" ? `PR #${pr.number}` : pr.title.trim(),
    status: "draft",
    createdAt,
  };
  await deps.store.createWorkWithLink(work, {
    repoId: pr.repoId,
    number: pr.number,
    workId: work.id,
    origin: "user",
    linkedAt: createdAt,
  });
  return work;
}

const alreadyLinked = () => new StudioError("already_linked", "이 PR 은 이미 업무에 연결돼 있다.");
const isAlreadyLinked = (error: unknown) => error instanceof StudioError && error.code === "already_linked";

/** PR 을 가리키는 값이 범위 밖이면 저장소에 닿기 전에 거절한다 — 저장소 종류와 무관하게 같은 결과가 나오게. */
function requireValidRef(ref: PrRef): void {
  if (!isValidPrRef(ref)) throw new StudioError("invalid_input", "PR 을 가리키는 값이 올바르지 않다.");
}

async function requireSnapshot(deps: AppDeps, ref: PrRef): Promise<PrSnapshot> {
  requireValidRef(ref);
  const pr = await deps.store.getSnapshot(ref);
  if (pr === undefined) throw new StudioError("not_found", "그 PR 을 찾을 수 없다. 동기화가 끝났는지 확인한다.");
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

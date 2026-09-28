/**
 * Inbox 에서 사람이 하는 두 가지 — PR 을 기존 업무에 연결하기(Link to Work), PR 로 새 업무 만들기(New Work).
 * 둘 다 Studio 의 연결만 바꾸고, GitHub 에는 아무것도 보내지 않는다.
 * 연결이 바뀐 업무는 그 자리에서 상태 규칙을 다시 판정한다(계약 §5-1 — 예: 첫 PR 이 연결되면 R1).
 * 연결 · 연결 해제가 실제로 일어났으면 그 업무의 타임라인에 PR 이벤트로 남긴다(feature-plan F7).
 */
import { isValidWorkId } from "../domain/work-marker";
import { isValidPrRef, type PrLink, type PrRef, type PrSnapshot, type Project, StudioError, type Work } from "../domain/model";
import { linkedEvent, unlinkedEvent } from "../domain/pr-event";
import type { AppDeps } from "./deps";
import { refreshWorkStatuses } from "./work-status";

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
  const link = await addUserLink(deps, pr, input.workId);
  if (link !== null) await deps.store.addPrEvents([linkedEvent(link, pr.headSha)]);
  await refreshWorkStatuses(deps, [input.workId]);
}

/** 사람의 연결을 쓴다. 이 요청이 연결을 만들었으면 그 연결을, 동시에 온 같은 요청이 먼저 만들었으면 null 을 돌려준다 */
async function addUserLink(deps: AppDeps, pr: PrSnapshot, workId: string): Promise<PrLink | null> {
  const input = { repoId: pr.repoId, number: pr.number, workId };
  const project = await requireProjectOfRepo(deps, pr.repoId);
  const work = await deps.store.getWork(input.workId);
  if (work === undefined) throw new StudioError("not_found", "연결하려는 업무가 없다.");
  if (work.projectId !== project.id) {
    throw new StudioError("project_mismatch", "PR 은 같은 프로젝트의 업무에만 연결할 수 있다.");
  }
  const link: PrLink = { repoId: pr.repoId, number: pr.number, workId: work.id, origin: "user", linkedAt: deps.now().toISOString() };
  try {
    await deps.store.addLink(link);
    return link;
  } catch (error) {
    // 동시에 들어온 같은 요청이 먼저 같은 업무에 연결했다면 성공으로 본다(연결됨 이벤트는 그 요청이 남긴다).
    if (isAlreadyLinked(error) && (await deps.store.getLink(input))?.workId === work.id) return null;
    throw error;
  }
}

/**
 * 연결을 푼다(Unlink, 결정 9). 그 PR 은 Inbox 로 돌아가고, 사람이 다시 연결할 때까지 표식으로 자동 연결되지 않는다.
 * 그 업무에 연결돼 있지 않으면(이미 풀렸거나, 다른 탭에서 바뀌었거나) not_linked 로 거절한다.
 */
export async function unlinkPr(deps: AppDeps, input: PrRef & { readonly workId: string }): Promise<void> {
  requireValidRef(input);
  const at = deps.now().toISOString();
  await deps.store.unlink(input, at);
  const pr = await deps.store.getSnapshot(input);
  if (pr !== undefined) await deps.store.addPrEvents([unlinkedEvent(input, pr.headSha, at)]);
  await refreshWorkStatuses(deps, [input.workId]); // PR 이 빠져도 초안으로 되돌리지는 않는다(R1). 남은 PR 로 다시 본다(예: R4)
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
    goal: "", // PR 로 만든 업무는 목표가 비어 있다 — 업무 화면의 Set goal 로 적는다 (결정 18)
    status: "draft",
    createdAt,
  };
  const link: PrLink = { repoId: pr.repoId, number: pr.number, workId: work.id, origin: "user", linkedAt: createdAt };
  await deps.store.createWorkWithLink(work, link);
  await deps.store.addPrEvents([linkedEvent(link, pr.headSha)]);
  await refreshWorkStatuses(deps, [work.id]);
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

/** 새 업무 ID. deps.newId 로 만들고, 형식이 맞고 아직 쓰이지 않은 것을 고른다 (Inbox 의 New Work 와 빈 업무 만들기가 함께 쓴다). */
export async function newUniqueWorkId(deps: AppDeps): Promise<string> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = deps.newId();
    if (isValidWorkId(id) && (await deps.store.getWork(id)) === undefined) return id;
  }
  throw new StudioError("invalid_input", "새 업무 ID 를 만들지 못했다.");
}

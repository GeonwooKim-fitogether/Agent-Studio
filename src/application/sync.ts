/**
 * 동기화 — GitHub 에서 PR 을 읽어 받아 적고, 아직 연결이 없는 PR 에만 자동 연결 규칙을 적용한다.
 */
import { decideLink } from "../domain/auto-link";
import { type Project, prKey, type RepoId, StudioError } from "../domain/model";
import type { AppDeps } from "./deps";

/** 요청한 저장소와 저장소 ID 가 달라 받아 적지 않고 버린 스냅샷 */
export interface DiscardedSnapshot {
  readonly requestedRepoId: RepoId;
  readonly repoId: RepoId;
  readonly number: number;
}

export interface SyncResult {
  readonly repositories: number;
  readonly pullRequests: number;
  /** 이번 동기화에서 표식으로 새로 자동 연결된 PR 수 */
  readonly autoLinked: number;
  readonly discarded: readonly DiscardedSnapshot[];
  /** 값이 저장할 수 없는 모양이라(invalid_input) 받아 적지 못하고 건너뛴 PR. 나머지 PR 은 계속 동기화한다 */
  readonly skipped: readonly { readonly repoId: RepoId; readonly number: number }[];
  /** 리더가 이번 동기화에 대해 알린 것 */
  readonly notes: readonly string[];
}

/**
 * 설정된 모든 저장소의 PR 을 읽는다.
 *
 * 1. 저장소 정보(숫자 ID, 현재 이름)를 받아 적는다. 이름이 바뀌었으면 이름만 갱신되고 같은 저장소로 남는다.
 * 2. 어느 프로젝트에도 속하지 않은 저장소는 그 저장소 하나로 된 프로젝트를 만든다.
 *    프로젝트를 만드는 화면이 아직 없으므로, 읽을 저장소 목록(환경변수)을 사용자의 선택으로 본다.
 *    고정 데이터에서는 모든 저장소가 이미 프로젝트에 속해 있어 이 단계가 아무것도 하지 않는다.
 * 3. PR 스냅샷을 받아 적는다. 스냅샷이 어느 프로젝트의 것인지는 **스냅샷의 저장소 ID** 로 정한다.
 *    요청한 저장소와 저장소 ID 가 다른 스냅샷은 믿지 않고 버리며, 버린 목록을 결과에 남긴다.
 *    사람이 연결을 푼 PR(Unlink)은 표식이 있어도 판정이 Inbox 로 보낸다. 복제본에서 온 PR 도 같다.
 * 4. 이미 연결된 PR 은 다시 판정하지 않는다. 사람이 연결한 것이든 표식으로 연결된 것이든, 연결은 동기화가 바꾸지 않는다.
 *    연결이 없는 PR 만 표식 규칙으로 판정하고, 확실하지 않으면 그대로 둔다(= Inbox 에 남는다).
 *    다른 요청(동시에 도는 동기화, 사람의 연결)이 먼저 연결해 버린 PR 은 건너뛰고 계속 간다.
 */
export async function syncAll(deps: AppDeps): Promise<SyncResult> {
  const { store } = deps;
  // 동기화 1회분의 읽기. 리더가 지원하면 이번 동기화만의 상한 · 알림을 갖는 객체를 쓴다.
  const reader = deps.reader.startRun?.() ?? { ...deps.reader, notes: () => [] };
  const repositories = await reader.listRepositories();

  for (const repository of repositories) await store.saveRepository(repository);

  const projects: Project[] = await store.listProjects();
  for (const repository of repositories) {
    if (!projects.some((p) => p.repoIds.includes(repository.id))) {
      const project: Project = { id: `repo-${repository.id}`, name: repository.fullName, repoIds: [repository.id] };
      await store.saveProject(project);
      projects.push(project);
    }
  }

  const works = await store.listWorks();
  const unlinked = new Set((await store.listUnlinks()).map(prKey));
  const linkedAt = deps.now().toISOString();
  const discarded: DiscardedSnapshot[] = [];
  const skipped: { repoId: RepoId; number: number }[] = [];
  let pullRequests = 0;
  let autoLinked = 0;

  for (const repository of repositories) {
    for (const snapshot of await reader.listPullRequests(repository)) {
      if (snapshot.repoId !== repository.id) {
        discarded.push({ requestedRepoId: repository.id, repoId: snapshot.repoId, number: snapshot.number });
        continue;
      }
      const project = projects.find((p) => p.repoIds.includes(snapshot.repoId));
      if (project === undefined) continue; // 2단계에서 만들었으므로 여기 오지 않는다

      pullRequests += 1;
      try {
        await store.saveSnapshot(snapshot);
      } catch (error) {
        // PR 하나가 저장할 수 없는 모양이면 그 PR 만 건너뛰고 기록한다. 한 PR 때문에 다른 저장소 · PR 이 모두 멈추지 않게.
        // 데이터베이스가 내려간 것 같은 다른 오류는 그대로 올려 동기화 전체를 멈춘다(부분 동기화를 조용히 성공으로 보이지 않게).
        if (error instanceof StudioError && error.code === "invalid_input") {
          skipped.push({ repoId: snapshot.repoId, number: snapshot.number });
          continue;
        }
        throw error;
      }
      if ((await store.getLink(snapshot)) !== undefined) continue;

      const decision = decideLink(snapshot, project.id, works, { unlinkedByUser: unlinked.has(prKey(snapshot)) });
      if (decision.kind !== "auto") continue;
      try {
        await store.addLink({
          repoId: snapshot.repoId,
          number: snapshot.number,
          workId: decision.workId,
          origin: "marker",
          markerFoundIn: decision.foundIn,
          linkedAt,
        });
        autoLinked += 1;
      } catch (error) {
        // 다른 요청이 먼저 연결했거나, 판정 뒤에 사람이 연결을 풀었다 — 건너뛰고 계속 간다.
        if (error instanceof StudioError && (error.code === "already_linked" || error.code === "unlinked_by_user")) continue;
        throw error;
      }
    }
  }

  return { repositories: repositories.length, pullRequests, autoLinked, discarded, skipped, notes: reader.notes() };
}

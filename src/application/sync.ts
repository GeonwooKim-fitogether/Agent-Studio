/**
 * 동기화 — GitHub 에서 PR 을 읽어 받아 적고, 아직 연결이 없는 PR 에만 자동 연결 규칙을 적용한다.
 */
import { decideLink } from "../domain/auto-link";
import type { Project } from "../domain/model";
import type { AppDeps } from "./deps";

export interface SyncResult {
  readonly repositories: number;
  readonly pullRequests: number;
  /** 이번 동기화에서 표식으로 새로 자동 연결된 PR 수 */
  readonly autoLinked: number;
}

/**
 * 설정된 모든 저장소의 PR 을 읽는다.
 *
 * 1. 저장소 정보(숫자 ID, 현재 이름)를 받아 적는다. 이름이 바뀌었으면 이름만 갱신되고 같은 저장소로 남는다.
 * 2. 어느 프로젝트에도 속하지 않은 저장소는 그 저장소 하나로 된 프로젝트를 만든다.
 *    프로젝트를 만드는 화면이 아직 없으므로, 읽을 저장소 목록(환경변수)을 사용자의 선택으로 본다.
 *    고정 데이터에서는 모든 저장소가 이미 프로젝트에 속해 있어 이 단계가 아무것도 하지 않는다.
 * 3. PR 스냅샷을 (저장소 숫자 ID, PR 번호) 로 받아 적는다.
 * 4. 이미 연결된 PR 은 다시 판정하지 않는다. 사람이 연결한 것이든 표식으로 연결된 것이든, 연결은 동기화가 바꾸지 않는다.
 *    연결이 없는 PR 만 표식 규칙으로 판정하고, 확실하지 않으면 그대로 둔다(= Inbox 에 남는다).
 */
export async function syncAll(deps: AppDeps): Promise<SyncResult> {
  const { reader, store } = deps;
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
  const linkedAt = deps.now().toISOString();
  let pullRequests = 0;
  let autoLinked = 0;

  for (const repository of repositories) {
    const project = projects.find((p) => p.repoIds.includes(repository.id));
    if (project === undefined) continue; // 2단계에서 만들었으므로 여기 오지 않는다
    const snapshots = await reader.listPullRequests(repository);
    for (const snapshot of snapshots) {
      pullRequests += 1;
      await store.saveSnapshot(snapshot);
      if ((await store.getLink(snapshot)) !== undefined) continue;
      const decision = decideLink(snapshot, project.id, works);
      if (decision.kind === "auto") {
        await store.addLink({
          repoId: snapshot.repoId,
          number: snapshot.number,
          workId: decision.workId,
          origin: "marker",
          linkedAt,
        });
        autoLinked += 1;
      }
    }
  }

  return { repositories: repositories.length, pullRequests, autoLinked };
}

/**
 * 고정 데이터(fixture)로 도는 GitHub 읽기 어댑터. 진짜 자격증명 없이 화면과 테스트를 돌리기 위한 것이다.
 *
 * 부를 때마다 `data` 를 새로 읽는다. 그래서 테스트는 두 번의 동기화 사이에 `data` 를 바꿔
 * "저장소 이름이 바뀌었다", "PR 에 새 커밋이 올라왔다" 같은 GitHub 쪽 변화를 흉내 낼 수 있다.
 */
import type { PrSnapshot, Repository } from "../../../domain/model";
import type { GitHubReader } from "../../../ports/github-reader";

export interface FixtureData {
  repositories: Repository[];
  pullRequests: PrSnapshot[];
}

export function createFixtureReader(data: FixtureData): GitHubReader {
  return {
    source: "fixture",
    async listRepositories() {
      return structuredClone(data.repositories);
    },
    async listPullRequests(repository) {
      return structuredClone(data.pullRequests.filter((pr) => pr.repoId === repository.id));
    },
  };
}

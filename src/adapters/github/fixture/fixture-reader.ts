/**
 * 고정 데이터(fixture)로 도는 GitHub 읽기 어댑터. 진짜 자격증명 없이 화면과 테스트를 돌리기 위한 것이다.
 *
 * 부를 때마다 `data` 를 새로 읽는다. 그래서 테스트는 두 번의 동기화 사이에 `data` 를 바꿔
 * "저장소 이름이 바뀌었다", "PR 에 새 커밋이 올라왔다" 같은 GitHub 쪽 변화를 흉내 낸다.
 *
 * headOverrides 는 서버를 띄운 채로 "새 커밋이 올라왔다" 를 흉내 내는 자리다(e2e 가 쓴다, 결정 18).
 * 부를 때마다 읽어 PR 의 최신 커밋을 덮는다(열쇠는 prKey — "저장소 숫자 ID#번호"). 고정 데이터 모드에서만 쓰이므로
 * 진짜 GitHub 의 데이터에는 닿지 않는다.
 */
import { prKey, type PrSnapshot, type Repository } from "../../../domain/model";
import type { GitHubReader } from "../../../ports/github-reader";

export interface FixtureData {
  repositories: Repository[];
  pullRequests: PrSnapshot[];
}

export interface FixtureOptions {
  /** PR 열쇠(prKey) → 덮어쓸 최신 커밋 SHA. 부를 때마다 다시 읽는다 */
  readonly headOverrides?: () => Readonly<Record<string, string>>;
}

export function createFixtureReader(data: FixtureData, options: FixtureOptions = {}): GitHubReader {
  const withOverrides = (prs: PrSnapshot[]): PrSnapshot[] => {
    const heads = options.headOverrides?.() ?? {};
    return prs.map((pr) => (heads[prKey(pr)] === undefined ? pr : { ...pr, headSha: heads[prKey(pr)]! }));
  };
  return {
    source: "fixture",
    async listRepositories() {
      return structuredClone(data.repositories);
    },
    async listPullRequests(repository) {
      return withOverrides(structuredClone(data.pullRequests.filter((pr) => pr.repoId === repository.id)));
    },
    async readPullRequestHead(repository, number) {
      const pr = withOverrides(data.pullRequests.filter((p) => p.repoId === repository.id && p.number === number))[0];
      if (pr === undefined) throw new Error(`고정 데이터에 ${repository.fullName}#${number} 가 없다`);
      return pr.headSha;
    },
  };
}

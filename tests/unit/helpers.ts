import { demoFixtureData, demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { createFixtureReader, type FixtureData } from "../../src/adapters/github/fixture/fixture-reader";
import { createMemoryStore, type StudioSeed } from "../../src/adapters/store/memory/memory-store";
import type { AppDeps } from "../../src/application/deps";
import type { GitHubReader } from "../../src/ports/github-reader";

/** 시연용 고정 데이터로 유스케이스를 돌릴 준비. `data` 를 고치면 다음 동기화에 GitHub 쪽 변화로 들어간다. */
export function setup(options: { data?: FixtureData; seed?: StudioSeed } = {}) {
  const data = options.data ?? demoFixtureData();
  const inner = createFixtureReader(data);
  const readerCalls: string[] = [];
  // GitHub 쪽으로 몇 번 물었는지 세기 위해 한 겹 감싼다.
  const reader: GitHubReader = {
    source: inner.source,
    listRepositories: () => {
      readerCalls.push("listRepositories");
      return inner.listRepositories();
    },
    listPullRequests: (repository) => {
      readerCalls.push(`listPullRequests:${repository.id}`);
      return inner.listPullRequests(repository);
    },
  };
  let sequence = 0;
  const deps: AppDeps = {
    reader,
    store: createMemoryStore(options.seed ?? demoStudioSeed()),
    now: () => new Date("2026-09-25T00:00:00.000Z"),
    newId: () => `n${String((sequence += 1)).padStart(5, "0")}`,
  };
  return { data, deps, readerCalls };
}

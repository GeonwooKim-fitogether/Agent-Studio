/**
 * 조립부 — 어느 어댑터를 쓸지 정하는 유일한 곳.
 *
 * GITHUB_TOKEN 과 GITHUB_REPOS 가 **둘 다** 있으면 GitHub REST 어댑터(GET 전용)를 쓰고,
 * 하나라도 비어 있으면 고정 데이터(fixture) 어댑터를 쓴다. 저장은 이번 단위에 서버 메모리뿐이다.
 * 앱은 아직 DATABASE_URL 을 읽지 않는다.
 */
import { randomBytes } from "node:crypto";
import { demoFixtureData, demoStudioSeed } from "../adapters/github/fixture/demo-scenario";
import { createFixtureReader } from "../adapters/github/fixture/fixture-reader";
import { createGitHubRestReader } from "../adapters/github/rest/rest-reader";
import { createMemoryStore } from "../adapters/store/memory/memory-store";
import type { AppDeps } from "../application/deps";
import { syncAll } from "../application/sync";

export interface SyncStatus {
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
}

export interface Container {
  readonly deps: AppDeps;
  /** 동기화를 한 번 돌린다. 실패해도 던지지 않고 status() 에 이유를 남긴다. */
  sync(): Promise<void>;
  /** 서버가 켜진 뒤 첫 요청에서 한 번만 동기화한다. */
  ensureSynced(): Promise<void>;
  status(): SyncStatus;
}

export interface GitHubConfig {
  readonly token: string;
  readonly repos: readonly string[];
}

/** 두 환경변수가 모두 채워졌을 때만 설정을 돌려준다. 토큰 값은 이 함수 밖으로 로그되지 않는다. */
export function readGitHubConfig(env: Record<string, string | undefined>): GitHubConfig | null {
  const token = env["GITHUB_TOKEN"]?.trim() ?? "";
  const repos = (env["GITHUB_REPOS"] ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  return token !== "" && repos.length > 0 ? { token, repos } : null;
}

export function createContainer(env: Record<string, string | undefined> = process.env): Container {
  const github = readGitHubConfig(env);
  const deps: AppDeps = {
    reader: github
      ? createGitHubRestReader({ token: github.token, repos: github.repos, fetch: (url, init) => fetch(url, init) })
      : createFixtureReader(demoFixtureData()),
    store: createMemoryStore(github ? {} : demoStudioSeed()),
    now: () => new Date(),
    newId: () => randomBytes(3).toString("hex"),
  };

  let status: SyncStatus = { lastSyncedAt: null, lastError: null };
  let first: Promise<void> | null = null;

  async function sync(): Promise<void> {
    try {
      await syncAll(deps);
      status = { lastSyncedAt: deps.now().toISOString(), lastError: null };
    } catch (error) {
      status = { ...status, lastError: error instanceof Error ? error.message : "알 수 없는 오류" };
    }
  }

  return {
    deps,
    sync,
    ensureSynced: () => (first ??= sync()),
    status: () => status,
  };
}

/**
 * 서버 프로세스 하나에 컨테이너 하나. 화면과 서버 액션이 같은 메모리 저장소를 보게 하려고
 * globalThis 에 둔다(개발 서버가 모듈을 다시 읽어도 상태가 흩어지지 않게).
 */
export function getContainer(): Container {
  const holder = globalThis as typeof globalThis & { __agentStudioContainer?: Container };
  holder.__agentStudioContainer ??= createContainer();
  return holder.__agentStudioContainer;
}

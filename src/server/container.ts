/**
 * 조립부 — 어느 어댑터를 쓸지 정하는 유일한 곳.
 *
 * GITHUB_TOKEN 과 GITHUB_REPOS 가 **둘 다** 있으면 GitHub REST 어댑터(GET 전용)를 쓰고,
 * 하나라도 비어 있으면 고정 데이터(fixture) 어댑터를 쓴다.
 * DATABASE_URL 이 있으면 PostgreSQL 저장 어댑터를, 없으면 서버 메모리 저장 어댑터를 쓴다.
 * fixture 모드의 시연 데이터(업무 · 검토 기록)는 저장소가 비어 있을 때만 한 번 심는다 — 사람이 만든 것을 덮어쓰지 않는다.
 * 연결 문자열은 이 파일 밖으로 내보내지 않는다(화면 · 로그에 싣지 않는다).
 */
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { demoFixtureData, demoStudioSeed } from "../adapters/github/fixture/demo-scenario";
import { createFixtureReader } from "../adapters/github/fixture/fixture-reader";
import { createGitHubRestReader } from "../adapters/github/rest/rest-reader";
import { createMemoryStore } from "../adapters/store/memory/memory-store";
import { createPostgresStore, seedIfEmpty } from "../adapters/store/postgres/postgres-store";
import type { AppDeps } from "../application/deps";
import { syncAll } from "../application/sync";

export interface SyncStatus {
  readonly lastSyncedAt: string | null;
  readonly lastError: string | null;
  /** 동기화는 끝났지만 사람이 알아야 할 것 (예: 요청한 저장소와 다른 저장소의 PR 을 받아 버렸다) */
  readonly lastWarning: string | null;
}

/** 저장이 어디에 되는가. 화면 위쪽 띠가 표시한다. */
export type StorageKind = "memory" | "postgres";

export interface Container {
  readonly deps: AppDeps;
  readonly storage: StorageKind;
  /** 데이터베이스 연결을 닫는다(시험에서 "서버를 끄는" 자리). 메모리 저장이면 아무것도 하지 않는다. */
  close(): Promise<void>;
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
  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  const pool = databaseUrl === "" ? null : new Pool({ connectionString: databaseUrl, max: 5 });
  // 쉬고 있는 연결이 끊겨도 서버 프로세스가 죽지 않게 한다. 오류 내용에는 연결 문자열을 싣지 않는다.
  pool?.on("error", () => console.error("PostgreSQL 연결 하나가 끊겼다. 다음 요청에서 새로 연결한다."));
  const seed = github ? {} : demoStudioSeed();
  const deps: AppDeps = {
    reader: github
      ? createGitHubRestReader({ token: github.token, repos: github.repos, fetch: (url, init) => fetch(url, init) })
      : createFixtureReader(demoFixtureData()),
    store: pool === null ? createMemoryStore(seed) : createPostgresStore(pool),
    now: () => new Date(),
    newId: () => randomBytes(3).toString("hex"),
  };

  let status: SyncStatus = { lastSyncedAt: null, lastError: null, lastWarning: null };
  let first: Promise<void> | null = null;

  async function sync(): Promise<void> {
    try {
      const result = await syncAll(deps);
      const discarded = result.discarded.map((d) => `${d.repoId}#${d.number}(요청한 저장소 ${d.requestedRepoId})`);
      status = {
        lastSyncedAt: deps.now().toISOString(),
        lastError: null,
        lastWarning:
          discarded.length === 0 ? null : `요청한 저장소와 다른 저장소의 PR ${discarded.length}개를 받아 버렸다: ${discarded.join(", ")}`,
      };
    } catch (error) {
      status = { ...status, lastError: error instanceof Error ? error.message : "알 수 없는 오류" };
    }
  }

  async function start(): Promise<void> {
    if (pool !== null && !github) {
      try {
        await seedIfEmpty(pool, seed);
      } catch (error) {
        status = { ...status, lastError: `저장소를 준비하지 못했다: ${error instanceof Error ? error.message : "알 수 없는 오류"}` };
        first = null; // 데이터베이스가 아직 준비되지 않았을 수 있다 — 다음 요청에서 다시 시도한다
        return;
      }
    }
    await sync();
  }

  return {
    deps,
    storage: pool === null ? "memory" : "postgres",
    close: async () => {
      await pool?.end();
    },
    sync,
    ensureSynced: () => (first ??= start()),
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

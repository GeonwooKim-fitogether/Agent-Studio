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
import { readFileSync } from "node:fs";
import { Pool } from "pg";
import { demoFixtureData, demoStudioSeed } from "../adapters/github/fixture/demo-scenario";
import { createFixtureReader } from "../adapters/github/fixture/fixture-reader";
import { createGitHubAppReader } from "../adapters/github/app/app-reader";
import { createInstallationTokenSource, loadPrivateKey } from "../adapters/github/app-auth/app-auth";
import { GitHubReadError } from "../adapters/github/rest/guarded-get";
import { createGitHubRestReader } from "../adapters/github/rest/rest-reader";
import type { GitHubReader } from "../ports/github-reader";
import { createMemoryStore } from "../adapters/store/memory/memory-store";
import { createPostgresStore, seedIfEmpty } from "../adapters/store/postgres/postgres-store";
import type { AppDeps } from "../application/deps";
import { syncAll } from "../application/sync";

export interface SyncStatus {
  readonly lastSyncedAt: string | null;
  /** 마지막으로 성공한 동기화에서 읽은 것 */
  readonly lastResult: { readonly repositories: number; readonly pullRequests: number; readonly skipped: number } | null;
  readonly lastError: string | null;
  /** 동기화는 끝났지만 사람이 알아야 할 것 (예: 요청한 저장소와 다른 저장소의 PR 을 받아 버렸다) */
  readonly lastWarning: string | null;
}

/** 저장이 어디에 되는가. 화면 위쪽 띠가 표시한다. */
export type StorageKind = "memory" | "postgres";

export interface Container {
  readonly deps: AppDeps;
  readonly storage: StorageKind;
  /** GitHub 연결 설정이 틀렸으면 그 이유(화면에 보인다). 없으면 null */
  readonly configError: string | null;
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

/** GitHub App 변수 셋의 이름 (docs/setup/github-app.md 와 같다) */
export const APP_ENV_VARS = ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY_PATH"] as const;

export type GitHubSource =
  | { readonly kind: "app"; readonly appId: number; readonly installationId: number; readonly privateKeyPem: string; readonly repos: readonly string[] }
  | { readonly kind: "app_config_error"; readonly message: string }
  | { readonly kind: "token"; readonly token: string; readonly repos: readonly string[] }
  | { readonly kind: "fixture" };

/**
 * GitHub 를 무엇으로 읽을지 정한다. 우선순위: GitHub App 변수 셋이 모두 있으면 App → 아니면 개인 토큰(개발용) → 아니면 fixture.
 * App 변수가 **일부만** 있거나 비밀 키 파일을 못 읽으면 fixture 로 조용히 떨어지지 않고 설정 오류로 돌려준다.
 * 설정 오류 문장에는 변수 이름과 비밀 키 파일 **경로만** 싣는다(키 내용 · 원래 오류 문장은 싣지 않는다).
 */
export function selectGitHubSource(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = (path) => readFileSync(path, "utf8"),
): GitHubSource {
  const value = (name: string) => env[name]?.trim() ?? "";
  const present = APP_ENV_VARS.filter((name) => value(name) !== "");
  const repos = value("GITHUB_REPOS")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");
  if (present.length > 0 && present.length < APP_ENV_VARS.length) {
    const missing = APP_ENV_VARS.filter((name) => value(name) === "");
    return { kind: "app_config_error", message: `GitHub App 설정이 모자라다: ${missing.join(", ")} 가 비어 있다. 셋을 모두 적거나 모두 비운다.` };
  }
  if (present.length === APP_ENV_VARS.length) {
    const appId = Number(value("GITHUB_APP_ID"));
    const installationId = Number(value("GITHUB_APP_INSTALLATION_ID"));
    if (!Number.isSafeInteger(appId) || appId <= 0 || !Number.isSafeInteger(installationId) || installationId <= 0) {
      return { kind: "app_config_error", message: "GITHUB_APP_ID 와 GITHUB_APP_INSTALLATION_ID 는 양의 정수여야 한다." };
    }
    const path = value("GITHUB_APP_PRIVATE_KEY_PATH");
    let privateKeyPem: string;
    try {
      privateKeyPem = readFile(path);
    } catch {
      return { kind: "app_config_error", message: `비밀 키 파일을 읽지 못했다: ${path}` };
    }
    try {
      loadPrivateKey(privateKeyPem);
    } catch {
      return { kind: "app_config_error", message: `비밀 키 파일의 내용이 RSA 비밀 키(PEM)가 아니다: ${path}` };
    }
    return { kind: "app", appId, installationId, privateKeyPem, repos };
  }
  const token = readGitHubConfig(env);
  return token === null ? { kind: "fixture" } : { kind: "token", token: token.token, repos: token.repos };
}

/** 설정 오류일 때의 리더. 동기화하면 설정 오류 문장을 그대로 알린다 — 시연 데이터로 바꿔치기하지 않는다. */
function unavailableReader(message: string): GitHubReader {
  const fail = async (): Promise<never> => {
    throw new GitHubReadError(message);
  };
  return { source: "github_app", listRepositories: fail, listPullRequests: fail };
}

function createReader(source: GitHubSource): GitHubReader {
  const fetchImpl = (url: string, init: RequestInit) => fetch(url, init);
  switch (source.kind) {
    case "app":
      return createGitHubAppReader({
        tokens: createInstallationTokenSource({
          appId: source.appId,
          installationId: source.installationId,
          privateKey: loadPrivateKey(source.privateKeyPem),
          fetch: fetchImpl,
        }),
        fetch: fetchImpl,
        onlyRepos: source.repos,
      });
    case "app_config_error":
      return unavailableReader(source.message);
    case "token":
      return createGitHubRestReader({ token: source.token, repos: source.repos, fetch: fetchImpl });
    case "fixture":
      return createFixtureReader(demoFixtureData());
  }
}

export function createContainer(
  env: Record<string, string | undefined> = process.env,
  readFile?: (path: string) => string,
): Container {
  const githubSource = selectGitHubSource(env, readFile);
  const github = githubSource.kind !== "fixture";
  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  const pool = databaseUrl === "" ? null : new Pool({ connectionString: databaseUrl, max: 5 });
  // 쉬고 있는 연결이 끊겨도 서버 프로세스가 죽지 않게 한다. 오류 내용에는 연결 문자열을 싣지 않는다.
  pool?.on("error", () => console.error("PostgreSQL 연결 하나가 끊겼다. 다음 요청에서 새로 연결한다."));
  const seed = github ? {} : demoStudioSeed();
  const deps: AppDeps = {
    reader: createReader(githubSource),
    store: pool === null ? createMemoryStore(seed) : createPostgresStore(pool),
    now: () => new Date(),
    newId: () => randomBytes(3).toString("hex"),
  };

  let status: SyncStatus = {
    lastSyncedAt: null,
    lastResult: null,
    lastError: githubSource.kind === "app_config_error" ? githubSource.message : null,
    lastWarning: null,
  };
  let first: Promise<void> | null = null;

  async function sync(): Promise<void> {
    try {
      const result = await syncAll(deps);
      const discarded = result.discarded.map((d) => `${d.repoId}#${d.number}(요청한 저장소 ${d.requestedRepoId})`);
      const skipped = result.skipped.map((d) => `${d.repoId}#${d.number}`);
      const warnings = [
        ...(deps.reader.lastRunNotes?.() ?? []),
        discarded.length === 0 ? "" : `요청한 저장소와 다른 저장소의 PR ${discarded.length}개를 받아 버렸다: ${discarded.join(", ")}`,
        skipped.length === 0 ? "" : `저장할 수 없는 값이 든 PR ${skipped.length}개를 건너뛰었다: ${skipped.join(", ")}`,
      ].filter((w) => w !== "");
      status = {
        lastSyncedAt: deps.now().toISOString(),
        lastResult: { repositories: result.repositories, pullRequests: result.pullRequests, skipped: result.skipped.length },
        lastError: null,
        lastWarning: warnings.length === 0 ? null : warnings.join(" · "),
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
    configError: githubSource.kind === "app_config_error" ? githubSource.message : null,
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

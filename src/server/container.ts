/**
 * 조립부 — 어느 어댑터를 쓸지 정하는 유일한 곳.
 *
 * GitHub 출처는 둘이다(결정 12). GitHub App 변수 셋이 있으면 App 출처, GITHUB_TOKEN 이 있으면 토큰 출처.
 * 둘 다 있으면 합성 리더(multi-reader)로 **함께** 읽어 한 번의 Sync 에 합치고, 하나만 있으면 그 리더를 그대로 쓴다.
 * 실제 출처가 하나도 없을 때만 고정 데이터(fixture) 어댑터를 쓴다.
 * DATABASE_URL 이 있으면 PostgreSQL 저장 어댑터를, 없으면 서버 메모리 저장 어댑터를 쓴다.
 * fixture 모드의 시연 데이터(업무 · 검토 기록)는 저장소가 비어 있을 때만 한 번 심는다 — 사람이 만든 것을 덮어쓰지 않는다.
 * 연결 문자열은 이 파일 밖으로 내보내지 않는다(화면 · 로그에 싣지 않는다).
 */
import { randomBytes } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { basename } from "node:path";
import { Pool } from "pg";
import { demoFixtureData, demoStudioSeed } from "../adapters/github/fixture/demo-scenario";
import { createFixtureReader } from "../adapters/github/fixture/fixture-reader";
import { createGitHubAppReader } from "../adapters/github/app/app-reader";
import { createInstallationTokenSource, loadPrivateKey, MIN_RSA_BITS } from "../adapters/github/app-auth/app-auth";
import { type FetchLike, GitHubReadError } from "../adapters/github/rest/guarded-get";
import { createGitHubRestReader } from "../adapters/github/rest/rest-reader";
import { createMultiReader } from "../adapters/github/multi/multi-reader";
import type { GitHubReader, SourceReport } from "../ports/github-reader";
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
  /** 출처별 결과 (두 출처를 함께 읽을 때만 채워진다). 마지막 동기화가 실패했으면 비어 있다 */
  readonly sources: readonly SourceReport[];
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
  readonly orgs: readonly string[];
}

const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((r) => r.trim())
    .filter((r) => r !== "");

/** GITHUB_TOKEN 이 있으면 토큰 출처 설정을 돌려준다(저장소 목록이 비었는지는 selectGitHubSources 가 본다). 토큰 값은 로그되지 않는다. */
export function readGitHubConfig(env: Record<string, string | undefined>): GitHubConfig | null {
  const token = env["GITHUB_TOKEN"]?.trim() ?? "";
  return token === "" ? null : { token, repos: list(env["GITHUB_REPOS"]), orgs: list(env["GITHUB_TOKEN_ORGS"]) };
}

/** GitHub 조직 이름 규칙: 영문 · 숫자 · 하이픈, 39자 이하, 하이픈으로 시작하지 않는다 */
const ORG_NAME = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/;

/** GitHub App 변수의 이름 (docs/setup/github-app.md 와 같다). 비밀 키는 경로와 내용 중 하나만 적는다 */
export const APP_ENV_VARS = ["GITHUB_APP_ID", "GITHUB_APP_INSTALLATION_ID", "GITHUB_APP_PRIVATE_KEY_PATH", "GITHUB_APP_PRIVATE_KEY"] as const;

export type GitHubSource =
  | { readonly kind: "app"; readonly appId: number; readonly installationId: number; readonly privateKeyPem: string; readonly repos: readonly string[] }
  | { readonly kind: "app_config_error"; readonly message: string }
  | { readonly kind: "token"; readonly token: string; readonly repos: readonly string[]; readonly orgs: readonly string[] }
  | { readonly kind: "token_config_error"; readonly message: string };

/**
 * 읽을 GitHub 출처들을 정한다. App 출처가 있으면 앞에 둔다 — 같은 저장소가 두 출처에 다 있으면 앞의 것(App)이 이긴다.
 * 빈 목록이면 실제 출처가 없다는 뜻이고, 조립부는 fixture 를 쓴다.
 */
export function selectGitHubSources(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = readKeyFile,
): GitHubSource[] {
  const app = selectAppSource(env, readFile);
  const token = selectTokenSource(env);
  return [...(app === null ? [] : [app]), ...(token === null ? [] : [token])];
}

/**
 * 토큰 출처. GITHUB_TOKEN 이 있으면 GITHUB_TOKEN_ORGS(조직의 저장소 전부) 나 GITHUB_REPOS(owner/name 목록) 중 하나 이상이 있어야 한다.
 * 둘 다 없으면 fixture 로 조용히 떨어지지 않고 설정 오류다. 오류 문장에는 변수 이름만 싣는다(값은 싣지 않는다 — 토큰을 잘못 붙여 넣었을 수 있다).
 */
function selectTokenSource(env: Record<string, string | undefined>): GitHubSource | null {
  const config = readGitHubConfig(env);
  if (config === null) return null;
  if (config.orgs.length === 0 && config.repos.length === 0) {
    return {
      kind: "token_config_error",
      message: "GITHUB_TOKEN 은 있는데 읽을 곳이 없다: GITHUB_TOKEN_ORGS(조직 이름) 나 GITHUB_REPOS(owner/name) 중 하나 이상을 적는다.",
    };
  }
  if (!config.orgs.every((org) => ORG_NAME.test(org))) {
    return {
      kind: "token_config_error",
      message: "GITHUB_TOKEN_ORGS 에 조직 이름이 아닌 값이 있다 — 영문 · 숫자 · 하이픈으로 된 조직 이름을 쉼표로 구분해 적는다.",
    };
  }
  return { kind: "token", token: config.token, repos: config.repos, orgs: config.orgs };
}

/**
 * GitHub App 출처. App 변수가 하나도 없으면 null.
 * 비밀 키는 둘 중 하나로 받는다 — 로컬은 파일 경로(GITHUB_APP_PRIVATE_KEY_PATH), 파일을 둘 수 없는 클라우드 환경은 내용(GITHUB_APP_PRIVATE_KEY).
 * 둘 다 있으면 어느 것을 쓸지 모호하므로 설정 오류다.
 * App 변수가 **일부만** 있거나 비밀 키를 못 읽으면 fixture 로 조용히 떨어지지 않고 설정 오류로 돌려준다.
 * 설정 오류 문장에는 변수 이름과 비밀 키 파일 **이름만** 싣는다(키 내용 · 길이 · 앞부분 · 원래 오류 문장은 싣지 않는다).
 */
export function selectAppSource(
  env: Record<string, string | undefined>,
  readFile: (path: string) => string = readKeyFile,
): GitHubSource | null {
  const value = (name: string) => env[name]?.trim() ?? "";
  const hasPath = value("GITHUB_APP_PRIVATE_KEY_PATH") !== "";
  const hasContent = value("GITHUB_APP_PRIVATE_KEY") !== "";
  const present = {
    GITHUB_APP_ID: value("GITHUB_APP_ID") !== "",
    GITHUB_APP_INSTALLATION_ID: value("GITHUB_APP_INSTALLATION_ID") !== "",
    [KEY_VARS_LABEL]: hasPath || hasContent,
  };
  const missing = Object.entries(present).filter(([, ok]) => !ok).map(([name]) => name);
  if (missing.length === Object.keys(present).length) return null;
  const repos = list(env["GITHUB_REPOS"]);
  if (missing.length > 0) {
    return { kind: "app_config_error", message: `GitHub App 설정이 모자라다: ${missing.join(", ")} 가 비어 있다. 셋을 모두 적거나 모두 비운다.` };
  }
  if (hasPath && hasContent) {
    return {
      kind: "app_config_error",
      message: "GITHUB_APP_PRIVATE_KEY 와 GITHUB_APP_PRIVATE_KEY_PATH 가 둘 다 있어 어느 것을 쓸지 모호하다 — 하나만 적는다(로컬은 경로, 클라우드는 내용).",
    };
  }
  const appId = Number(value("GITHUB_APP_ID"));
  const installationId = Number(value("GITHUB_APP_INSTALLATION_ID"));
  if (!Number.isSafeInteger(appId) || appId <= 0 || !Number.isSafeInteger(installationId) || installationId <= 0) {
    return { kind: "app_config_error", message: "GITHUB_APP_ID 와 GITHUB_APP_INSTALLATION_ID 는 양의 정수여야 한다." };
  }
  const key = hasContent ? keyFromContent(env["GITHUB_APP_PRIVATE_KEY"] ?? "") : keyFromPath(env["GITHUB_APP_PRIVATE_KEY_PATH"] ?? "", readFile);
  return "error" in key ? { kind: "app_config_error", message: key.error } : { kind: "app", appId, installationId, privateKeyPem: key.pem, repos };
}

/** "모자라다" 문장에서 비밀 키 자리의 이름 */
const KEY_VARS_LABEL = "GITHUB_APP_PRIVATE_KEY_PATH(또는 GITHUB_APP_PRIVATE_KEY)";

type KeyResult = { readonly pem: string } | { readonly error: string };

/** 경로로 받은 비밀 키. 화면에는 서버의 폴더 구조를 드러내지 않도록 파일 이름만 보인다. */
function keyFromPath(rawPath: string, readFile: (path: string) => string): KeyResult {
  // 경로 칸에는 경로만 온다. 키 내용을 붙여 넣은 것 같으면 그 값을 어디에도 싣지 않고 안내만 한다.
  if (looksLikeKeyContent(rawPath)) {
    return {
      error: "GITHUB_APP_PRIVATE_KEY_PATH 에 파일 경로가 아니라 키 내용이 들어 있는 것 같다 — 경로만 적고, 키 내용은 GITHUB_APP_PRIVATE_KEY 에 넣는다.",
    };
  }
  const path = rawPath.trim();
  const shown = basename(path);
  let pem: string;
  try {
    pem = readFile(path);
  } catch (error) {
    if (error instanceof KeyFileTooLargeError) return { error: `비밀 키 파일이 너무 크다(${MAX_KEY_FILE_BYTES / 1024}KB 초과): ${shown}` };
    return { error: `비밀 키 파일을 읽지 못했다: ${shown}` };
  }
  if (Buffer.byteLength(pem, "utf8") > MAX_KEY_FILE_BYTES) return { error: `비밀 키 파일이 너무 크다(${MAX_KEY_FILE_BYTES / 1024}KB 초과): ${shown}` };
  try {
    loadPrivateKey(pem);
  } catch {
    return { error: `비밀 키 파일의 내용이 RSA ${MIN_RSA_BITS}비트 이상의 비밀 키(PEM)가 아니다: ${shown}` };
  }
  return { pem };
}

/** 내용으로 받은 비밀 키. 형식이 틀리면 안내만 한다 — 내용 · 길이 · 앞부분을 싣지 않는다. */
function keyFromContent(raw: string): KeyResult {
  const unreadable = {
    error: `GITHUB_APP_PRIVATE_KEY 의 형식을 읽지 못했다 — .pem 파일 내용 전체(BEGIN · END 줄 포함, RSA ${MIN_RSA_BITS}비트 이상)를 붙여 넣는다.`,
  };
  if (Buffer.byteLength(raw, "utf8") > MAX_KEY_FILE_BYTES) return { error: `GITHUB_APP_PRIVATE_KEY 가 너무 크다(${MAX_KEY_FILE_BYTES / 1024}KB 초과).` };
  const pem = normalizePrivateKeyContent(raw);
  if (pem === null) return unreadable;
  try {
    loadPrivateKey(pem);
  } catch {
    return unreadable;
  }
  return { pem };
}

/**
 * 환경변수로 받은 키 내용을 PEM 으로 되돌린다. 환경 설정 칸마다 줄바꿈을 다르게 망가뜨리므로 다음 형태를 모두 받는다.
 *   1. 줄바꿈이 그대로 든 PEM (CRLF · 앞뒤 공백 포함)
 *   2. 줄바꿈이 `\n` 두 글자로 바뀐 PEM
 *   3. 줄바꿈이 공백으로 바뀌었거나 아예 사라진 PEM (한 줄만 받는 칸)
 *   4. base64 로 감싼 PEM (감싼 안쪽이 위 형태 중 무엇이든)
 * 방법: `-----BEGIN (RSA )PRIVATE KEY-----` 머리와 같은 종류의 꼬리를 찾고, 그 사이 본문에서 공백 · 줄바꿈 · `\n` 두 글자를 모두 걷어낸 뒤
 * 64자마다 줄바꿈해 다시 조립한다. 머리 · 꼬리의 종류(RSA PRIVATE KEY / PRIVATE KEY)는 그대로 둔다. PEM 으로 볼 수 없으면 null.
 */
export function normalizePrivateKeyContent(raw: string): string | null {
  const direct = rebuildPem(raw);
  if (direct !== null) return direct;
  const compact = raw.replace(/\\[rn]|\s+/g, "");
  if (compact === "" || !BASE64.test(compact)) return null;
  return rebuildPem(Buffer.from(compact, "base64").toString("utf8"));
}

const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const PEM_BLOCK = /-----BEGIN ((?:RSA )?PRIVATE KEY)-----([\s\S]*?)-----END \1-----/;

function rebuildPem(text: string): string | null {
  const match = PEM_BLOCK.exec(text);
  if (match === null) return null;
  const [, kind, rawBody = ""] = match;
  const body = rawBody.replace(/\\[rn]|\s+/g, "");
  if (body === "" || !BASE64.test(body)) return null;
  const lines = body.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${kind}-----\n${lines.join("\n")}\n-----END ${kind}-----\n`;
}

/** 비밀 키 파일의 크기 상한. RSA 키 파일은 몇 KB 이므로, 이보다 크면 잘못된 파일로 본다. */
export const MAX_KEY_FILE_BYTES = 64 * 1024;

class KeyFileTooLargeError extends Error {}

/** 비밀 키 파일을 읽는다. 크기를 먼저 확인해 큰 파일은 읽지 않는다. */
function readKeyFile(path: string): string {
  if (statSync(path).size > MAX_KEY_FILE_BYTES) throw new KeyFileTooLargeError();
  return readFileSync(path, "utf8");
}

/** 경로 칸의 값이 경로가 아니라 키 내용처럼 보이는가 (흔한 실수: PEM 을 통째로 붙여 넣기) */
export function looksLikeKeyContent(value: string): boolean {
  return value.includes("-----BEGIN") || /[\r\n]/.test(value.trim()) || value.length > 1024;
}

/** 설정 오류일 때의 리더. 동기화하면 설정 오류 문장을 그대로 알린다 — 시연 데이터로 바꿔치기하지 않는다. */
function unavailableReader(message: string, source: "github" | "github_app"): GitHubReader {
  const fail = async (): Promise<never> => {
    throw new GitHubReadError(message);
  };
  return { source, listRepositories: fail, listPullRequests: fail };
}

/** 출처의 화면 이름. 조직 이름과 저장소 이름은 비밀이 아니라서 보여도 된다(토큰은 싣지 않는다). */
export function sourceLabel(source: GitHubSource): string {
  if (source.kind === "app" || source.kind === "app_config_error") return "GitHub App";
  if (source.kind === "token") return `Token (${[...source.orgs, ...source.repos].join(", ")})`;
  return "Token";
}

function isConfigError(source: GitHubSource): source is Extract<GitHubSource, { message: string }> {
  return source.kind === "app_config_error" || source.kind === "token_config_error";
}

function createReaderFor(sources: readonly GitHubSource[]): GitHubReader {
  if (sources.length === 0) return createFixtureReader(demoFixtureData());
  const [only] = sources;
  if (sources.length === 1 && only !== undefined) return createReader(only);
  return createMultiReader(sources.map((source) => ({ label: sourceLabel(source), reader: createReader(source) })));
}

function createReader(source: GitHubSource): GitHubReader {
  // fetch 를 여기서 직접 부르지 않는다 — 부르는 곳은 GET 관문(guarded-get)과 인증 모듈(app-auth) 두 파일뿐이다
  const fetchImpl: FetchLike = globalThis.fetch.bind(globalThis);
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
      return unavailableReader(source.message, "github_app");
    case "token":
      return createGitHubRestReader({ token: source.token, repos: source.repos, orgs: source.orgs, fetch: fetchImpl });
    case "token_config_error":
      return unavailableReader(source.message, "github");
  }
}

export function createContainer(
  env: Record<string, string | undefined> = process.env,
  readFile?: (path: string) => string,
): Container {
  const githubSources = selectGitHubSources(env, readFile);
  const github = githubSources.length > 0;
  const configErrors = githubSources.filter(isConfigError).map((s) => s.message);
  const configError = configErrors.length === 0 ? null : configErrors.join(" / ");
  const databaseUrl = env["DATABASE_URL"]?.trim() ?? "";
  const pool = databaseUrl === "" ? null : new Pool({ connectionString: databaseUrl, max: 5 });
  // 쉬고 있는 연결이 끊겨도 서버 프로세스가 죽지 않게 한다. 오류 내용에는 연결 문자열을 싣지 않는다.
  pool?.on("error", () => console.error("PostgreSQL 연결 하나가 끊겼다. 다음 요청에서 새로 연결한다."));
  const seed = github ? {} : demoStudioSeed();
  const deps: AppDeps = {
    reader: createReaderFor(githubSources),
    store: pool === null ? createMemoryStore(seed) : createPostgresStore(pool),
    now: () => new Date(),
    newId: () => randomBytes(3).toString("hex"),
  };

  let status: SyncStatus = {
    lastSyncedAt: null,
    lastResult: null,
    lastError: configError,
    lastWarning: null,
    sources: [],
  };
  let first: Promise<void> | null = null;

  // 단일 비행: 동기화가 진행 중이면 새로 시작하지 않고 진행 중인 것을 함께 기다린다(Sync 를 겹쳐 눌러도 한 번)
  let running: Promise<void> | null = null;
  function sync(): Promise<void> {
    running ??= runSync().finally(() => {
      running = null;
    });
    return running;
  }

  async function runSync(): Promise<void> {
    try {
      const result = await syncAll(deps);
      const discarded = result.discarded.map((d) => `${d.repoId}#${d.number}(요청한 저장소 ${d.requestedRepoId})`);
      const skipped = result.skipped.map((d) => `${d.repoId}#${d.number}`);
      const warnings = [
        ...result.notes,
        discarded.length === 0 ? "" : `요청한 저장소와 다른 저장소의 PR ${discarded.length}개를 받아 버렸다: ${discarded.join(", ")}`,
        skipped.length === 0 ? "" : `저장할 수 없는 값이 든 PR ${skipped.length}개를 건너뛰었다: ${skipped.join(", ")}`,
      ].filter((w) => w !== "");
      status = {
        lastSyncedAt: deps.now().toISOString(),
        lastResult: { repositories: result.repositories, pullRequests: result.pullRequests, skipped: result.skipped.length },
        lastError: null,
        lastWarning: warnings.length === 0 ? null : warnings.join(" · "),
        sources: result.sources,
      };
    } catch (error) {
      status = { ...status, lastError: error instanceof Error ? error.message : "알 수 없는 오류", sources: [] };
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
    configError,
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

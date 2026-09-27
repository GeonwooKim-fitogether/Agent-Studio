/**
 * GitHub App 인증 — 비밀 키로 JWT 를 서명하고, 설치 토큰으로 바꾼다 (결정 11, docs/plan/03-github-app.md §2).
 *
 * 이 파일은 Agent Studio 에서 **POST 를 보낼 수 있는 유일한 곳**이다. 그 POST 는 설치 토큰 교환
 * (`POST https://api.github.com/app/installations/{설치 ID}/access_tokens`) 하나뿐이며, 저장소의 상태를 바꾸는
 * 요청이 아니라 인증 요청이다. 주소 · 호스트 · 메서드 · 본문을 모두 여기서 고정하고, 그 밖의 POST 는 보내기 전에 막는다.
 * 데이터 요청(GET)은 guarded-get.ts 가 보내며, 여기서 받은 토큰을 쓸 뿐이다.
 *
 * 비밀 키 · JWT · 설치 토큰은 오류 메시지 · 로그에 싣지 않는다. 오류에는 상태 코드와 무엇을 하던 중이었는지만 적는다.
 */
import { createPrivateKey, type KeyObject, sign } from "node:crypto";
import type { FetchLike } from "../rest/guarded-get";

const API_ORIGIN = "https://api.github.com";
const EXCHANGE_PATH = /^\/app\/installations\/[1-9][0-9]*\/access_tokens$/;

/**
 * 설치 토큰에 요청하는 권한. App 에 무엇이 켜져 있든 Studio 가 받는 토큰은 이 읽기 권한뿐이다(권한을 좁히는 요청).
 * GitHub 가 돌려준 토큰의 권한에 이보다 넓은 것(write · admin)이 있으면 그 토큰을 쓰지 않는다.
 */
export const READ_ONLY_PERMISSIONS = Object.freeze({
  pull_requests: "read",
  checks: "read",
  statuses: "read",
  contents: "read",
  metadata: "read",
} as const);

/** JWT 의 유효 시간. GitHub 는 발급 시각을 시계 차이 대비 60초 앞당기라고 하고, 만료는 10분 이내여야 한다. */
export const JWT_BACKDATE_SECONDS = 60;
export const JWT_LIFETIME_SECONDS = 9 * 60;
/** 설치 토큰은 만료 5분 전에 새로 받는다. */
export const TOKEN_REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** 인증 과정의 오류. 비밀 값은 싣지 않는다. */
export class GitHubAuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthError";
  }
}

/** 인증 모듈이 막은 요청. 네트워크로 나가지 않았다. */
export class GitHubAuthRequestBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubAuthRequestBlockedError";
  }
}

/** 비밀 키 글(PEM)을 키 객체로. 내용이 비밀 키가 아니면 내용을 싣지 않은 오류를 낸다. */
/** RSA 키의 최소 길이. GitHub 가 발급하는 App 키는 2048비트이며, 그보다 짧은 키는 받지 않는다. */
export const MIN_RSA_BITS = 2048;

export function loadPrivateKey(pem: string): KeyObject {
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    throw new GitHubAuthError("비밀 키가 올바른 RSA 비밀 키(PEM)가 아니다.");
  }
  if (key.asymmetricKeyType !== "rsa") throw new GitHubAuthError("비밀 키가 올바른 RSA 비밀 키(PEM)가 아니다.");
  if ((key.asymmetricKeyDetails?.modulusLength ?? 0) < MIN_RSA_BITS) {
    throw new GitHubAuthError(`비밀 키가 너무 짧다(RSA ${MIN_RSA_BITS}비트 미만).`);
  }
  return key;
}

/** 받은 토큰의 권한 목록이 요청한 읽기 권한과 정확히 같은지. 같으면 null, 다르면 사람이 읽을 이유(값은 싣지 않는다). */
export function permissionProblem(granted: unknown): string | null {
  if (typeof granted !== "object" || granted === null || Array.isArray(granted)) return "권한 목록이 없다";
  const entries = Object.entries(granted as Record<string, unknown>);
  const expected = Object.keys(READ_ONLY_PERMISSIONS);
  const extra = entries.filter(([name]) => !expected.includes(name)).map(([name]) => name);
  if (extra.length > 0) return `요청하지 않은 권한이 있다(${extra.join(", ")})`;
  const notRead = expected.filter((name) => (granted as Record<string, unknown>)[name] !== "read");
  if (notRead.length > 0) return `읽기 권한이 정확히 맞지 않는다(${notRead.join(", ")})`;
  return null;
}

const b64url = (value: string | Buffer) => Buffer.from(value).toString("base64url");

/** App 이 자기임을 증명하는 짧은 JWT (RS256). */
export function createAppJwt(input: { readonly appId: number; readonly privateKey: KeyObject; readonly nowMs: number }): string {
  const now = Math.floor(input.nowMs / 1000);
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({ iat: now - JWT_BACKDATE_SECONDS, exp: now + JWT_LIFETIME_SECONDS, iss: String(input.appId) }),
  );
  const signature = sign("RSA-SHA256", Buffer.from(`${header}.${payload}`), input.privateKey);
  return `${header}.${payload}.${b64url(signature)}`;
}

/** 토큰 교환 요청인지 확인한다. POST · api.github.com · 정해진 경로 모양이 아니면 보내기 전에 막는다. */
export function assertTokenExchangeRequest(method: string, url: string): URL {
  if (method !== "POST") throw new GitHubAuthRequestBlockedError(`인증 모듈은 POST 토큰 교환만 보낸다 (요청된 메서드: ${method})`);
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitHubAuthRequestBlockedError("주소를 해석할 수 없어 요청하지 않는다");
  }
  if (parsed.origin !== API_ORIGIN || parsed.username !== "" || parsed.password !== "") {
    throw new GitHubAuthRequestBlockedError(`${API_ORIGIN} 이외의 주소로는 토큰을 요청하지 않는다`);
  }
  if (!EXCHANGE_PATH.test(parsed.pathname) || parsed.search !== "" || parsed.hash !== "") {
    throw new GitHubAuthRequestBlockedError("설치 토큰 교환 주소가 아닌 곳으로는 POST 를 보내지 않는다");
  }
  return parsed;
}

/**
 * 요청 계수기. 실제로 네트워크로 나가는 요청(리디렉션 · 401 재시도 · 토큰 교환 포함) 하나마다 count() 를 부른다.
 * 상한을 넘으면 count() 가 던져 그 요청은 나가지 않는다. 동기화 1회마다 새로 만든다.
 */
export interface RequestMeter {
  count(): void;
}

/** 데이터 리더가 쓰는 토큰 공급자. 토큰은 여기서만 만들어진다. */
export interface TokenSource {
  getToken(meter?: RequestMeter): Promise<string>;
  /** 이 토큰이 거절됐다(401). 다음 getToken 은 새 토큰을 받는다. */
  invalidate(token: string): void;
}

export interface InstallationTokenSourceOptions {
  readonly appId: number;
  readonly installationId: number;
  readonly privateKey: KeyObject;
  readonly fetch: FetchLike;
  readonly now?: () => number;
}

/**
 * 설치 토큰 공급자. 토큰을 기억해 두고, 만료 5분 전에 새로 받는다.
 * 동시에 여러 요청이 토큰을 달라고 해도 교환은 한 번만 한다(진행 중인 교환을 함께 기다린다).
 */
export function createInstallationTokenSource(options: InstallationTokenSourceOptions): TokenSource {
  const now = options.now ?? (() => Date.now());
  if (!Number.isSafeInteger(options.installationId) || options.installationId <= 0) {
    throw new GitHubAuthError("설치 ID 는 양의 정수여야 한다.");
  }
  if (!Number.isSafeInteger(options.appId) || options.appId <= 0) throw new GitHubAuthError("App ID 는 양의 정수여야 한다.");

  let cached: { token: string; expiresAtMs: number } | null = null;
  let meterForExchange: RequestMeter | undefined;
  let inFlight: Promise<string> | null = null;

  async function exchange(): Promise<string> {
    const url = assertTokenExchangeRequest("POST", `${API_ORIGIN}/app/installations/${options.installationId}/access_tokens`);
    const jwt = createAppJwt({ appId: options.appId, privateKey: options.privateKey, nowMs: now() });
    let response: Response;
    meterForExchange?.count(); // 교환 POST 도 한 번의 요청으로 센다
    try {
      response = await options.fetch(url.href, {
        method: "POST",
        redirect: "manual", // 교환 요청은 다른 곳으로 따라가지 않는다
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${jwt}`,
          "Content-Type": "application/json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({ permissions: READ_ONLY_PERMISSIONS }),
      });
    } catch {
      throw new GitHubAuthError("GitHub 에 닿지 못해 설치 토큰을 받지 못했다.");
    }
    if (response.status !== 201) {
      throw new GitHubAuthError(`GitHub 가 설치 토큰 요청을 거절했다: ${response.status}. App ID · 설치 ID · 비밀 키를 확인한다.`);
    }
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new GitHubAuthError("설치 토큰 응답을 읽지 못했다.");
    }
    const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
    const token = record["token"];
    const expiresAt = Date.parse(String(record["expires_at"]));
    if (typeof token !== "string" || token === "" || Number.isNaN(expiresAt)) {
      throw new GitHubAuthError("설치 토큰 응답의 모양이 예상과 다르다.");
    }
    // 닫힌 쪽으로 확인한다: 권한 목록이 객체이고, 요청한 다섯 권한이 모두 정확히 "read" 이며, 그 밖의 권한이 없을 때만 쓴다.
    // 목록이 없거나 · null · 문자열 · 배열 · 빈 객체이거나, 하나라도 다르면 토큰을 버린다(모르면 거절).
    const problem = permissionProblem(record["permissions"]);
    if (problem !== null) throw new GitHubAuthError(`설치 토큰의 권한을 확인할 수 없어 쓰지 않는다: ${problem}`);
    // 이미 만료됐거나 갱신 여유(5분)보다 짧게 사는 토큰은 받자마자 또 교환하게 만들므로 받지 않는다.
    if (expiresAt - now() <= TOKEN_REFRESH_MARGIN_MS) {
      throw new GitHubAuthError("설치 토큰의 남은 수명이 5분 이하라 쓰지 않는다. 서버 시계와 GitHub 응답을 확인한다.");
    }
    cached = { token, expiresAtMs: expiresAt };
    return token;
  }

  return {
    async getToken(meter) {
      if (cached !== null && cached.expiresAtMs - now() > TOKEN_REFRESH_MARGIN_MS) return cached.token;
      if (inFlight === null) meterForExchange = meter; // 교환을 일으킨 동기화의 계수기가 그 교환을 센다
      inFlight ??= exchange().finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    invalidate(token) {
      if (cached?.token === token) cached = null;
    },
  };
}

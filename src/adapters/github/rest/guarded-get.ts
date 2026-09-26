/**
 * GitHub REST API 에 GET 만 보내는 관문.
 *
 * REST 어댑터의 모든 요청은 이 함수를 지난다. 요청을 보내기 **전에** 두 가지를 확인하고, 어기면 오류를 낸다.
 *   1. 메서드가 GET 인가 — POST · PATCH · PUT · DELETE 는 한 번도 네트워크로 나가지 않는다.
 *   2. 주소가 https://api.github.com 인가 — 다른 호스트, http, 주소 안의 계정 정보는 거절한다.
 * 리디렉션도 자동으로 따라가지 않고, 새 주소를 같은 관문에 다시 통과시킨 뒤에만 따라간다.
 *
 * 토큰은 Authorization 헤더에만 싣는다. 오류 메시지에는 메서드 · 경로 · 상태 코드만 담고,
 * 헤더와 응답 본문은 담지 않는다 — 토큰이 로그나 화면에 새어 나갈 길을 막기 위해서다.
 */

export const GITHUB_API_ORIGIN = "https://api.github.com";
const MAX_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** 관문이 요청을 막았을 때의 오류. 요청은 네트워크로 나가지 않았다. */
export class GitHubRequestBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GitHubRequestBlockedError";
  }
}

/** GitHub 가 요청을 거절했거나 네트워크가 실패했을 때의 오류. GitHub 가 거절했으면 그 상태 코드를 status 에 둔다. */
export class GitHubReadError extends Error {
  readonly status: number | undefined;
  constructor(message: string, status?: number) {
    super(message);
    this.name = "GitHubReadError";
    this.status = status;
  }
}

/** 한 번의 Sync 에서 실제로 나가는 요청의 상한. 여러 출처를 함께 읽으면 모든 출처가 이 수를 나눠 쓴다. */
export const MAX_REQUESTS_PER_SYNC = 1500;

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;

/**
 * 토큰 공급자. 개인 토큰이면 늘 같은 값을 주고, GitHub App 이면 인증 모듈(app-auth)이 설치 토큰을 준다.
 * invalidate 가 있으면, 401 을 받았을 때 그 토큰을 버리고 새 토큰으로 **한 번만** 다시 시도한다.
 */
export interface TokenProvider {
  getToken(meter?: RequestMeter): Promise<string>;
  invalidate?(token: string): void;
}

/** 요청 계수기 (app-auth 의 RequestMeter 와 같은 모양). 실제 fetch 한 번마다 count() — 상한을 넘으면 던진다. */
export interface RequestMeter {
  count(): void;
}

/** 동기화 1회분의 요청 계수기를 만든다. 상한을 넘는 요청은 보내기 전에 멈춘다. */
export function createRequestMeter(max: number): RequestMeter & { readonly used: () => number } {
  let used = 0;
  return {
    count() {
      if (used >= max) {
        throw new GitHubReadError(`한 번의 Sync 요청 상한(${max}번)에 닿아 멈췄다. 저장소나 PR 이 너무 많다 — GITHUB_REPOS 로 좁힌다.`);
      }
      used += 1;
    },
    used: () => used,
  };
}

export interface GuardedGetOptions {
  /** 개인 토큰(개발용 경로). tokens 와 둘 중 하나만 준다 */
  readonly token?: string;
  readonly tokens?: TokenProvider;
  readonly fetch: FetchLike;
  /** 있으면 실제로 나가는 요청(리디렉션 · 401 재시도 포함) 하나마다 센다 */
  readonly meter?: RequestMeter;
}

/** 한 요청의 추가 제한. 리디렉션 대상 주소가 이 확인을 통과하지 못하면 따라가지 않는다. */
export interface PageOptions {
  readonly allowRedirect?: (target: URL) => boolean;
}

/** 한 페이지의 응답과, GitHub 가 Link 헤더로 알려 준 다음 페이지 주소(없으면 null). */
export interface GuardedPage {
  readonly json: unknown;
  readonly next: string | null;
}

/** Link 헤더에서 rel="next" 주소를 꺼낸다. 다음 주소도 요청할 때 관문을 다시 거친다. */
export function nextPageUrl(link: string | null): string | null {
  if (link === null) return null;
  for (const part of link.split(",")) {
    const match = /<([^>]+)>\s*;\s*rel="?next"?/.exec(part.trim());
    if (match?.[1] !== undefined) return match[1];
  }
  return null;
}

/** 관문을 거친 GET 요청 함수를 만든다. 두 번째 인자의 method 는 관문 시험을 위해 받을 뿐, GET 이 아니면 막힌다. */
export function createGuardedGet(options: GuardedGetOptions) {
  const { fetch: fetchImpl } = options;
  const staticToken = options.token;
  const tokens: TokenProvider = options.tokens ?? { getToken: async () => staticToken ?? "" };

  const meter = options.meter;

  async function send(url: string, method: string, pageOptions: PageOptions = {}): Promise<GuardedPage> {
    let target = assertAllowed(method, url);
    let token = await tokens.getToken(meter);
    let retriedAfter401 = false;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      let response: Response;
      meter?.count(); // 실제로 나가는 요청 하나 — 상한을 넘으면 여기서 멈추고 나가지 않는다
      try {
        response = await fetchImpl(target.href, {
          method: "GET",
          redirect: "manual",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${token}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        });
      } catch {
        // 원래 오류 객체를 그대로 싣지 않는다. 그 안에 요청 정보가 들어 있을 수 있기 때문이다.
        throw new GitHubReadError(`GitHub 에 닿지 못했다 (GET ${target.pathname})`);
      }

      if (response.status === 401 && tokens.invalidate !== undefined && !retriedAfter401) {
        // 토큰이 만료됐거나 취소됐다 — 버리고 새 토큰으로 한 번만 다시 시도한다
        tokens.invalidate(token);
        token = await tokens.getToken(meter);
        retriedAfter401 = true;
        hop -= 1;
        continue;
      }
      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        if (location === null) throw new GitHubReadError(`GitHub 가 이동할 주소 없이 ${response.status} 를 돌려줬다 (GET ${target.pathname})`);
        target = assertAllowed("GET", resolveLocation(location, target));
        if (pageOptions.allowRedirect !== undefined && !pageOptions.allowRedirect(target)) {
          throw new GitHubRequestBlockedError(`예상하지 않은 곳으로의 리디렉션은 따라가지 않는다 (${target.pathname})`);
        }
        continue;
      }
      if (!response.ok) {
        throw new GitHubReadError(`GitHub 가 요청을 거절했다: ${response.status} (GET ${target.pathname})`, response.status);
      }
      try {
        return { json: await response.json(), next: nextPageUrl(response.headers.get("link")) };
      } catch {
        throw new GitHubReadError(`GitHub 응답을 JSON 으로 읽지 못했다 (GET ${target.pathname})`);
      }
    }
    throw new GitHubReadError(`리디렉션이 ${MAX_REDIRECTS}번을 넘었다`);
  }

  async function guardedGet(url: string, init: { readonly method?: string } = {}): Promise<unknown> {
    return (await send(url, init.method ?? "GET")).json;
  }
  /** 한 페이지를 읽고 다음 페이지 주소도 돌려준다. */
  guardedGet.page = (url: string, pageOptions?: PageOptions): Promise<GuardedPage> => send(url, "GET", pageOptions);
  return guardedGet;
}

/** 리디렉션 주소를 절대 주소로. 해석할 수 없는 주소면 날것의 TypeError 대신 GitHubReadError 를 낸다(주소도 토큰도 싣지 않는다). */
function resolveLocation(location: string, base: URL): string {
  try {
    return new URL(location, base).href;
  } catch {
    throw new GitHubReadError(`GitHub 가 해석할 수 없는 이동 주소를 돌려줬다 (GET ${base.pathname})`);
  }
}

function assertAllowed(method: string, url: string): URL {
  if (method.toUpperCase() !== "GET") {
    throw new GitHubRequestBlockedError(`GET 이외의 요청은 보내지 않는다 (요청된 메서드: ${method.toUpperCase()})`);
  }
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new GitHubRequestBlockedError("주소를 해석할 수 없어 요청하지 않는다");
  }
  if (parsed.username !== "" || parsed.password !== "") {
    throw new GitHubRequestBlockedError("주소에 계정 정보가 든 요청은 보내지 않는다");
  }
  if (parsed.origin !== GITHUB_API_ORIGIN) {
    throw new GitHubRequestBlockedError(`${GITHUB_API_ORIGIN} 이외의 주소로는 요청하지 않는다 (요청된 곳: ${parsed.origin})`);
  }
  return parsed;
}

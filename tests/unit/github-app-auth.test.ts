/**
 * GitHub App 인증 모듈 — JWT 규격, 설치 토큰 교환(읽기 권한만), POST 경계, 만료 전 갱신, 동시 요청, 비밀 노출.
 * docs/plan/03-github-app.md §4 의 1 · 2 · 3 · 4. 시험용 RSA 키는 여기서 만들고 파일로 남기지 않는다.
 */
import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertTokenExchangeRequest,
  createAppJwt,
  createInstallationTokenSource,
  GitHubAuthError,
  GitHubAuthRequestBlockedError,
  JWT_BACKDATE_SECONDS,
  loadPrivateKey,
  READ_ONLY_PERMISSIONS,
} from "../../src/adapters/github/app-auth/app-auth";

const { privateKey: PEM, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY = loadPrivateKey(PEM);
const APP_ID = 424242;
const INSTALLATION_ID = 7777777;
const EXCHANGE_URL = `https://api.github.com/app/installations/${INSTALLATION_ID}/access_tokens`;
const NOW = Date.parse("2026-09-25T09:00:00.000Z");

const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;

interface Exchange {
  url: string;
  init: RequestInit;
}

/** 설치 토큰을 차례로 내주는 가짜 GitHub. 교환 요청을 모두 기록한다. */
function fakeExchange(tokens: string[], expiresInMs = 60 * 60 * 1000, extra: Record<string, unknown> = {}) {
  const calls: Exchange[] = [];
  let clock = NOW;
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, init });
    await new Promise((r) => setTimeout(r, 5)); // 교환이 잠깐 걸린다 — 동시 요청을 겹치게 한다
    const token = tokens[calls.length - 1] ?? "ghs_extra";
    return new Response(
      JSON.stringify({ token, expires_at: new Date(clock + expiresInMs).toISOString(), permissions: { ...READ_ONLY_PERMISSIONS }, ...extra }),
      { status: 201 },
    );
  };
  return {
    calls,
    fetch,
    setClock: (ms: number) => {
      clock = ms;
    },
    now: () => clock,
  };
}

function expectNoSecrets(text: string, secrets: readonly string[]) {
  for (const secret of secrets) expect(text).not.toContain(secret);
  expect(text).not.toContain("PRIVATE KEY");
}

describe("JWT (App 이 자기임을 증명하는 짧은 서명)", () => {
  it("RS256 으로 서명되고, 공개 키로 검증되며, iat 는 60초 전 · exp 는 10분 이내 · iss 는 App ID 다", () => {
    const jwt = createAppJwt({ appId: APP_ID, privateKey: KEY, nowMs: NOW });
    const [header, payload, signature] = jwt.split(".");
    if (header === undefined || payload === undefined || signature === undefined) throw new Error("JWT 는 세 조각이다");

    expect(decode(header)).toEqual({ alg: "RS256", typ: "JWT" });
    const valid = verify("RSA-SHA256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url"));
    expect(valid).toBe(true);

    const claims = decode(payload);
    const now = NOW / 1000;
    expect(claims["iat"]).toBe(now - JWT_BACKDATE_SECONDS);
    expect(Number(claims["exp"])).toBeGreaterThan(now);
    expect(Number(claims["exp"]) - now).toBeLessThanOrEqual(600);
    expect(claims["iss"]).toBe(String(APP_ID));
  });

  it("다른 키로는 검증되지 않는다 (서명이 실제로 그 비밀 키의 것이다)", () => {
    const other = generateKeyPairSync("rsa", { modulusLength: 2048 }).publicKey;
    const [h, p, sig] = createAppJwt({ appId: APP_ID, privateKey: KEY, nowMs: NOW }).split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), other, Buffer.from(String(sig), "base64url"))).toBe(false);
  });

  it("비밀 키가 아닌 글은 내용을 싣지 않은 오류로 거절한다", () => {
    const error = (() => {
      try {
        loadPrivateKey("-----BEGIN NOT A KEY----- SECRET_CONTENT_XYZ");
      } catch (e) {
        return e as Error;
      }
      throw new Error("오류가 나야 한다");
    })();
    expect(error).toBeInstanceOf(GitHubAuthError);
    expect(error.message).not.toContain("SECRET_CONTENT_XYZ");
  });
});

describe("설치 토큰 교환 — 인증 모듈의 유일한 POST", () => {
  it("정해진 주소로 POST 하고, 본문은 읽기 권한만 요청하며, JWT 를 Authorization 에 싣고, 리디렉션을 따라가지 않는다", async () => {
    const gh = fakeExchange(["ghs_first"]);
    const source = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: gh.fetch, now: gh.now });

    expect(await source.getToken()).toBe("ghs_first");

    expect(gh.calls).toHaveLength(1);
    const [call] = gh.calls;
    expect(call?.url).toBe(EXCHANGE_URL);
    expect(call?.init.method).toBe("POST");
    expect(call?.init.redirect).toBe("manual");
    expect(JSON.parse(String(call?.init.body))).toEqual({
      permissions: { pull_requests: "read", checks: "read", statuses: "read", contents: "read", metadata: "read" },
    });
    const auth = new Headers(call?.init.headers).get("authorization") ?? "";
    const jwt = auth.replace(/^Bearer /, "");
    const [h, p, sig] = jwt.split(".");
    expect(verify("RSA-SHA256", Buffer.from(`${h}.${p}`), publicKey, Buffer.from(String(sig), "base64url"))).toBe(true);
  });

  it.each([
    ["GET", EXCHANGE_URL],
    ["PUT", EXCHANGE_URL],
    ["PATCH", EXCHANGE_URL],
    ["DELETE", EXCHANGE_URL],
    ["post", EXCHANGE_URL],
    ["POST", "https://evil.test/app/installations/1/access_tokens"],
    ["POST", "http://api.github.com/app/installations/1/access_tokens"],
    ["POST", "https://api.github.com/repos/a/b/pulls"],
    ["POST", "https://api.github.com/repos/a/b/issues/1/comments"],
    ["POST", "https://api.github.com/app/installations/1/access_tokens/extra"],
    ["POST", "https://api.github.com/app/installations/abc/access_tokens"],
    ["POST", "https://api.github.com/app/installations/0/access_tokens"],
    ["POST", "https://api.github.com/app/installations/1/access_tokens?x=1"],
    ["POST", "https://user:pw@api.github.com/app/installations/1/access_tokens"],
  ])("%s %s 는 보내기 전에 막는다", (method, url) => {
    expect(() => assertTokenExchangeRequest(method, url)).toThrow(GitHubAuthRequestBlockedError);
  });

  it("정해진 교환 주소 하나만 통과한다", () => {
    expect(assertTokenExchangeRequest("POST", EXCHANGE_URL).pathname).toBe(`/app/installations/${INSTALLATION_ID}/access_tokens`);
  });

  it("GitHub 가 읽기보다 넓은 권한의 토큰을 주면 쓰지 않는다", async () => {
    const gh = fakeExchange(["ghs_wide"], 3_600_000, { permissions: { pull_requests: "write", contents: "read" } });
    const source = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: gh.fetch, now: gh.now });
    const error = await source.getToken().catch((e: unknown) => e as Error);
    expect(error).toBeInstanceOf(GitHubAuthError);
    expect((error as Error).message).toContain("pull_requests");
    expect((error as Error).message).not.toContain("ghs_wide");
  });

  it("설치 ID · App ID 가 양의 정수가 아니면 토큰 공급자를 만들지 않는다", () => {
    const fetch = async () => new Response("{}", { status: 201 });
    expect(() => createInstallationTokenSource({ appId: APP_ID, installationId: 0, privateKey: KEY, fetch })).toThrow(GitHubAuthError);
    expect(() => createInstallationTokenSource({ appId: -1, installationId: 1, privateKey: KEY, fetch })).toThrow(GitHubAuthError);
  });
});

describe("토큰 수명", () => {
  it("만료 5분 전까지는 같은 토큰을 쓰고, 5분 안으로 들어오면 새로 받는다", async () => {
    const gh = fakeExchange(["ghs_one", "ghs_two"]);
    const source = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: gh.fetch, now: gh.now });
    expect(await source.getToken()).toBe("ghs_one"); // 만료는 NOW + 60분

    gh.setClock(NOW + 54 * 60 * 1000); // 만료 6분 전
    expect(await source.getToken()).toBe("ghs_one");
    expect(gh.calls).toHaveLength(1);

    gh.setClock(NOW + 56 * 60 * 1000); // 만료 4분 전
    expect(await source.getToken()).toBe("ghs_two");
    expect(gh.calls).toHaveLength(2);
  });

  it("동시에 여러 요청이 토큰을 달라고 해도 교환은 한 번만 한다", async () => {
    const gh = fakeExchange(["ghs_shared", "ghs_should_not_be_used"]);
    const source = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: gh.fetch, now: gh.now });
    const tokens = await Promise.all(Array.from({ length: 8 }, () => source.getToken()));
    expect(new Set(tokens)).toEqual(new Set(["ghs_shared"]));
    expect(gh.calls).toHaveLength(1);
  });

  it("거절된 토큰을 버리면(invalidate) 다음 요청이 새 토큰을 받는다. 다른 토큰 이름으로 버려도 지금 토큰은 그대로다", async () => {
    const gh = fakeExchange(["ghs_old", "ghs_new"]);
    const source = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: gh.fetch, now: gh.now });
    await source.getToken();
    source.invalidate("ghs_someone_else");
    expect(await source.getToken()).toBe("ghs_old");
    source.invalidate("ghs_old");
    expect(await source.getToken()).toBe("ghs_new");
  });
});

describe("비밀 노출", () => {
  it("교환이 거절되거나 네트워크가 실패해도 오류에 JWT · 비밀 키 · 토큰이 없다", async () => {
    let seenJwt = "";
    const rejecting = async (_url: string, init: RequestInit) => {
      seenJwt = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer /, "");
      return new Response(JSON.stringify({ message: `Bad credentials ${seenJwt}` }), { status: 401 });
    };
    const a = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: rejecting });
    const rejected = (await a.getToken().catch((e: unknown) => e)) as Error;
    expect(rejected).toBeInstanceOf(GitHubAuthError);
    expect(rejected.message).toContain("401");
    expect(seenJwt.length).toBeGreaterThan(100);
    expectNoSecrets(`${rejected.message}\n${rejected.stack}\n${JSON.stringify(rejected)}`, [seenJwt, PEM.slice(40, 80)]);

    const failing = async (_url: string, init: RequestInit): Promise<Response> => {
      throw new Error(`socket hang up ${new Headers(init.headers).get("authorization")}`);
    };
    const b = createInstallationTokenSource({ appId: APP_ID, installationId: INSTALLATION_ID, privateKey: KEY, fetch: failing });
    const network = (await b.getToken().catch((e: unknown) => e)) as Error;
    expect(network).toBeInstanceOf(GitHubAuthError);
    expectNoSecrets(`${network.message}\n${network.stack}`, [seenJwt]);
  });
});

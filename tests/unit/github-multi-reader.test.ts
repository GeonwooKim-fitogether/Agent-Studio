/**
 * 두 GitHub 출처를 함께 읽기 (결정 12) — GitHub App(개인 계정 저장소) + 사용자 토큰(조직 저장소).
 * 가짜 GitHub(주입한 fetch)로 합치기 · 저장소 중복 제거 · 조직 저장소 페이지 넘김 · 출처별 실패 분리 · 요청 상한 공유를 시험한다.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubAppReader } from "../../src/adapters/github/app/app-reader";
import { createInstallationTokenSource, loadPrivateKey, READ_ONLY_PERMISSIONS } from "../../src/adapters/github/app-auth/app-auth";
import { createMultiReader } from "../../src/adapters/github/multi/multi-reader";
import { createGitHubRestReader } from "../../src/adapters/github/rest/rest-reader";
import { createMemoryStore } from "../../src/adapters/store/memory/memory-store";
import type { AppDeps } from "../../src/application/deps";
import { syncAll } from "../../src/application/sync";
import type { GitHubReader } from "../../src/ports/github-reader";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SourceStatusList } from "../../src/app/components/source-status";
import { createContainer } from "../../src/server/container";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const API = "https://api.github.com";
const USER_TOKEN = "github_pat_ORG_USER_SECRET_123456789";
const APP_TOKEN = "ghs_APP_INSTALLATION_SECRET_987";

function pull(repoId: number, number: number) {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state: "open",
    merged_at: null,
    html_url: `https://github.com/x/y/pull/${number}`,
    updated_at: "2026-09-26T00:00:00Z",
    user: { login: "dev" },
    head: { ref: `feat/${number}`, sha: String(number % 10).repeat(40), repo: { id: repoId } },
    base: { repo: { id: repoId } },
  };
}

// App 쪽: 개인 계정 저장소 둘
const installationRepos = `${API}/installation/repositories?per_page=100`;
const appOpen = (name: string) => `${API}/repos/${name}/pulls?state=open&sort=created&direction=desc&per_page=100`;
const appClosed = (name: string) => `${API}/repos/${name}/pulls?state=closed&sort=updated&direction=desc&per_page=30`;
// 토큰 쪽: 조직 저장소 목록(두 페이지) — 두 번째 페이지에 App 에도 있는 저장소(1001)가 섞여 있다
const orgPage1 = `${API}/orgs/fitogether-org/repos?type=all&sort=full_name&per_page=100`;
const orgPage2 = `${API}/orgs/fitogether-org/repos?type=all&sort=full_name&per_page=100&page=2`;
const tokenPulls = (name: string) => `${API}/repos/${name}/pulls?state=all&sort=updated&direction=desc&per_page=50`;

interface Route {
  readonly body: unknown;
  readonly next?: string;
}

const routes: Record<string, Route> = {
  [installationRepos]: {
    body: {
      repositories: [
        { id: 1001, full_name: "geonwoo/personal" },
        { id: 1002, full_name: "geonwoo/notes" },
      ],
    },
  },
  [appOpen("geonwoo/personal")]: { body: [pull(1001, 1)] },
  [appClosed("geonwoo/personal")]: { body: [] },
  [appOpen("geonwoo/notes")]: { body: [pull(1002, 2)] },
  [appClosed("geonwoo/notes")]: { body: [] },
  [orgPage1]: { body: [{ id: 2001, full_name: "fitogether-org/web" }], next: orgPage2 },
  [orgPage2]: {
    body: [
      { id: 2002, full_name: "fitogether-org/api" },
      { id: 1001, full_name: "geonwoo/personal" },
    ],
  },
  [tokenPulls("fitogether-org/web")]: { body: [pull(2001, 11), pull(2001, 12)] },
  [tokenPulls("fitogether-org/api")]: { body: [pull(2002, 13)] },
  [tokenPulls("geonwoo/personal")]: { body: [pull(1001, 1)] },
  [`${API}/repos/geonwoo/personal`]: { body: { id: 1001, full_name: "geonwoo/personal" } },
};

interface Call {
  readonly method: string;
  readonly url: string;
  readonly token: string;
}

/**
 * 가짜 GitHub. 토큰 교환(POST)은 App 설치 토큰을 내준다. GET 은 routes 에서 찾는다.
 * failUserToken 이 있으면 사용자 토큰으로 온 GET 중 그 조건에 맞는 것에 그 상태 코드를 돌려준다.
 */
function fakeGitHub(options: { failUserToken?: { status: number; when?: (url: string) => boolean }; failApp?: number } = {}) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const token = (new Headers(init.headers).get("authorization") ?? "").replace(/^Bearer /, "");
    calls.push({ method: String(init.method), url, token });
    if (init.method === "POST") {
      if (options.failApp !== undefined) return new Response(JSON.stringify({ message: "nope" }), { status: options.failApp });
      return new Response(
        JSON.stringify({ token: APP_TOKEN, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { ...READ_ONLY_PERMISSIONS } }),
        { status: 201 },
      );
    }
    const fail = options.failUserToken;
    if (token === USER_TOKEN && fail !== undefined && (fail.when?.(url) ?? true)) {
      return new Response(JSON.stringify({ message: `denied for ${USER_TOKEN}` }), { status: fail.status });
    }
    const route = routes[url];
    if (route === undefined) {
      if (url.includes("/check-runs")) return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
      if (url.includes("/reviews")) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    const headers = route.next === undefined ? undefined : { link: `<${route.next}>; rel="next"` };
    return new Response(JSON.stringify(route.body), { status: 200, headers });
  };
  return { fetch, calls };
}

function sources(gh: ReturnType<typeof fakeGitHub>, extra: { maxRequests?: number; repos?: string[] } = {}): GitHubReader {
  const app = createGitHubAppReader({
    tokens: createInstallationTokenSource({ appId: 11, installationId: 22, privateKey: loadPrivateKey(PEM), fetch: gh.fetch }),
    fetch: gh.fetch,
  });
  const token = createGitHubRestReader({ token: USER_TOKEN, orgs: ["fitogether-org"], repos: extra.repos ?? [], fetch: gh.fetch });
  return createMultiReader(
    [
      { label: "GitHub App", reader: app },
      { label: "Token (fitogether-org)", reader: token },
    ],
    extra.maxRequests === undefined ? {} : { maxRequests: extra.maxRequests },
  );
}

function deps(reader: GitHubReader): AppDeps {
  let n = 0;
  return { reader, store: createMemoryStore({}), now: () => new Date("2026-09-26T00:00:00Z"), newId: () => `id${(n += 1)}` };
}

const noSecret = (value: unknown) => {
  const text = JSON.stringify(value);
  expect(text).not.toContain(USER_TOKEN);
  expect(text).not.toContain(APP_TOKEN);
  expect(text).not.toContain("PRIVATE KEY");
};

describe("두 출처 함께 읽기 (결정 12)", () => {
  it("App 과 토큰의 저장소를 한 번의 Sync 에 합친다 — 조직 저장소는 페이지를 넘겨 끝까지 읽는다", async () => {
    const gh = fakeGitHub();
    const d = deps(sources(gh));
    const result = await syncAll(d);

    expect(result.repositories).toBe(4);
    const snapshots = await d.store.listSnapshots();
    expect(snapshots.map((s) => [s.repoId, s.number]).sort()).toEqual([
      [1001, 1],
      [1002, 2],
      [2001, 11],
      [2001, 12],
      [2002, 13],
    ]);
    expect(gh.calls.some((c) => c.url === orgPage2)).toBe(true); // 두 번째 페이지까지 읽었다
    expect(result.sources).toEqual([
      { label: "GitHub App", repositories: 2, pullRequests: 2, error: null },
      { label: "Token (fitogether-org)", repositories: 2, pullRequests: 3, error: null },
    ]);
  });

  it("같은 저장소(숫자 ID 같음)가 두 출처에 다 있으면 App 으로 한 번만 읽고, 토큰으로는 그 저장소의 PR 을 요청하지 않는다", async () => {
    const gh = fakeGitHub();
    const d = deps(sources(gh, { repos: ["geonwoo/personal"] })); // 토큰 쪽 GITHUB_REPOS 에도 같은 저장소
    const result = await syncAll(d);

    expect(result.repositories).toBe(4);
    const personal = (await d.store.listSnapshots()).filter((s) => s.repoId === 1001);
    expect(personal).toHaveLength(1);
    expect(gh.calls.filter((c) => c.url === tokenPulls("geonwoo/personal"))).toHaveLength(0);
    expect(gh.calls.filter((c) => c.url === appOpen("geonwoo/personal") && c.token === APP_TOKEN)).toHaveLength(1);
    expect(result.notes).toContain("두 출처에 모두 있는 저장소 1개는 GitHub App 로 한 번만 읽었다");
  });

  it.each([
    [401, "인증이 거절됐다 — 토큰이 만료됐거나 취소됐다"],
    [403, "조직이 이 토큰을 아직 승인하지 않았다(Pending)"],
  ])("토큰이 %i 로 거절돼도 App 의 결과는 받아 적고, 출처별 상태에 토큰의 실패 이유가 보인다 — 토큰 값은 없다", async (status, reason) => {
    const gh = fakeGitHub({ failUserToken: { status } });
    const d = deps(sources(gh));
    const result = await syncAll(d);

    expect((await d.store.listSnapshots()).map((s) => s.repoId).sort()).toEqual([1001, 1002]);
    expect(result.sources[0]).toEqual({ label: "GitHub App", repositories: 2, pullRequests: 2, error: null });
    expect(result.sources[1]?.label).toBe("Token (fitogether-org)");
    expect(result.sources[1]?.error).toContain(reason);
    noSecret(result);
  });

  it("App 이 실패해도(토큰 교환 거절) 토큰 출처의 결과는 받아 적는다", async () => {
    const gh = fakeGitHub({ failApp: 401 });
    const d = deps(sources(gh));
    const result = await syncAll(d);

    expect((await d.store.listSnapshots()).map((s) => s.repoId).sort()).toEqual([1001, 2001, 2001, 2002]);
    expect(result.sources[0]?.error).not.toBeNull();
    expect(result.sources[1]).toEqual({ label: "Token (fitogether-org)", repositories: 3, pullRequests: 4, error: null });
    noSecret(result);
  });

  it("토큰 출처가 PR 을 읽다가 실패하면 그 출처는 더 부르지 않고, 이미 읽은 다른 출처는 그대로 남는다", async () => {
    const gh = fakeGitHub({ failUserToken: { status: 403, when: (url) => url === tokenPulls("fitogether-org/web") } });
    const d = deps(sources(gh));
    const result = await syncAll(d);

    expect(gh.calls.some((c) => c.url === tokenPulls("fitogether-org/api"))).toBe(false); // 실패 뒤 같은 출처의 다음 저장소는 부르지 않는다
    expect((await d.store.listSnapshots()).map((s) => s.repoId).sort()).toEqual([1001, 1002]);
    expect(result.sources[1]?.error).toContain("403");
  });

  it("두 출처가 모두 저장소 목록부터 실패하면 Sync 전체를 실패로 알린다 (성공처럼 보이지 않게)", async () => {
    const gh = fakeGitHub({ failApp: 401, failUserToken: { status: 401 } });
    const error = await syncAll(deps(sources(gh))).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect(String((error as Error).message)).toContain("GitHub App:");
    expect(String((error as Error).message)).toContain("Token (fitogether-org):");
    noSecret((error as Error).message);
  });

  it("요청 상한은 Sync 1회 전체 기준으로 두 출처가 나눠 쓴다 — 실제로 나간 요청 수가 상한을 넘지 않는다", async () => {
    // 모든 것을 읽으면 요청은 1(교환) + 1 + 2×(4+2) + … 로 20번을 넘는다. 상한 12 이면 합쳐 12번에서 멈춰야 한다.
    const gh = fakeGitHub();
    const result = await syncAll(deps(sources(gh, { maxRequests: 12 })));
    expect(gh.calls).toHaveLength(12);
    expect(result.sources.some((s) => s.error?.includes("요청 상한(12번)"))).toBe(true);
  });

  it("두 출처의 모든 데이터 요청은 GET 이고, POST 는 App 의 토큰 교환 하나뿐이다", async () => {
    const gh = fakeGitHub();
    await syncAll(deps(sources(gh)));
    const posts = gh.calls.filter((c) => c.method !== "GET");
    expect(posts.map((c) => [c.method, new URL(c.url).pathname])).toEqual([["POST", "/app/installations/22/access_tokens"]]);
    expect(gh.calls.filter((c) => c.token === USER_TOKEN).every((c) => c.method === "GET")).toBe(true);
  });
});

describe("실패 이유에 싣는 문장", () => {
  it("우리가 만든 오류가 아니면(예: 라이브러리의 날것 오류) 문장을 싣지 않고 '알 수 없는 오류' 로만 보인다", async () => {
    const leaky: GitHubReader = {
      source: "github",
      listRepositories: async () => {
        throw new Error(`socket hang up Authorization: Bearer ${USER_TOKEN}`);
      },
      listPullRequests: async () => [],
    };
    const gh = fakeGitHub();
    const app = createGitHubAppReader({
      tokens: createInstallationTokenSource({ appId: 11, installationId: 22, privateKey: loadPrivateKey(PEM), fetch: gh.fetch }),
      fetch: gh.fetch,
    });
    const result = await syncAll(deps(createMultiReader([{ label: "GitHub App", reader: app }, { label: "Token (x)", reader: leaky }])));
    expect(result.sources[1]).toEqual({ label: "Token (x)", repositories: 0, pullRequests: 0, error: "알 수 없는 오류" });
    noSecret(result);
  });
});

describe("토큰 출처의 조직 저장소 목록", () => {
  it("다음 페이지가 다른 경로를 가리키면 따라가지 않는다", async () => {
    const fetch = async (): Promise<Response> =>
      new Response("[]", { status: 200, headers: { link: `<${API}/repos/acme/web/pulls?page=2>; rel="next"` } });
    const reader = createGitHubRestReader({ token: USER_TOKEN, orgs: ["fitogether-org"], repos: [], fetch });
    await expect(reader.listRepositories()).rejects.toThrow("다른 경로");
  });

  it("같은 next 가 끝없이 돌아와도 요청 상한에서 멈춘다", async () => {
    let calls = 0;
    const fetch = async (url: string): Promise<Response> => {
      calls += 1;
      if (calls > 200) throw new Error("상한 없이 계속 요청했다");
      return new Response("[]", { status: 200, headers: { link: `<${url}>; rel="next"` } });
    };
    const reader = createGitHubRestReader({ token: USER_TOKEN, orgs: ["fitogether-org"], repos: [], fetch, maxRequests: 7 });
    await expect(reader.listRepositories()).rejects.toThrow("요청 상한(7번)");
    expect(calls).toBe(7);
  });
});

describe("조립부 — App 과 토큰 변수가 둘 다 있으면", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("합성 리더로 둘 다 읽고, 화면 띠용 출처별 상태를 남긴다 — 비밀 값은 상태에 없다", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-studio-key-"));
    const keyPath = join(dir, "app.pem");
    writeFileSync(keyPath, PEM);
    try {
      const gh = fakeGitHub({ failUserToken: { status: 403 } });
      vi.stubGlobal("fetch", gh.fetch);
      const container = createContainer({
        GITHUB_APP_ID: "11",
        GITHUB_APP_INSTALLATION_ID: "22",
        GITHUB_APP_PRIVATE_KEY_PATH: keyPath,
        GITHUB_TOKEN: USER_TOKEN,
        GITHUB_TOKEN_ORGS: "fitogether-org",
      });
      expect(container.deps.reader.source).toBe("github_combined");
      expect(container.configError).toBeNull();
      await container.sync();
      const status = container.status();
      expect(status.lastError).toBeNull();
      expect(status.lastResult).toMatchObject({ repositories: 2, pullRequests: 2 });
      expect(status.sources.map((s) => [s.label, s.error === null])).toEqual([
        ["GitHub App", true],
        ["Token (fitogether-org)", false],
      ]);
      noSecret(status);
      noSecret(container.deps.reader.limitNote);
      // 화면 띠: 출처마다 한 줄 — 성공한 출처는 수, 실패한 출처는 이유
      const html = renderToStaticMarkup(createElement(SourceStatusList, { sources: status.sources }));
      expect(html).toContain("GitHub App: 저장소 2 · PR 2");
      expect(html).toContain("Token (fitogether-org): 실패 — 접근이 막혔다");
      noSecret(html);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("한쪽 설정이 틀렸으면 그 출처만 설정 오류로 실패하고 다른 출처는 읽는다", async () => {
    const gh = fakeGitHub();
    vi.stubGlobal("fetch", gh.fetch);
    const container = createContainer({ GITHUB_APP_ID: "11", GITHUB_TOKEN: USER_TOKEN, GITHUB_TOKEN_ORGS: "fitogether-org" });
    expect(container.deps.reader.source).toBe("github_combined");
    expect(container.configError).toContain("GitHub App 설정이 모자라다");
    await container.sync();
    const status = container.status();
    expect(status.lastError).toBeNull();
    expect(status.sources[0]?.error).toContain("GitHub App 설정이 모자라다");
    expect(status.sources[1]).toMatchObject({ label: "Token (fitogether-org)", repositories: 3, error: null });
    noSecret(status);
  });
});

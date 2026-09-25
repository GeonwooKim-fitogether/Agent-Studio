/**
 * GitHub App 데이터 리더와 조립부 — 가짜 GitHub(주입한 fetch)로 페이지 넘김, 401 재시도, 요청 상한, 설정 오류, 비밀 노출을 시험한다.
 * docs/plan/03-github-app.md §4 의 2 · 3 · 4 · 5.
 */
import { generateKeyPairSync } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubAppReader } from "../../src/adapters/github/app/app-reader";
import { createInstallationTokenSource, loadPrivateKey } from "../../src/adapters/github/app-auth/app-auth";
import { createMemoryStore } from "../../src/adapters/store/memory/memory-store";
import type { AppDeps } from "../../src/application/deps";
import { getInbox, getWorkspace } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import { createContainer, selectGitHubSource } from "../../src/server/container";

const { privateKey: PEM } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const API = "https://api.github.com";
const sha = (c: string) => c.repeat(40);

function pull(number: number, state: "open" | "closed", extra: Record<string, unknown> = {}) {
  return {
    number,
    title: `PR ${number}`,
    body: "",
    state,
    merged_at: null,
    html_url: `https://github.com/acme/web/pull/${number}`,
    updated_at: "2026-09-24T00:00:00Z",
    user: { login: "dev" },
    head: { ref: `feat/${number}`, sha: sha(String(number % 10)), repo: { id: 1001 } },
    ...extra,
  };
}

interface Call {
  method: string;
  url: string;
  authorization: string;
}

/**
 * 가짜 GitHub. 설치 토큰 교환(POST)은 차례로 토큰을 내주고, GET 은 routes 에서 찾는다.
 * rejectTokens 에 든 토큰으로 온 GET 은 401 을 받는다.
 */
function fakeGitHub(routes: Record<string, { body: unknown; next?: string }>, options: { tokens?: string[]; rejectTokens?: string[] } = {}) {
  const tokens = options.tokens ?? ["ghs_token_1", "ghs_token_2", "ghs_token_3"];
  const calls: Call[] = [];
  let exchanges = 0;
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    calls.push({ method: String(init.method), url, authorization });
    if (init.method === "POST") {
      const token = tokens[exchanges] ?? "ghs_exhausted";
      exchanges += 1;
      return new Response(
        JSON.stringify({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { pull_requests: "read", metadata: "read" } }),
        { status: 201 },
      );
    }
    const token = authorization.replace(/^Bearer /, "");
    if ((options.rejectTokens ?? []).includes(token)) return new Response(JSON.stringify({ message: "Bad credentials" }), { status: 401 });
    const route = routes[url];
    if (route === undefined) {
      if (url.includes("/check-runs")) return new Response(JSON.stringify({ check_runs: [] }), { status: 200 });
      if (url.includes("/reviews")) return new Response("[]", { status: 200 });
      return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    }
    const headers = route.next === undefined ? undefined : { link: `<${route.next}>; rel="next", <${route.next}>; rel="last"` };
    return new Response(JSON.stringify(route.body), { status: 200, headers });
  };
  return { fetch, calls, exchanges: () => exchanges };
}

const reposPage1 = `${API}/installation/repositories?per_page=100`;
const reposPage2 = `${API}/installation/repositories?per_page=100&page=2`;
const openPage1 = `${API}/repos/acme/web/pulls?state=open&sort=created&direction=desc&per_page=100`;
const openPage2 = `${API}/repos/acme/web/pulls?state=open&sort=created&direction=desc&per_page=100&page=2`;
const closedUrl = `${API}/repos/acme/web/pulls?state=closed&sort=updated&direction=desc&per_page=30`;

const standardRoutes = {
  [reposPage1]: { body: { total_count: 2, repositories: [{ id: 1001, full_name: "acme/web" }] }, next: reposPage2 },
  [reposPage2]: { body: { total_count: 2, repositories: [{ id: 1002, full_name: "acme/api" }] } },
  [openPage1]: { body: [pull(3, "open"), pull(2, "open")], next: openPage2 },
  [openPage2]: { body: [pull(1, "open")] },
  [closedUrl]: { body: [pull(9, "closed"), pull(8, "closed", { merged_at: "2026-09-20T00:00:00Z" })] },
  [`${API}/repos/acme/api/pulls?state=open&sort=created&direction=desc&per_page=100`]: { body: [] },
  [`${API}/repos/acme/api/pulls?state=closed&sort=updated&direction=desc&per_page=30`]: { body: [] },
};

function reader(gh: ReturnType<typeof fakeGitHub>, extra: { onlyRepos?: string[]; maxRequests?: number } = {}) {
  const tokens = createInstallationTokenSource({ appId: 11, installationId: 22, privateKey: loadPrivateKey(PEM), fetch: gh.fetch });
  return createGitHubAppReader({ tokens, fetch: gh.fetch, ...extra });
}

describe("GitHub App 데이터 리더", () => {
  it("설치된 저장소 목록과 열린 PR 을 페이지를 넘기며 끝까지 읽고, 닫힌 PR 은 최근 30개만 읽는다", async () => {
    const gh = fakeGitHub(standardRoutes);
    const r = reader(gh);

    const repos = await r.listRepositories();
    expect(repos).toEqual([
      { id: 1001, fullName: "acme/web" },
      { id: 1002, fullName: "acme/api" },
    ]);
    const prs = await r.listPullRequests({ id: 1001, fullName: "acme/web" });
    expect(prs.map((p) => [p.number, p.state])).toEqual([
      [3, "open"],
      [2, "open"],
      [1, "open"],
      [9, "closed"],
      [8, "merged"],
    ]);
    expect(gh.calls.some((c) => c.url === closedUrl)).toBe(true); // per_page=30 한 페이지
    expect(r.limitNote).toContain("30");
  });

  it("POST 는 설치 토큰 교환 하나뿐이고, 데이터 요청은 모두 api.github.com 으로 가는 GET 이며 설치 토큰을 싣는다", async () => {
    const gh = fakeGitHub(standardRoutes);
    const r = reader(gh);
    for (const repo of await r.listRepositories()) await r.listPullRequests(repo);

    const posts = gh.calls.filter((c) => c.method !== "GET");
    expect(posts.map((c) => [c.method, c.url])).toEqual([["POST", `${API}/app/installations/22/access_tokens`]]);
    for (const c of gh.calls.filter((call) => call.method === "GET")) {
      expect(new URL(c.url).origin).toBe(API);
      expect(c.authorization).toBe("Bearer ghs_token_1"); // JWT 가 아니라 설치 토큰
    }
  });

  it("GITHUB_REPOS 가 있으면 그 교집합만 읽고(대소문자 무관), 설치되지 않은 이름은 알린다", async () => {
    const gh = fakeGitHub(standardRoutes);
    const r = reader(gh, { onlyRepos: ["ACME/web", "acme/missing"] });
    expect(await r.listRepositories()).toEqual([{ id: 1001, fullName: "acme/web" }]);
    expect(r.lastRunNotes?.()).toEqual(["GITHUB_REPOS 에 적었지만 App 이 설치되지 않은 저장소: acme/missing"]);
  });

  it("데이터 요청이 401 이면 토큰을 한 번만 새로 받아 다시 시도한다", async () => {
    const gh = fakeGitHub(standardRoutes, { rejectTokens: ["ghs_token_1"] });
    const r = reader(gh);
    expect(await r.listRepositories()).toHaveLength(2);
    expect(gh.exchanges()).toBe(2); // 처음 한 번 + 401 뒤 한 번
    expect(gh.calls.filter((c) => c.method === "GET").every((c, i) => i === 0 || c.authorization === "Bearer ghs_token_2")).toBe(true);
  });

  it("새 토큰으로도 401 이면 더 시도하지 않고 오류로 알린다 (토큰 없이)", async () => {
    const gh = fakeGitHub(standardRoutes, { rejectTokens: ["ghs_token_1", "ghs_token_2", "ghs_token_3"] });
    const r = reader(gh);
    const error = (await r.listRepositories().catch((e: unknown) => e)) as Error;
    expect(error.message).toContain("401");
    expect(gh.exchanges()).toBe(2);
    expect(`${error.message}${error.stack}`).not.toMatch(/ghs_token_/);
  });

  it("한 번의 Sync 요청 상한에 닿으면 멈추고 알린다", async () => {
    const gh = fakeGitHub(standardRoutes);
    const r = reader(gh, { maxRequests: 3 });
    await r.listRepositories(); // 2번
    await expect(r.listPullRequests({ id: 1001, fullName: "acme/web" })).rejects.toThrow("요청 상한(3번)");
  });
});

describe("GitHub App 으로 동기화한 화면", () => {
  it("Inbox 에는 열린 PR 만 있고, 연결 안 된 닫힌 · 병합 PR 은 개수로만 보인다", async () => {
    const gh = fakeGitHub(standardRoutes);
    let n = 0;
    const deps: AppDeps = {
      reader: reader(gh),
      store: createMemoryStore(),
      now: () => new Date("2026-09-25T00:00:00.000Z"),
      newId: () => `w${(n += 1)}`,
    };
    await syncAll(deps);

    const inbox = await getInbox(deps);
    const numbers = inbox.groups.flatMap((g) => g.items.map((i) => [i.pr.number, i.pr.github.state]));
    expect(numbers).toEqual([
      [1, "open"],
      [2, "open"],
      [3, "open"],
    ]);
    expect(inbox.closedUnlinkedCount).toBe(2);
    expect((await getWorkspace(deps)).inboxCount).toBe(3);
  });
});

describe("조립부 — 어느 GitHub 연결을 쓸지", () => {
  const app = { GITHUB_APP_ID: "11", GITHUB_APP_INSTALLATION_ID: "22", GITHUB_APP_PRIVATE_KEY_PATH: "/secure/agent-studio.pem" };
  const readKey = (path: string) => {
    if (path === "/secure/agent-studio.pem") return PEM;
    throw new Error(`ENOENT: no such file ${path} (secret detail)`);
  };

  it("App 변수 셋이 모두 있으면 GitHub App 을 쓴다 (개인 토큰이 함께 있어도)", () => {
    const source = selectGitHubSource({ ...app, GITHUB_TOKEN: "ghp_dev", GITHUB_REPOS: "acme/web" }, readKey);
    expect(source).toMatchObject({ kind: "app", appId: 11, installationId: 22, repos: ["acme/web"] });
  });

  it.each([
    [{ GITHUB_APP_ID: "11" }, "GITHUB_APP_INSTALLATION_ID, GITHUB_APP_PRIVATE_KEY_PATH"],
    [{ GITHUB_APP_ID: "11", GITHUB_APP_INSTALLATION_ID: "22" }, "GITHUB_APP_PRIVATE_KEY_PATH"],
    [{ GITHUB_APP_PRIVATE_KEY_PATH: "/secure/agent-studio.pem" }, "GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID"],
  ])("일부만 있으면(%j) fixture 로 떨어지지 않고 설정 오류로 모자란 이름을 알린다", (env, missing) => {
    expect(selectGitHubSource(env, readKey)).toEqual({
      kind: "app_config_error",
      message: `GitHub App 설정이 모자라다: ${missing} 가 비어 있다. 셋을 모두 적거나 모두 비운다.`,
    });
  });

  it("비밀 키 파일을 못 읽으면 경로만 싣고 원래 오류 문장은 싣지 않는다", () => {
    const source = selectGitHubSource({ ...app, GITHUB_APP_PRIVATE_KEY_PATH: "/nowhere/key.pem" }, readKey);
    expect(source).toEqual({ kind: "app_config_error", message: "비밀 키 파일을 읽지 못했다: /nowhere/key.pem" });
  });

  it("비밀 키 파일의 내용이 비밀 키가 아니면 내용을 싣지 않는다", () => {
    const source = selectGitHubSource(app, () => "not a key SECRET_FILE_CONTENT_123");
    expect(source.kind).toBe("app_config_error");
    expect(JSON.stringify(source)).not.toContain("SECRET_FILE_CONTENT_123");
    expect(JSON.stringify(source)).toContain("/secure/agent-studio.pem");
  });

  it("App ID · 설치 ID 가 숫자가 아니면 설정 오류", () => {
    expect(selectGitHubSource({ ...app, GITHUB_APP_ID: "Iv1.abc" }, readKey).kind).toBe("app_config_error");
  });

  it("App 변수가 없으면 개인 토큰(개발용), 그것도 없으면 fixture", () => {
    expect(selectGitHubSource({ GITHUB_TOKEN: "ghp_dev", GITHUB_REPOS: "acme/web" }, readKey).kind).toBe("token");
    expect(selectGitHubSource({}, readKey).kind).toBe("fixture");
  });

  it("설정 오류인 조립부는 시연 데이터를 심지 않고, 화면에 보일 설정 오류와 동기화 실패 이유를 갖는다", async () => {
    const container = createContainer({ GITHUB_APP_ID: "11" }, readKey);
    expect(container.deps.reader.source).toBe("github_app");
    expect(container.configError).toContain("GITHUB_APP_INSTALLATION_ID");
    await container.ensureSynced();
    expect(container.status().lastError).toContain("GitHub App 설정이 모자라다");
    expect(await container.deps.store.listWorks()).toEqual([]); // fixture 업무가 없다
    expect(await container.deps.store.listProjects()).toEqual([]);
  });
});

describe("비밀이 로그 · 오류 · 화면 모델에 나오지 않는다", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("App 으로 동기화하는 동안 콘솔 출력 · 동기화 결과 · 화면 모델 어디에도 비밀 키 · JWT · 설치 토큰이 없다", async () => {
    const printed: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        printed.push(args.map(String).join(" "));
      });
    }
    const gh = fakeGitHub(standardRoutes, { rejectTokens: ["ghs_token_1"], tokens: ["ghs_token_1", "ghs_secret_token_2"] });
    const deps: AppDeps = { reader: reader(gh), store: createMemoryStore(), now: () => new Date(), newId: () => "w1" };

    const result = await syncAll(deps);
    const screens = JSON.stringify({ result, inbox: await getInbox(deps), workspace: await getWorkspace(deps) });

    const jwts = gh.calls.filter((c) => c.method === "POST").map((c) => c.authorization.replace(/^Bearer /, ""));
    expect(jwts.length).toBeGreaterThan(0);
    const secrets = [...jwts, "ghs_token_1", "ghs_secret_token_2", PEM.split("\n")[1] ?? "unused"];
    for (const text of [...printed, screens]) {
      for (const secret of secrets) expect(text).not.toContain(secret);
    }
  });
});

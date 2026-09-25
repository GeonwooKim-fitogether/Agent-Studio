/**
 * GitHub App 데이터 리더와 조립부 — 가짜 GitHub(주입한 fetch)로 페이지 넘김, 401 재시도, 요청 상한, 설정 오류, 비밀 노출을 시험한다.
 * docs/plan/03-github-app.md §4 의 2 · 3 · 4 · 5.
 */
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGitHubAppReader } from "../../src/adapters/github/app/app-reader";
import {
  createGuardedGet,
  createRequestMeter,
  GitHubReadError,
  GitHubRequestBlockedError,
} from "../../src/adapters/github/rest/guarded-get";
import { createInstallationTokenSource, loadPrivateKey, READ_ONLY_PERMISSIONS } from "../../src/adapters/github/app-auth/app-auth";
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
    base: { repo: { id: 1001 } },
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
        JSON.stringify({ token, expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { ...READ_ONLY_PERMISSIONS } }),
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
    const run = reader(gh, { onlyRepos: ["ACME/web", "acme/missing"] }).startRun?.();
    if (run === undefined) throw new Error("App 리더는 동기화 1회분의 실행을 만든다");
    expect(await run.listRepositories()).toEqual([{ id: 1001, fullName: "acme/web" }]);
    expect(run.notes()).toEqual(["GITHUB_REPOS 에 적었지만 App 이 설치되지 않은 저장소: acme/missing"]);
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
    const run = reader(gh, { maxRequests: 4 }).startRun?.();
    if (run === undefined) throw new Error("실행이 없다");
    await run.listRepositories(); // 교환 POST 1 + 저장소 목록 2쪽 = 3번
    await expect(run.listPullRequests({ id: 1001, fullName: "acme/web" })).rejects.toThrow("요청 상한(4번)");
    expect(gh.calls).toHaveLength(4); // 상한을 넘는 요청은 나가지 않았다
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
    expect(source).toEqual({ kind: "app_config_error", message: "비밀 키 파일을 읽지 못했다: key.pem" }); // 파일 이름만
  });

  it("비밀 키 파일의 내용이 비밀 키가 아니면 내용을 싣지 않는다", () => {
    const source = selectGitHubSource(app, () => "not a key SECRET_FILE_CONTENT_123");
    expect(source.kind).toBe("app_config_error");
    expect(JSON.stringify(source)).not.toContain("SECRET_FILE_CONTENT_123");
    expect(JSON.stringify(source)).toContain("agent-studio.pem");
    expect(JSON.stringify(source)).not.toContain("/secure/"); // 서버의 폴더 구조는 싣지 않는다
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

describe("적대 검증에서 나온 구멍 (6차)", () => {
  const token = { getToken: async () => "ghs_gate_token", invalidate: () => undefined };

  it("M3: 관문에 소문자 get 을 넘겨도 네트워크로는 늘 \"GET\" 이 나가고, GET 이 아닌 메서드는 보내기 전에 거절한다", async () => {
    const seen: string[] = [];
    const fetch = async (_url: string, init: RequestInit) => {
      seen.push(String(init.method));
      return new Response("{}", { status: 200 });
    };
    const get = createGuardedGet({ tokens: token, fetch });
    await get(`${API}/installation/repositories`, { method: "get" });
    expect(seen).toEqual(["GET"]);
    for (const method of ["POST", "PATCH", "PUT", "DELETE", "HEAD"]) {
      await expect(get(`${API}/installation/repositories`, { method })).rejects.toBeInstanceOf(GitHubRequestBlockedError);
    }
    expect(seen).toEqual(["GET"]);
  });

  it("요청 상한은 실제 fetch 호출 수로 센다 — 요청마다 307 이 세 번 나와도 상한에서 멈춘다", async () => {
    let calls = 0;
    const fetch = async (url: string): Promise<Response> => {
      calls += 1;
      const hop = Number(new URL(url).searchParams.get("hop") ?? "0");
      if (hop < 3) {
        const next = new URL(url);
        next.searchParams.set("hop", String(hop + 1));
        return new Response(null, { status: 307, headers: { location: next.href } });
      }
      return new Response(JSON.stringify({ repositories: [] }), { status: 200 });
    };
    const meter = createRequestMeter(10);
    const get = createGuardedGet({ tokens: token, fetch, meter });
    await get(`${API}/installation/repositories`); // 307 × 3 + 200 = 실제 4번
    expect(meter.used()).toBe(4);
    await get(`${API}/installation/repositories`); // 8번
    await expect(get(`${API}/installation/repositories`)).rejects.toThrow("요청 상한(10번)");
    expect(calls).toBe(10); // 상한을 넘는 요청은 나가지 않았다
  });

  it("M9: 같은 next 링크가 끝없이 돌아와도 페이지 넘김이 상한에서 멈춘다", async () => {
    let calls = 0;
    const fetch = async (url: string, init: RequestInit): Promise<Response> => {
      calls += 1;
      // 안전판: 상한이 사라지면 시험이 멈춰 버리지 않고 여기서 실패하게 한다
      if (calls > 200) throw new Error("상한 없이 계속 요청했다");
      if (init.method === "POST") {
        return new Response(JSON.stringify({ token: "ghs_loop", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { ...READ_ONLY_PERMISSIONS } }), { status: 201 });
      }
      return new Response(JSON.stringify({ repositories: [] }), { status: 200, headers: { link: `<${url}>; rel="next"` } });
    };
    const run = createGitHubAppReader({
      tokens: createInstallationTokenSource({ appId: 11, installationId: 22, privateKey: loadPrivateKey(PEM), fetch }),
      fetch,
      maxRequests: 20,
    }).startRun?.();
    await expect(run?.listRepositories()).rejects.toThrow("요청 상한(20번)");
    expect(calls).toBe(20);
  });

  it("다음 페이지가 다른 경로를 가리키거나 리디렉션이 다른 경로로 가면 따라가지 않는다", async () => {
    const other = fakeGitHub({ [reposPage1]: { body: { repositories: [] }, next: `${API}/repos/acme/web/pulls?page=2` } });
    await expect(reader(other).listRepositories()).rejects.toThrow("다른 경로");
    const redirecting = async (url: string, init: RequestInit): Promise<Response> => {
      if (init.method === "POST") {
        return new Response(JSON.stringify({ token: "ghs_r", expires_at: new Date(Date.now() + 3_600_000).toISOString(), permissions: { ...READ_ONLY_PERMISSIONS } }), { status: 201 });
      }
      return new Response(null, { status: 302, headers: { location: `${API}/user/repos` } });
    };
    const r = createGitHubAppReader({
      tokens: createInstallationTokenSource({ appId: 11, installationId: 22, privateKey: loadPrivateKey(PEM), fetch: redirecting }),
      fetch: redirecting,
    });
    await expect(r.listRepositories()).rejects.toBeInstanceOf(GitHubRequestBlockedError);
  });

  it("M18: 데이터 요청의 네트워크 실패 오류에 설치 토큰이 없다", async () => {
    const failing = async (_url: string, init: RequestInit): Promise<Response> => {
      throw new Error(`ECONNRESET ${new Headers(init.headers).get("authorization")}`);
    };
    const get = createGuardedGet({ tokens: { getToken: async () => "ghs_network_secret" }, fetch: failing });
    const error = (await get(`${API}/installation/repositories`).catch((e: unknown) => e)) as Error;
    expect(error).toBeInstanceOf(GitHubReadError);
    expect(`${error.message}\n${error.stack}\n${JSON.stringify(error)}`).not.toContain("ghs_network_secret");
  });

  it("응답 PR 의 base.repo.id 가 요청한 저장소가 아니거나 없으면 버리고 알린다", async () => {
    const gh = fakeGitHub({
      ...standardRoutes,
      [openPage1]: { body: [pull(3, "open"), pull(4, "open", { base: { repo: { id: 9999 } } }), pull(5, "open", { base: undefined })] },
    });
    const run = reader(gh).startRun?.();
    if (run === undefined) throw new Error("실행이 없다");
    const prs = await run.listPullRequests({ id: 1001, fullName: "acme/web" });
    expect(prs.map((p) => p.number)).toEqual([3, 9, 8]);
    expect(run.notes()).toEqual(["acme/web 에 요청했는데 다른 저장소의 것으로 보이는 PR 2개를 버렸다: #4, #5"]);
  });

  it("동기화 실행 두 개는 서로의 상한과 알림을 초기화하지 않는다", async () => {
    const gh = fakeGitHub(standardRoutes);
    const r = reader(gh, { onlyRepos: ["acme/missing"], maxRequests: 5 });
    const a = r.startRun?.();
    const b = r.startRun?.();
    if (a === undefined || b === undefined) throw new Error("실행이 없다");
    await a.listRepositories();
    await b.listRepositories();
    expect(a.notes()).toHaveLength(1);
    expect(b.notes()).toHaveLength(1);
    await expect(a.listPullRequests({ id: 1001, fullName: "acme/web" })).rejects.toThrow("요청 상한(5번)"); // a 는 이미 3번 썼다
    // a 가 상한을 다 쓴 뒤에도 새 실행은 처음부터 센다(계수기를 실행끼리 나누지 않는다)
    const c = r.startRun?.();
    await expect(c?.listRepositories()).resolves.toEqual([]);
  });
});

describe("조립부의 단일 비행과 비밀 키 경로 (6차)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("Sync 를 겹쳐 눌러도 동기화는 한 번만 돈다 (진행 중인 것을 함께 기다린다)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-studio-key-"));
    const keyPath = join(dir, "app.pem");
    writeFileSync(keyPath, PEM);
    try {
      const gh = fakeGitHub(standardRoutes);
      vi.stubGlobal("fetch", gh.fetch);
      const container = createContainer({ GITHUB_APP_ID: "11", GITHUB_APP_INSTALLATION_ID: "22", GITHUB_APP_PRIVATE_KEY_PATH: keyPath });
      await Promise.all([container.sync(), container.sync(), container.sync()]);
      expect(container.status().lastError).toBeNull();
      expect(gh.calls.filter((c) => c.url === reposPage1)).toHaveLength(1);
      expect(container.status().lastResult).toMatchObject({ repositories: 2 });
      await container.sync(); // 끝난 뒤에 누르면 새로 돈다
      expect(gh.calls.filter((c) => c.url === reposPage1)).toHaveLength(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const app = { GITHUB_APP_ID: "11", GITHUB_APP_INSTALLATION_ID: "22" };
  it.each([
    ["PEM 내용을 통째로 붙여 넣었다", PEM],
    ["BEGIN 머리글만 있다", ["-----BEGIN RSA", "PRIVATE KEY-----MIIEow"].join(" ")], // 저장소 비밀 검사에 걸리지 않게 조각으로 만든다
    ["줄바꿈이 든 값", "/secure/app.pem\nMIIEowIBAAKCAQEA"],
    ["매우 긴 값", `/secure/${"a".repeat(2000)}.pem`],
  ])("경로 칸에 %s 면 그 값을 싣지 않고 경로를 적으라고 안내한다", (_name, value) => {
    const source = selectGitHubSource({ ...app, GITHUB_APP_PRIVATE_KEY_PATH: value }, () => PEM);
    expect(source).toEqual({
      kind: "app_config_error",
      message: "GITHUB_APP_PRIVATE_KEY_PATH 에 파일 경로가 아니라 키 내용이 들어 있는 것 같다 — .pem 파일의 경로를 적는다.",
    });
  });

  it("비밀 키 파일이 64KB 를 넘으면 설정 오류 (실제 파일은 읽기 전에 크기로, 주입한 읽기는 읽은 뒤 크기로)", () => {
    const dir = mkdtempSync(join(tmpdir(), "agent-studio-key-"));
    const big = join(dir, "big.pem");
    writeFileSync(big, "x".repeat(64 * 1024 + 1));
    try {
      expect(selectGitHubSource({ ...app, GITHUB_APP_PRIVATE_KEY_PATH: big })).toEqual({
        kind: "app_config_error",
        message: "비밀 키 파일이 너무 크다(64KB 초과): big.pem",
      });
      expect(selectGitHubSource({ ...app, GITHUB_APP_PRIVATE_KEY_PATH: "/k/huge.pem" }, () => "y".repeat(70_000))).toMatchObject({
        message: "비밀 키 파일이 너무 크다(64KB 초과): huge.pem",
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("RSA 2048비트 미만의 키 파일은 설정 오류", () => {
    const short = generateKeyPairSync("rsa", { modulusLength: 1024, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
    const source = selectGitHubSource({ ...app, GITHUB_APP_PRIVATE_KEY_PATH: "/k/short.pem" }, () => short.privateKey);
    expect(source).toEqual({ kind: "app_config_error", message: "비밀 키 파일의 내용이 RSA 2048비트 이상의 비밀 키(PEM)가 아니다: short.pem" });
  });
});

/**
 * 이 컴퓨터의 미리보기 실행기를 **실제로** 돌린다 (docs/plan/04-remote-preview.md §9 기준 3 ~ 8).
 * 진짜 git 저장소를 만들고, 진짜 tar · npm ci · 자식 프로세스로 앱을 띄워 HTTP 로 확인한다. 네트워크는 쓰지 않는다
 * (시험용 앱은 의존성이 없어 npm ci 가 아무것도 받지 않는다). GitHub 에서 받는 경로는 가짜 fetch 로 흉내 낸다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { createGitHubTarballSource } from "../../src/adapters/github/tarball/tarball-source";
import { createLocalRepoSource } from "../../src/adapters/preview/local/local-repo-source";
import { createLocalPreviewRunner, type LocalPreviewRunner } from "../../src/adapters/preview/local/local-runner";
import { getPreviewCards, startPreview } from "../../src/application/preview";
import { syncAll } from "../../src/application/sync";
import type { PreviewSession, PreviewTarget } from "../../src/domain/preview";
import { createDemoRepo } from "../../scripts/preview-demo-repo.mjs";
import { setup } from "./helpers";

const ROOT = mkdtempSync(join(tmpdir(), "studio-preview-"));
const REPOS = join(ROOT, "repos");
const WORK = join(ROOT, "work");
mkdirSync(WORK, { recursive: true });
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

const runners: LocalPreviewRunner[] = [];
afterEach(async () => {
  await Promise.all(runners.splice(0).map((r) => r.dispose()));
});

/** Studio 의 환경인 척 넘길 값. 비밀들이 자식에게 가면 안 된다 */
const PARENT_ENV = {
  PATH: process.env.PATH,
  HOME: process.env.HOME,
  GITHUB_TOKEN: "ghp_studioSecretToken1234567890",
  GITHUB_APP_PRIVATE_KEY: "fake-private-key-content",
  DATABASE_URL: "postgresql://app:pw@localhost:5432/app",
  npm_config__authToken: "npm-secret",
  NODE_OPTIONS: "--require /tmp/evil.js",
};

const gitEnv = {
  PATH: process.env.PATH ?? "",
  HOME: ROOT,
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: join(ROOT, "none"),
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.invalid",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.invalid",
} as unknown as NodeJS.ProcessEnv;

/** owner/name 저장소에 파일들을 커밋하고 SHA 를 돌려준다 (두 번째 부르면 새 커밋) */
function commit(fullName: string, files: Record<string, string>): string {
  const dir = join(REPOS, ...fullName.split("/"));
  mkdirSync(dir, { recursive: true });
  const git = (...args: string[]) => execFileSync("git", ["-c", "commit.gpgsign=false", ...args], { cwd: dir, env: gitEnv, encoding: "utf8" }).trim();
  if (!existsSync(join(dir, ".git"))) git("init", "--quiet");
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  git("add", "-A");
  git("commit", "--quiet", "--allow-empty", "-m", "c");
  return git("rev-parse", "HEAD");
}

const lock = (name: string) =>
  JSON.stringify({ name, version: "1.0.0", lockfileVersion: 3, requires: true, packages: { "": { name, version: "1.0.0" } } });
const pkg = (name: string, scripts: Record<string, string>) => JSON.stringify({ name, version: "1.0.0", private: true, scripts });

/** PORT 로 받은 곳에 뜨고, / 에 text 를, /env 에 자기 환경변수 이름 목록을 돌려주는 앱 */
function appFiles(name: string, text: string): Record<string, string> {
  return {
    "package.json": pkg(name, { dev: "node server.js" }),
    "package-lock.json": lock(name),
    "server.js": `require("node:http").createServer((q, s) => { s.end(q.url === "/env" ? JSON.stringify(process.env) : ${JSON.stringify(text)}); }).listen(Number(process.env.PORT), process.env.HOST);`,
  };
}

function runner(overrides: Partial<Parameters<typeof createLocalPreviewRunner>[0]> = {}): LocalPreviewRunner {
  const r = createLocalPreviewRunner({
    workdir: WORK,
    bindHost: "127.0.0.1",
    publicHost: "127.0.0.1",
    source: createLocalRepoSource(REPOS, PARENT_ENV),
    parentEnv: PARENT_ENV,
    registerExitCleanup: false,
    startTimeoutMs: 20_000,
    ...overrides,
  });
  runners.push(r);
  return r;
}

async function settle(r: LocalPreviewRunner, timeoutMs = 60_000): Promise<PreviewSession> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const s = r.current();
    if (s !== null && (s.phase === "running" || s.phase === "failed")) return s;
    if (Date.now() > deadline) throw new Error(`준비되지 않았다: ${JSON.stringify(s)}`);
    await new Promise((done) => setTimeout(done, 100));
  }
}

function httpGet(url: string): Promise<{ status: number; body: string } | "refused"> {
  return new Promise((done) => {
    get(url, (res) => {
      let body = "";
      res.setEncoding("utf8").on("data", (c: string) => (body += c));
      res.on("end", () => done({ status: res.statusCode ?? 0, body }));
    }).on("error", () => done("refused"));
  });
}

const target = (fullName: string, commitSha: string, number = 1): PreviewTarget => ({ repoId: 100, number, repoFullName: fullName, commitSha });

describe("로컬 실행기 — 실제 프로세스", { timeout: 120_000 }, () => {
  it("커밋을 받아 npm ci 로 설치하고 켠 뒤, 주소가 그 커밋의 앱 화면을 돌려준다", async () => {
    const sha = commit("acme/hello", appFiles("hello", "hello from preview"));
    const r = runner();
    const first = r.start(target("acme/hello", sha));
    expect(first).toMatchObject({ phase: "fetching", url: null, replaced: null });
    const done = await settle(r);
    expect(done.failure).toBeNull();
    expect(done.phase).toBe("running");
    expect(done.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    expect(await httpGet(done.url!)).toEqual({ status: 200, body: "hello from preview" });
    expect(done.logTail.join("\n")).toContain("[studio] npm ci --no-audit --no-fund");
    expect(done.logTail.join("\n")).toContain("[studio] npm run dev");
  });

  it("자식 프로세스는 허용 목록의 환경변수만 받는다 — GITHUB_* · DATABASE_URL · npm_config_* · NODE_OPTIONS 가 없다", async () => {
    const sha = commit("acme/envcheck", appFiles("envcheck", "ok"));
    const r = runner();
    r.start(target("acme/envcheck", sha));
    const done = await settle(r);
    const res = await httpGet(`${done.url}env`);
    if (res === "refused") throw new Error("응답이 없다");
    const env = JSON.parse(res.body) as Record<string, string>;
    for (const name of ["GITHUB_TOKEN", "GITHUB_APP_PRIVATE_KEY", "DATABASE_URL", "npm_config__authToken", "NODE_OPTIONS"]) {
      expect(env[name], name).toBeUndefined();
    }
    expect(res.body).not.toContain("studioSecretToken");
    expect(env["PORT"]).toBe(new URL(done.url!).port);
    expect(env["HOST"]).toBe("127.0.0.1");
  });

  it("다른 PR 을 열면 이전 미리보기가 꺼지고(포트가 닫힌다) 새 기록에 종료한 것을 남긴다. Stop 은 프로세스를 끈다", async () => {
    const a = commit("acme/one", appFiles("one", "one"));
    const b = commit("acme/two", appFiles("two", "two"));
    const r = runner();
    r.start(target("acme/one", a, 1));
    const first = await settle(r);
    expect(await httpGet(first.url!)).toMatchObject({ body: "one" });

    r.start(target("acme/two", b, 2));
    const second = await settle(r);
    expect(second.replaced).toEqual(target("acme/one", a, 1));
    expect(await httpGet(second.url!)).toMatchObject({ body: "two" });
    expect(await httpGet(first.url!)).toBe("refused");

    await r.stop();
    expect(r.current()).toMatchObject({ phase: "stopped", url: null });
    expect(await httpGet(second.url!)).toBe("refused");
  });

  it("lockfile 이 없으면 설치하지 않고 이유를 보인다", async () => {
    const sha = commit("acme/nolock", { "package.json": pkg("nolock", { start: "node -e 1" }) });
    const r = runner();
    r.start(target("acme/nolock", sha));
    const done = await settle(r);
    expect(done.phase).toBe("failed");
    expect(done.failure).toContain("lockfile");
  });

  it("dev · start 스크립트가 둘 다 없으면 이유를 보인다", async () => {
    const sha = commit("acme/noscript", { "package.json": pkg("noscript", { test: "node -e 1" }), "package-lock.json": lock("noscript") });
    const r = runner();
    r.start(target("acme/noscript", sha));
    expect(await settle(r)).toMatchObject({ phase: "failed", failure: expect.stringContaining("dev 나 start") });
  });

  it("시작 상한 안에 주소가 응답하지 않으면 끄고 이유를 보인다", async () => {
    const sha = commit("acme/silent", {
      "package.json": pkg("silent", { start: "node -e \"setInterval(() => {}, 1000)\"" }),
      "package-lock.json": lock("silent"),
    });
    const r = runner({ startTimeoutMs: 1500 });
    r.start(target("acme/silent", sha));
    expect(await settle(r)).toMatchObject({ phase: "failed", failure: expect.stringContaining("시작 시간 상한") });
  });

  it("앱이 준비 전에 끝나면 실패 이유와 로그 꼬리를 보이고, 로그의 비밀 모양은 가린다", async () => {
    const sha = commit("acme/crash", {
      "package.json": pkg("crash", { start: "node crash.js" }),
      "package-lock.json": lock("crash"),
      "crash.js": [
        'console.log("token ghs_abcdefghijklmnopqrstuvwxyz0123");',
        'console.log("Authorization: Bearer abc.def.ghi");',
        'console.log("connect https://user:hunter2@db.example.com/x");',
        'console.error("boom: API_TOKEN=supersecret");',
        "process.exit(3);",
      ].join("\n"),
    });
    const r = runner();
    r.start(target("acme/crash", sha));
    const done = await settle(r);
    expect(done.phase).toBe("failed");
    expect(done.failure).toContain("준비되기 전에 끝났다");
    const log = done.logTail.join("\n");
    expect(log).toContain("boom");
    for (const secret of ["ghs_abcdefghijklmnopqrstuvwxyz0123", "abc.def.ghi", "hunter2", "supersecret"]) expect(log).not.toContain(secret);
    expect(log).toContain("[가림]");
  });

  it("로컬 저장소에 없는 커밋 · 짧은 SHA 는 받지 않는다", async () => {
    commit("acme/hello2", appFiles("hello2", "x"));
    const r = runner();
    r.start(target("acme/hello2", "f".repeat(40)));
    expect(await settle(r)).toMatchObject({ phase: "failed", failure: expect.stringContaining("커밋 fffffff 이 없다") });
    expect(() => r.start(target("acme/hello2", "abc1234"))).toThrow("전체 커밋 SHA");
  });
});

describe("시연 저장소와 유스케이스 — 새 커밋이 오면 실행 중인 미리보기는 이전 버전이다", { timeout: 120_000 }, () => {
  it("fixture 의 admin-console#12 를 실제로 띄우고, PR 에 새 커밋이 오면 이전 버전으로 표시한다", async () => {
    expect(createDemoRepo(REPOS)).toBe(DEMO_SHA.admin12Head);
    const { data, deps } = setup();
    await syncAll(deps);
    const r = runner();
    const ref = { repoId: DEMO_REPO.adminConsole, number: 12 };
    await startPreview(deps, r, ref);
    const done = await settle(r);
    expect(done.phase).toBe("running");
    expect(await httpGet(done.url!)).toMatchObject({ status: 200, body: expect.stringContaining("관리자 로그인 2단계 인증") });
    expect((await getPreviewCards(deps, r, [ref])).get(`${ref.repoId}#12`)?.session).toMatchObject({ freshness: "current", phase: "running" });

    data.pullRequests = data.pullRequests.map((p) => (p.repoId === ref.repoId && p.number === 12 ? { ...p, headSha: "d".repeat(40) } : p));
    await syncAll(deps);
    expect((await getPreviewCards(deps, r, [ref])).get(`${ref.repoId}#12`)?.session).toMatchObject({
      freshness: "outdated",
      commitSha: DEMO_SHA.admin12Head,
    });
  });
});

describe("GitHub 에서 받는 경로 — 가짜 GitHub 응답", { timeout: 120_000 }, () => {
  /** GitHub tarball 처럼 맨 위에 owner-repo-sha7/ 한 겹을 씌운 tar.gz */
  function githubTarball(fullName: string, sha: string): Uint8Array {
    const dir = join(REPOS, ...fullName.split("/"));
    return new Uint8Array(
      execFileSync("git", ["archive", "--format=tar.gz", `--prefix=${fullName.replace("/", "-")}-${sha.slice(0, 7)}/`, sha], { cwd: dir, env: gitEnv }),
    );
  }

  it("api.github.com 에 토큰을 실어 GET 하고, codeload 로는 토큰 없이 따라가 받은 코드로 앱을 띄운다", async () => {
    const sha = commit("acme/remote", appFiles("remote", "from github tarball"));
    const tarball = githubTarball("acme/remote", sha);
    const calls: { url: string; method: string; auth: string | null }[] = [];
    const fakeFetch = async (url: string, init: RequestInit): Promise<Response> => {
      const headers = new Headers(init.headers);
      calls.push({ url, method: init.method ?? "GET", auth: headers.get("authorization") });
      if (url === `https://api.github.com/repos/acme/remote/tarball/${sha}`) {
        return new Response(null, { status: 302, headers: { location: `https://codeload.github.com/acme/remote/legacy.tar.gz/${sha}?token=signed` } });
      }
      if (url.startsWith("https://codeload.github.com/")) return new Response(Buffer.from(tarball), { status: 200 });
      return new Response("not found", { status: 404 });
    };
    const r = runner({
      source: createGitHubTarballSource({ tokens: [{ getToken: async () => "ghs_installationTokenValue123" }], fetch: fakeFetch }),
    });
    r.start(target("acme/remote", sha));
    const done = await settle(r);
    expect(done.failure).toBeNull();
    expect(await httpGet(done.url!)).toMatchObject({ body: "from github tarball" });
    expect(calls.map((c) => c.method)).toEqual(["GET", "GET"]);
    expect(calls[0]?.auth).toBe("Bearer ghs_installationTokenValue123");
    expect(calls[1]?.auth).toBeNull(); // 서명된 codeload 주소에는 토큰을 싣지 않는다
    expect(done.logTail.join("\n")).not.toContain("ghs_installationTokenValue123");
  });

  it("codeload 가 아닌 곳으로의 리디렉션은 따라가지 않고, 403 · 404 면 다음 토큰으로 한 번 더 받는다", async () => {
    const sha = "e".repeat(40);
    const seen: string[] = [];
    const redirectElsewhere = async (url: string, init: RequestInit): Promise<Response> => {
      seen.push(`${new Headers(init.headers).get("authorization") ?? "-"} ${url}`);
      return new Response(null, { status: 302, headers: { location: "https://evil.example.com/steal" } });
    };
    const source = createGitHubTarballSource({ tokens: [{ getToken: async () => "tokA" }], fetch: redirectElsewhere });
    await expect(source.archive(target("acme/web", sha))).rejects.toThrow("코드를 받지 못했다");
    expect(seen).toEqual([`Bearer tokA https://api.github.com/repos/acme/web/tarball/${sha}`]); // evil 로는 한 번도 나가지 않았다

    const tried: string[] = [];
    const firstForbidden = async (_url: string, init: RequestInit): Promise<Response> => {
      const auth = new Headers(init.headers).get("authorization") ?? "";
      tried.push(auth);
      return auth === "Bearer tokA" ? new Response("", { status: 404 }) : new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    };
    const twoTokens = createGitHubTarballSource({
      tokens: [{ getToken: async () => "tokA" }, { getToken: async () => "tokB" }],
      fetch: firstForbidden,
    });
    expect((await twoTokens.archive(target("acme/web", sha))).bytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(tried).toEqual(["Bearer tokA", "Bearer tokB"]);
  });

  it("받을 크기 상한을 넘으면 멈추고, 오류 문장에 토큰이 없다", async () => {
    const big = async (): Promise<Response> => new Response(new Uint8Array(2048), { status: 200 });
    const source = createGitHubTarballSource({ tokens: [{ getToken: async () => "ghs_secretSecret999" }], fetch: big, maxBytes: 1024 });
    const error = await source.archive(target("acme/web", "e".repeat(40))).catch((e: unknown) => e as Error);
    expect(String(error)).toContain("상한");
    expect(String(error)).not.toContain("ghs_secretSecret999");
  });
});

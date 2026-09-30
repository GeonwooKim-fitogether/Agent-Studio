/**
 * 이 컴퓨터의 미리보기 실행기를 **실제로** 돌린다 (docs/plan/04-remote-preview.md §9 기준 3 ~ 8).
 * 진짜 git 저장소를 만들고, 진짜 tar · npm ci · 자식 프로세스로 앱을 띄워 HTTP 로 확인한다. 네트워크는 쓰지 않는다
 * (시험용 앱은 의존성이 없어 npm ci 가 아무것도 받지 않는다). GitHub 에서 받는 경로는 가짜 fetch 로 흉내 낸다.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { get } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { createGitHubTarballSource } from "../../src/adapters/github/tarball/tarball-source";
import { createLocalRepoSource } from "../../src/adapters/preview/local/local-repo-source";
import { createLocalPreviewRunner, devOriginsOf, type LocalPreviewRunner } from "../../src/adapters/preview/local/local-runner";
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
  STUDIO_SESSION_SECRET: "correct-horse-battery-staple", // Studio 의 비밀 값 — 로그 꼬리에 나타나면 가려야 한다
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

/** 그 pid 의 프로세스가 아직 있는가 (좀비는 없는 것으로 본다) */
function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return !/^\S+ \(.*\) Z/.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch {
    return true;
  }
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
    expect(env["PREVIEW_ALLOWED_DEV_ORIGINS"]).toBe("127.0.0.1");
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

  it("끄는 신호를 무시하는 앱도 Stop 뒤에는 끝나 있다 — 앞선 npm 이 먼저 끝나도 프로세스 묶음 전체를 강제로 끈다", async () => {
    const pidFile = join(ROOT, "trap-pid");
    const sha = commit("acme/trap", {
      "package.json": pkg("trap", { dev: "node server.js" }),
      "package-lock.json": lock("trap"),
      // SIGTERM 을 받아도 끝나지 않는 앱. 자기 pid 를 파일로 남긴다
      "server.js": [
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        'process.on("SIGTERM", () => console.log("SIGTERM 무시"));',
        'require("node:http").createServer((q, s) => s.end("trap")).listen(Number(process.env.PORT), process.env.HOST);',
      ].join("\n"),
    });
    const r = runner();
    r.start(target("acme/trap", sha));
    const done = await settle(r);
    expect(done.phase).toBe("running");
    const appPid = Number(readFileSync(pidFile, "utf8"));
    const stopped = await Promise.race([r.stop().then(() => "stopped"), new Promise((ok) => setTimeout(() => ok("stop 이 15초 안에 돌아오지 않았다"), 15_000))]);
    expect(stopped).toBe("stopped");
    expect(isAlive(appPid), `앱 프로세스 ${appPid} 가 살아 있다`).toBe(false);
    expect(await httpGet(done.url!)).toBe("refused");
  });

  it("Stop 이 끄기를 기다리는 사이 새 미리보기를 열어도 둘이 겹치지 않는다 — 새 앱은 이전 앱의 포트가 닫힌 뒤에 뜬다", async () => {
    const pidFile = join(ROOT, "overlap-a-pid");
    const portFile = join(ROOT, "overlap-a-port");
    const seenFile = join(ROOT, "overlap-b-saw");
    const a = commit("acme/overlap-a", {
      "package.json": pkg("overlap-a", { dev: "node server.js" }),
      "package-lock.json": lock("overlap-a"),
      "server.js": [
        `require("node:fs").writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));`,
        `require("node:fs").writeFileSync(${JSON.stringify(portFile)}, process.env.PORT);`,
        'process.on("SIGTERM", () => {});',
        'require("node:http").createServer((q, s) => s.end("a")).listen(Number(process.env.PORT), process.env.HOST);',
      ].join("\n"),
    });
    // B 는 켜지는 순간 A 의 포트에 접속해 보고, 그 결과를 파일로 남긴 뒤 뜬다
    const b = commit("acme/overlap-b", {
      "package.json": pkg("overlap-b", { dev: "node server.js" }),
      "package-lock.json": lock("overlap-b"),
      "server.js": [
        'const fs = require("node:fs"); const http = require("node:http");',
        `const port = Number(fs.readFileSync(${JSON.stringify(portFile)}, "utf8"));`,
        `const save = (v) => fs.writeFileSync(${JSON.stringify(seenFile)}, v);`,
        'http.get({ host: "127.0.0.1", port, path: "/" }, (r) => { r.resume(); save("A 가 아직 응답했다"); }).on("error", () => save("A 는 닫혀 있었다"));',
        'http.createServer((q, s) => s.end("b")).listen(Number(process.env.PORT), process.env.HOST);',
      ].join("\n"),
    });
    const r = runner({ killGraceMs: 1500 });
    r.start(target("acme/overlap-a", a, 1));
    expect((await settle(r)).phase).toBe("running");
    const stopping = r.stop(); // 기다리지 않는다 — A 는 SIGTERM 을 무시하므로 유예 동안 살아 있다
    r.start(target("acme/overlap-b", b, 2));
    await stopping;
    const second = await settle(r);
    expect(second.phase).toBe("running");
    expect(await httpGet(second.url!)).toMatchObject({ body: "b" });
    for (let i = 0; i < 50 && !existsSync(seenFile); i += 1) await new Promise((ok) => setTimeout(ok, 100));
    expect(readFileSync(seenFile, "utf8")).toBe("A 는 닫혀 있었다");
    expect(isAlive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
  });

  it("코드를 받는 중에 끄면 받기가 취소되고, 격리 폴더가 남지 않는다 (받기가 취소를 무시하고 늦게 끝나도)", async () => {
    const before = new Set(readdirSync(WORK));
    const signals: AbortSignal[] = [];
    const hanging = {
      label: "hanging",
      archive: (_t: PreviewTarget, o?: { signal?: AbortSignal }) =>
        new Promise<never>((_ok, fail) => {
          if (o?.signal !== undefined) signals.push(o.signal);
          o?.signal?.addEventListener("abort", () => fail(new Error("aborted")));
        }),
    };
    const r1 = runner({ source: hanging });
    r1.start(target("acme/any", "a".repeat(40)));
    await new Promise((ok) => setTimeout(ok, 200));
    await r1.stop();
    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);

    // 취소 신호를 무시하고 300ms 뒤에 묶음을 돌려주는 받기 — 그래도 폴더를 만들지 않는다
    const sha = commit("acme/late", appFiles("late", "late"));
    const real = createLocalRepoSource(REPOS, PARENT_ENV);
    const late = { label: "late", archive: async (t: PreviewTarget) => new Promise<Awaited<ReturnType<typeof real.archive>>>((ok) => setTimeout(() => void real.archive(t).then(ok), 300)) };
    const r2 = runner({ source: late });
    r2.start(target("acme/late", sha));
    await new Promise((ok) => setTimeout(ok, 50));
    await r2.stop();
    await new Promise((ok) => setTimeout(ok, 1000));
    expect(readdirSync(WORK).filter((n) => !before.has(n))).toEqual([]);
    expect(r2.current()).toMatchObject({ phase: "stopped" });
  });

  it("tar 가 입력을 다 읽기 전에 끝나도(EPIPE) Studio 가 죽지 않고 실패 이유를 보인다", async () => {
    const garbage = { label: "garbage", archive: async () => ({ bytes: new Uint8Array(32 * 1024 * 1024).fill(7), gzip: true, stripComponents: 0 }) };
    const r = runner({ source: garbage });
    r.start(target("acme/garbage", "b".repeat(40)));
    expect(await settle(r)).toMatchObject({ phase: "failed", failure: expect.stringContaining("코드 풀기(tar)") });
  });

  it("격리 폴더 밖을 가리키는 심볼릭 링크(node_modules → 밖)가 있으면 npm ci 를 돌리지 않는다", async () => {
    const outside = join(ROOT, "precious");
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(outside, "keep.txt"), "keep");
    const dir = join(REPOS, "acme", "linky");
    commit("acme/linky", appFiles("linky", "x"));
    symlinkSync(outside, join(dir, "node_modules"));
    const sha = commit("acme/linky", {});
    const r = runner();
    r.start(target("acme/linky", sha));
    const done = await settle(r);
    expect(done).toMatchObject({ phase: "failed", failure: expect.stringContaining("심볼릭 링크") });
    expect(done.failure).toContain("node_modules");
    expect(readFileSync(join(outside, "keep.txt"), "utf8")).toBe("keep");
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
        'console.log("db " + "postgresql://app:" + "pw@localhost:5432/app");',
        'console.log("session correct-horse-battery-staple end");',
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
    for (const secret of ["ghs_abcdefghijklmnopqrstuvwxyz0123", "abc.def.ghi", "hunter2", "supersecret", "pw@localhost", "correct-horse-battery-staple"]) expect(log).not.toContain(secret);
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

  it("응답이 오지 않으면 시간 상한에서 멈추고, 미리보기를 끄면(취소 신호) 바로 멈춘다", async () => {
    const neverAnswers = (_url: string, init: RequestInit): Promise<Response> =>
      new Promise((_ok, fail) => init.signal?.addEventListener("abort", () => fail(new Error("aborted"))));
    const slow = createGitHubTarballSource({ tokens: [{ getToken: async () => "t" }], fetch: neverAnswers, timeoutMs: 200 });
    const started = Date.now();
    await expect(slow.archive(target("acme/web", "e".repeat(40)))).rejects.toThrow("시간 상한");
    expect(Date.now() - started).toBeLessThan(5000);

    const cancel = new AbortController();
    const pending = createGitHubTarballSource({ tokens: [{ getToken: async () => "t" }], fetch: neverAnswers }).archive(target("acme/web", "e".repeat(40)), {
      signal: cancel.signal,
    });
    setTimeout(() => cancel.abort(), 50);
    await expect(pending).rejects.toThrow("취소");

    // 본문이 흘러오다 멈추는 경우도 상한이 끊는다
    const stalls = async (): Promise<Response> =>
      new Response(new ReadableStream({ start: (c) => c.enqueue(new Uint8Array(10)) }), { status: 200 });
    const stalled = createGitHubTarballSource({ tokens: [{ getToken: async () => "t" }], fetch: stalls, timeoutMs: 200 });
    await expect(stalled.archive(target("acme/web", "e".repeat(40)))).rejects.toThrow("시간 상한");
  });

  it("받을 크기 상한을 넘으면 멈추고, 오류 문장에 토큰이 없다", async () => {
    const big = async (): Promise<Response> => new Response(new Uint8Array(2048), { status: 200 });
    const source = createGitHubTarballSource({ tokens: [{ getToken: async () => "ghs_secretSecret999" }], fetch: big, maxBytes: 1024 });
    const error = await source.archive(target("acme/web", "e".repeat(40))).catch((e: unknown) => e as Error);
    expect(String(error)).toContain("상한");
    expect(String(error)).not.toContain("ghs_secretSecret999");
  });
});

describe("devOriginsOf — 개발 서버가 받아 줄 주소", () => {
  it("화면에 보이는 주소와 묶는 주소를 겹치지 않게 잇고, 모든 주소(0.0.0.0 · ::)는 뺀다", () => {
    expect(devOriginsOf("100.64.1.2", "100.64.1.2")).toBe("100.64.1.2");
    expect(devOriginsOf("100.64.1.2", "studio-pc.tail1234.ts.net")).toBe("studio-pc.tail1234.ts.net,100.64.1.2");
    expect(devOriginsOf("0.0.0.0", "127.0.0.1")).toBe("127.0.0.1");
    expect(devOriginsOf("::", "::1")).toBe("::1");
  });
});

/**
 * 미리보기의 규칙 (docs/plan/04-remote-preview.md §4 · §7 · §9 기준 1 · 2 · 5).
 * 실행기는 가짜를 쓴다 — 실제 프로세스를 띄우는 시험은 preview-local-runner.test.ts 에 있다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_FORK_REPO, DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { createOfflinePreviewRunner } from "../../src/adapters/preview/offline/offline-runner";
import { getPreviewCards, getPreviewDevice, startPreview } from "../../src/application/preview";
import { syncAll } from "../../src/application/sync";
import { StudioError } from "../../src/domain/model";
import { isFullSha, isSafeRepoFullName, previewBlockOf, previewTargetOf, type PreviewSession, type PreviewTarget } from "../../src/domain/preview";
import type { PreviewRunner } from "../../src/ports/preview-runner";
import { PREVIEW_NOT_CONNECTED, selectGitHubSources, selectPreviewConfig } from "../../src/server/container";
import { setup } from "./helpers";

const repo = { id: 1, fullName: "acme/web" };
const sha = "a".repeat(40);

/** 부른 대상을 기억하고, 곧바로 준비 중 기록을 돌려주는 가짜 실행기 */
function fakeRunner(): PreviewRunner & { started: PreviewTarget[]; set(session: PreviewSession | null): void } {
  let session: PreviewSession | null = null;
  const started: PreviewTarget[] = [];
  return {
    started,
    set: (s) => {
      session = s;
    },
    status: () => ({ online: true, label: "this computer · 127.0.0.1" }),
    start(target) {
      started.push(target);
      session = { id: "s1", target, phase: "fetching", startedAt: "2026-09-27T00:00:00.000Z", url: null, failure: null, logTail: [], replaced: null };
      return session;
    },
    async stop() {},
    current: () => session,
  };
}

describe("대상 제한 (domain/preview)", () => {
  it("전체 SHA 만 받는다 — 40자 또는 64자 소문자 16진수", () => {
    expect(isFullSha(sha)).toBe(true);
    expect(isFullSha("b".repeat(64))).toBe(true);
    expect(isFullSha("abc1234")).toBe(false);
    expect(isFullSha("A".repeat(40))).toBe(false);
    expect(isFullSha(`${"a".repeat(39)}g`)).toBe(false);
    expect(isFullSha(`${sha} `)).toBe(false);
  });

  it("저장소 이름은 owner/name 모양만 받는다 (코드를 받을 주소 · 폴더 이름이 되므로)", () => {
    expect(isSafeRepoFullName("acme/web")).toBe(true);
    expect(isSafeRepoFullName("acme/web.site_2")).toBe(true);
    for (const bad of ["acme/..", "acme/.", "../etc", "acme/web/x", "acme", "-acme/web", "acme/we b", "acme\\web"]) {
      expect(isSafeRepoFullName(bad), bad).toBe(false);
    }
  });

  it("복제본(fork)에서 온 PR 은 실행하지 않는다. 복제본 여부를 모르면 복제본으로 본다", () => {
    expect(previewBlockOf({ repoId: 1, headRepoId: 1, headSha: sha }, repo)).toBeNull();
    expect(previewBlockOf({ repoId: 1, headRepoId: 2, headSha: sha }, repo)).toBe("fork");
    expect(previewBlockOf({ repoId: 1, headRepoId: null, headSha: sha }, repo)).toBe("fork");
    expect(previewBlockOf({ repoId: 1, headRepoId: 1, headSha: "abc1234" }, repo)).toBe("sha_not_full");
    expect(previewBlockOf({ repoId: 1, headRepoId: 1, headSha: sha }, { id: 1, fullName: "acme/.." })).toBe("bad_repo");
  });

  it("실행 대상은 PR 의 지금 최신 커밋으로 고정된다", () => {
    const { data } = setup();
    const admin = data.pullRequests.find((p) => p.repoId === DEMO_REPO.adminConsole && p.number === 12)!;
    expect(previewTargetOf(admin, { id: DEMO_REPO.adminConsole, fullName: "demo-org/admin-console" })).toEqual({
      repoId: DEMO_REPO.adminConsole,
      number: 12,
      repoFullName: "demo-org/admin-console",
      commitSha: DEMO_SHA.admin12Head,
    });
  });
});

describe("연결 안 됨 (단위 A)", () => {
  it("실행기가 연결 안 됨이면 모든 카드가 이유와 함께 막히고, 위쪽 띠는 그 이유를 보인다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const runner = createOfflinePreviewRunner(PREVIEW_NOT_CONNECTED);
    const cards = await getPreviewCards(deps, runner, [{ repoId: DEMO_REPO.payments, number: 12 }]);
    expect(cards.get(`${DEMO_REPO.payments}#12`)).toEqual({
      availability: { kind: "runner_offline", reason: PREVIEW_NOT_CONNECTED },
      session: null,
      otherActive: null,
    });
    expect(await getPreviewDevice(deps, runner)).toEqual({ online: false, text: PREVIEW_NOT_CONNECTED, active: null });
    await expect(startPreview(deps, runner, { repoId: DEMO_REPO.payments, number: 12 })).rejects.toThrow(StudioError);
  });
});

describe("미리보기 유스케이스", () => {
  it("복제본 PR 은 실행기가 연결돼 있어도 막히고, 유스케이스도 거절한다 (오래된 화면에서 누른 경우)", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const runner = fakeRunner();
    const fork = { repoId: DEMO_REPO.payments, number: 18 };
    const cards = await getPreviewCards(deps, runner, [fork, { repoId: DEMO_REPO.payments, number: 12 }]);
    expect(cards.get(`${DEMO_REPO.payments}#18`)?.availability).toEqual({ kind: "blocked", block: "fork" });
    expect(cards.get(`${DEMO_REPO.payments}#12`)?.availability).toEqual({ kind: "available" });
    await expect(startPreview(deps, runner, fork)).rejects.toThrow("미리보기로 실행하지 않는다");
    expect(runner.started).toEqual([]);
    // 가짜 데이터의 복제본 PR 은 실제로 다른 저장소의 브랜치다
    expect((await deps.store.getSnapshot(fork))?.headRepoId).toBe(DEMO_FORK_REPO);
  });

  it("Open Preview 는 저장된 PR 의 최신 커밋을 실행기에 넘긴다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const runner = fakeRunner();
    await startPreview(deps, runner, { repoId: DEMO_REPO.adminConsole, number: 12 });
    expect(runner.started.map((t) => t.commitSha)).toEqual([DEMO_SHA.admin12Head]);
  });

  it("PR 에 새 커밋이 오면 실행 중인 미리보기는 이전 버전이다 (계약 §6)", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    const runner = fakeRunner();
    const ref = { repoId: DEMO_REPO.adminConsole, number: 12 };
    const session = await startPreview(deps, runner, ref);
    runner.set({ ...session, phase: "running", url: "http://127.0.0.1:4000/" });
    const before = (await getPreviewCards(deps, runner, [ref])).get(`${ref.repoId}#12`);
    expect(before?.session).toMatchObject({ phase: "running", freshness: "current", url: "http://127.0.0.1:4000/" });

    data.pullRequests = data.pullRequests.map((p) => (p.repoId === ref.repoId && p.number === 12 ? { ...p, headSha: "c".repeat(40) } : p));
    await syncAll(deps);
    const after = (await getPreviewCards(deps, runner, [ref])).get(`${ref.repoId}#12`);
    expect(after?.session).toMatchObject({ freshness: "outdated", commitSha: DEMO_SHA.admin12Head });
  });

  it("다른 PR 의 미리보기가 살아 있으면 그 PR 을 알려 준다 (열면 그것이 꺼진다)", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const runner = fakeRunner();
    await startPreview(deps, runner, { repoId: DEMO_REPO.adminConsole, number: 12 });
    const cards = await getPreviewCards(deps, runner, [{ repoId: DEMO_REPO.payments, number: 12 }]);
    expect(cards.get(`${DEMO_REPO.payments}#12`)?.otherActive).toEqual({ repoName: "demo-org/admin-console", number: 12 });
    expect((await getPreviewDevice(deps, runner)).active).toEqual({ repoName: "demo-org/admin-console", number: 12, phase: "fetching" });
  });
});

describe("미리보기 설정 (조립부)", () => {
  const off = (env: Record<string, string>) => selectPreviewConfig(env, selectGitHubSources(env));

  it("PREVIEW_WORKDIR 가 없으면 연결 안 됨이고, 이유는 무엇을 하면 되는지 말한다", () => {
    expect(off({})).toEqual({ kind: "off", reason: PREVIEW_NOT_CONNECTED });
    expect(PREVIEW_NOT_CONNECTED).toContain("PREVIEW_WORKDIR");
  });

  it("경로는 절대 경로만, 주소는 IP · 호스트 이름만 받는다. 이유 문장에 값을 싣지 않는다", () => {
    expect(off({ PREVIEW_WORKDIR: "relative/dir" })).toMatchObject({ kind: "off", reason: expect.stringContaining("절대 경로") });
    const badHost = off({ PREVIEW_WORKDIR: "/tmp/pv", PREVIEW_LOCAL_REPOS_DIR: "/tmp/repos", PREVIEW_BIND_HOST: "evil.example/x" });
    expect(badHost).toMatchObject({ kind: "off" });
    expect(JSON.stringify(badHost)).not.toContain("evil.example");
  });

  it("고정 데이터 모드에서는 로컬 시연 저장소가 있어야 켜진다", () => {
    expect(off({ PREVIEW_WORKDIR: "/tmp/pv" })).toMatchObject({ kind: "off", reason: expect.stringContaining("PREVIEW_LOCAL_REPOS_DIR") });
    expect(off({ PREVIEW_WORKDIR: "/tmp/pv", PREVIEW_LOCAL_REPOS_DIR: "/tmp/repos" })).toEqual({
      kind: "on",
      workdir: "/tmp/pv",
      bindHost: "127.0.0.1",
      publicHost: "127.0.0.1",
      code: { kind: "local_repos", dir: "/tmp/repos" },
    });
  });

  it("모든 주소에 묶으면 화면 주소는 127.0.0.1, 사설망 이름을 주면 그 이름을 보인다", () => {
    const env = { PREVIEW_WORKDIR: "/tmp/pv", PREVIEW_LOCAL_REPOS_DIR: "/tmp/repos", PREVIEW_BIND_HOST: "0.0.0.0" };
    expect(off(env)).toMatchObject({ bindHost: "0.0.0.0", publicHost: "127.0.0.1" });
    expect(off({ ...env, PREVIEW_PUBLIC_HOST: "mac-pro.tail1234.ts.net" })).toMatchObject({ publicHost: "mac-pro.tail1234.ts.net" });
    expect(off({ ...env, PREVIEW_BIND_HOST: "100.64.0.7" })).toMatchObject({ bindHost: "100.64.0.7", publicHost: "100.64.0.7" });
  });

  it("GitHub 출처가 있으면 GitHub 에서 받고, GitHub 설정 오류가 있으면 켜지지 않는다", () => {
    expect(off({ PREVIEW_WORKDIR: "/tmp/pv", GITHUB_TOKEN: "t", GITHUB_REPOS: "acme/web" })).toMatchObject({
      kind: "on",
      code: { kind: "github" },
    });
    expect(off({ PREVIEW_WORKDIR: "/tmp/pv", GITHUB_TOKEN: "t" })).toMatchObject({ kind: "off", reason: expect.stringContaining("설정 오류") });
  });
});

describe("자식 환경의 허용 목록과 로그 가림 (adapters/preview/local/child-env)", () => {
  it("Studio 환경에서 비밀 이름의 값(과 비밀 키의 각 줄)을 알려진 비밀로 모은다", async () => {
    const { knownSecretsOf } = await import("../../src/adapters/preview/local/child-env");
    const dashes = "-".repeat(5); // 저장소 비밀 검사가 이 시험 파일을 비밀 키로 보지 않게 머리말을 나눠 쓴다
    const key = `${dashes}BEGIN FAKE KEY${dashes}\nMIIEpAIBAAKCAQEAabcdefghijklmnop\n${dashes}END FAKE KEY${dashes}`;
    const secrets = knownSecretsOf({ GITHUB_APP_PRIVATE_KEY: key, DATABASE_URL: "postgresql://a:b@h/db", PATH: "/usr/bin:/bin/long/enough", SHORT_TOKEN: "abc" });
    expect(secrets).toContain(key);
    expect(secrets).toContain("MIIEpAIBAAKCAQEAabcdefghijklmnop");
    expect(secrets).toContain("postgresql://a:b@h/db");
    expect(secrets).not.toContain("/usr/bin:/bin/long/enough");
    expect(secrets).not.toContain("abc");
  });

  it("허용 목록의 이름만 옮기고, 프록시는 코드 받기 · 설치 단계에만 준다", async () => {
    const { previewChildEnv } = await import("../../src/adapters/preview/local/child-env");
    const parent = { PATH: "/bin", HOME: "/h", HTTPS_PROXY: "http://proxy:3128", GITHUB_TOKEN: "x", DATABASE_URL: "y", NODE_OPTIONS: "z" };
    expect(previewChildEnv(parent, "install")).toEqual({ PATH: "/bin", HOME: "/h", HTTPS_PROXY: "http://proxy:3128" });
    expect(previewChildEnv(parent, "run", { PORT: "4000" })).toEqual({ PATH: "/bin", HOME: "/h", PORT: "4000" });
    // 코드 풀기(tar) · 로컬 저장소 묶기(git) 는 네트워크가 필요 없어 프록시를 받지 않는다
    expect(previewChildEnv(parent, "fetch")).toEqual({ PATH: "/bin", HOME: "/h" });
  });

  it("Windows 에서는 대소문자만 다른 이름(PATH · Path, SYSTEMROOT · SystemRoot)을 하나만 남긴다", async () => {
    const { previewChildEnv } = await import("../../src/adapters/preview/local/child-env");
    const parent = { PATH: "C:\\bin", Path: "C:\\bin", SYSTEMROOT: "C:\\Windows", SystemRoot: "C:\\Windows", USERPROFILE: "C:\\Users\\John Doe" };
    const env = previewChildEnv(parent, "run", { PORT: "1" }, "win32");
    expect(env).toEqual({ PATH: "C:\\bin", SYSTEMROOT: "C:\\Windows", USERPROFILE: "C:\\Users\\John Doe", PORT: "1" });
    expect(Object.keys(previewChildEnv(parent, "run", {}, "linux"))).toEqual(["PATH", "Path", "USERPROFILE", "SYSTEMROOT", "SystemRoot"]);
  });

  it("Windows 의 npm 명령줄은 고정 낱말만 받고, 셸이 해석할 글자는 거부한다", async () => {
    const { windowsNpmCommand } = await import("../../src/adapters/preview/local/local-runner");
    expect(windowsNpmCommand(["ci", "--no-audit", "--no-fund"], "C:\\Windows\\system32\\cmd.exe")).toEqual({
      command: "C:\\Windows\\system32\\cmd.exe",
      args: ["/d", "/s", "/c", '"npm ci --no-audit --no-fund"'],
    });
    for (const bad of ["dev & calc", "a^b", 'x"y', "%PATH%", "a b", "a|b"]) expect(() => windowsNpmCommand(["run", bad])).toThrow("넘길 수 없는");
  });

  it("격리 폴더 안을 가리키는 링크는 두고, 밖 · 없는 곳을 가리키는 링크를 찾는다", async () => {
    const { escapingSymlinks } = await import("../../src/adapters/preview/local/local-runner");
    const { mkdtempSync, mkdirSync, symlinkSync, writeFileSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const root = mkdtempSync(join(tmpdir(), "links-"));
    try {
      const src = join(root, "src");
      mkdirSync(join(src, "sub"), { recursive: true });
      writeFileSync(join(src, "README.md"), "x");
      symlinkSync("README.md", join(src, "readme-link"));
      symlinkSync("..", join(src, "sub", "up")); // src 자신 — 안이다
      expect(await escapingSymlinks(src)).toEqual([]);
      symlinkSync("../..", join(src, "sub", "escape")); // src 의 부모 — 밖이다
      symlinkSync("sub/up/../../x", join(src, "tricky")); // 이름만 보면 안이지만 실제로는 밖(그리고 없는 곳)이다
      const bad = await escapingSymlinks(src);
      expect(bad.some((b) => b.startsWith(join("sub", "escape")))).toBe(true);
      expect(bad.some((b) => b.startsWith("tricky"))).toBe(true);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("토큰 모양 · Authorization · 주소 속 계정 · *_TOKEN= 값 · 알려 준 값을 가린다", async () => {
    const { redactSecrets } = await import("../../src/adapters/preview/local/child-env");
    expect(redactSecrets("t=ghp_abcdefghij1234 and github_pat_11ABCDEFG_xyz")).toBe("t=[가림] and [가림]");
    expect(redactSecrets("Authorization: Bearer abc")).toBe("Authorization: [가림]");
    expect(redactSecrets("git clone https://x-access-token:ghs_zzz@github.com/a/b")).toBe("git clone https://[가림]@github.com/a/b");
    expect(redactSecrets("NPM_TOKEN=abc123 DB_PASSWORD=p")).toBe("NPM_TOKEN=[가림] DB_PASSWORD=[가림]");
    expect(redactSecrets("value 0123456789abcdef here", ["0123456789abcdef"])).toBe("value [가림] here");
    expect(redactSecrets("평범한 로그 줄")).toBe("평범한 로그 줄");
    // 대소문자 무시 · npm 토큰 · .npmrc 의 _authToken · JSON 모양
    expect(redactSecrets("export api_token=abc db_password=p")).toBe("export api_token=[가림] db_password=[가림]");
    expect(redactSecrets("using npm_abcdefghijklmnopqrstuvwxyz0123456789")).toBe("using [가림]");
    expect(redactSecrets("//registry.npmjs.org/:_authToken=s3cr3tvalue")).toBe("//registry.npmjs.org/:_authToken=[가림]");
    expect(redactSecrets('{"token":"abc","user":"kim","apiKey": "k-123","client_secret":"q"}')).toBe(
      '{"token":"[가림]","user":"kim","apiKey": "[가림]","client_secret":"[가림]"}',
    );
  });
});

/** 조립부 — 환경변수가 둘 다 있을 때만 REST 어댑터를, 아니면 fixture 어댑터를 고르는지 본다. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { getInbox } from "../../src/application/queries";
import { createContainer, readGitHubConfig } from "../../src/server/container";

describe("조립부의 어댑터 선택", () => {
  it.each([
    [{}, "fixture"],
    [{ GITHUB_TOKEN: "t" }, "fixture"],
    [{ GITHUB_REPOS: "a/b" }, "fixture"],
    [{ GITHUB_TOKEN: "  ", GITHUB_REPOS: "a/b" }, "fixture"],
    [{ GITHUB_TOKEN: "t", GITHUB_REPOS: " , " }, "fixture"],
    [{ GITHUB_TOKEN: "t", GITHUB_REPOS: "a/b" }, "github"],
  ])("환경변수 %j 이면 %s 어댑터", (env, source) => {
    expect(createContainer(env).deps.reader.source).toBe(source);
  });

  it("저장소 목록을 쉼표로 나누고 앞뒤 공백을 지운다", () => {
    expect(readGitHubConfig({ GITHUB_TOKEN: " t ", GITHUB_REPOS: " a/b, c/d ,," })).toEqual({ token: "t", repos: ["a/b", "c/d"] });
  });

  it("fixture 모드는 첫 동기화를 한 번만 하고 시각을 남긴다", async () => {
    const container = createContainer({});
    expect(container.status().lastSyncedAt).toBeNull();
    await Promise.all([container.ensureSynced(), container.ensureSynced()]);
    expect(container.status()).toMatchObject({ lastError: null });
    expect(container.status().lastSyncedAt).not.toBeNull();
    expect((await container.deps.store.listSnapshots()).length).toBeGreaterThan(0);
  });
});

describe("조립부의 REST 모드", () => {
  const TOKEN = "ghp_CONTAINER_SECRET_987654321";
  const env = { GITHUB_TOKEN: TOKEN, GITHUB_REPOS: "demo-org/payments" };

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GitHub 에 닿지 못하면 동기화가 실패 이유를 남기되, 그 문장에 토큰이 없다", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new Error(`boom Bearer ${TOKEN}`);
    });
    const container = createContainer(env);
    await container.sync();
    expect(container.status().lastError).toContain("GitHub 에 닿지 못했다");
    expect(container.status().lastError).not.toContain(TOKEN);
    expect(container.status().lastSyncedAt).toBeNull();
  });

  it("읽은 저장소마다 프로젝트가 생기고, 표식 없는 PR 은 그 프로젝트의 Inbox 에 간다", async () => {
    const sha = "c".repeat(40);
    const routes: Record<string, unknown> = {
      "https://api.github.com/repos/demo-org/payments": { id: 710001, full_name: "demo-org/payments" },
      "https://api.github.com/repos/demo-org/payments/pulls?state=all&sort=updated&direction=desc&per_page=50": [
        {
          number: 3,
          title: "첫 PR",
          body: null,
          state: "open",
          merged_at: null,
          html_url: "https://github.com/demo-org/payments/pull/3",
          updated_at: "2026-09-24T00:00:00Z",
          user: { login: "a" },
          head: { ref: "feat/x", sha },
        },
      ],
      [`https://api.github.com/repos/demo-org/payments/commits/${sha}/check-runs?per_page=100`]: { check_runs: [] },
      "https://api.github.com/repos/demo-org/payments/pulls/3/reviews?per_page=100": [],
    };
    const methods: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      methods.push(String(init.method));
      const body = routes[url];
      return body === undefined ? new Response("{}", { status: 404 }) : new Response(JSON.stringify(body), { status: 200 });
    });

    const container = createContainer(env);
    await container.ensureSynced();

    expect(container.status().lastError).toBeNull();
    expect(new Set(methods)).toEqual(new Set(["GET"]));
    const inbox = await getInbox(container.deps);
    expect(inbox.groups.map((g) => [g.project.name, g.items.map((i) => [i.pr.key, i.reason])])).toEqual([
      ["demo-org/payments", [["710001#3", "no_marker"]]],
    ]);
  });
});

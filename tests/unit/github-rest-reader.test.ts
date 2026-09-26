/**
 * REST 어댑터 — GET 이외의 요청과 api.github.com 이외의 주소를 보내기 전에 막는지, 토큰이 오류에 새지 않는지,
 * GitHub 응답 모양의 가짜 JSON 을 도메인 값으로 바르게 옮기는지 시험한다. 진짜 네트워크는 쓰지 않는다.
 */
import { describe, expect, it } from "vitest";
import { createGuardedGet, GitHubReadError, GitHubRequestBlockedError } from "../../src/adapters/github/rest/guarded-get";
import {
  createGitHubRestReader,
  PULLS_PER_REPO,
  summarizeChecks,
  summarizeReviews,
} from "../../src/adapters/github/rest/rest-reader";

const TOKEN = "ghp_TEST_SECRET_TOKEN_1234567890";

interface Call {
  url: string;
  method: string | undefined;
  authorization: string | null;
}

/** 주소별로 정해 둔 응답을 돌려주는 가짜 fetch. 받은 요청을 모두 기록한다. */
function fakeFetch(routes: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push({ url, method: init.method, authorization: new Headers(init.headers).get("authorization") });
    const route = routes[url];
    if (route === undefined) return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
    return route();
  };
  return { fetch, calls };
}

const json = (body: unknown, status = 200) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

async function caught(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error("Error 가 아닌 것이 던져졌다");
  }
  throw new Error("오류가 나야 하는데 나지 않았다");
}

function expectNoToken(error: Error) {
  expect(error.message).not.toContain(TOKEN);
  expect(String(error.stack)).not.toContain(TOKEN);
  expect(JSON.stringify(error)).not.toContain(TOKEN);
}

describe("GET 전용 관문", () => {
  it.each(["POST", "PATCH", "PUT", "DELETE", "post"])("%s 요청은 네트워크로 나가기 전에 막는다", async (method) => {
    const { fetch, calls } = fakeFetch({});
    const get = createGuardedGet({ token: TOKEN, fetch });
    const error = await caught(get("https://api.github.com/repos/demo-org/payments/pulls", { method }));
    expect(error).toBeInstanceOf(GitHubRequestBlockedError);
    expect(calls).toHaveLength(0);
    expectNoToken(error);
  });

  it.each([
    "https://example.com/repos/a/b",
    "http://api.github.com/repos/a/b",
    "https://api.github.com.evil.test/repos/a/b",
    "https://uploads.github.com/repos/a/b",
    `https://${TOKEN}@api.github.com/repos/a/b`,
    "not a url",
  ])("api.github.com 이 아닌 주소(%s)로는 요청하지 않는다", async (url) => {
    const { fetch, calls } = fakeFetch({});
    const get = createGuardedGet({ token: TOKEN, fetch });
    const error = await caught(get(url));
    expect(error).toBeInstanceOf(GitHubRequestBlockedError);
    expect(calls).toHaveLength(0);
    expectNoToken(error);
  });

  it("같은 호스트로의 리디렉션은 관문을 다시 거쳐 따라가고, 다른 호스트로의 리디렉션은 따라가지 않는다", async () => {
    const same = fakeFetch({
      "https://api.github.com/repos/old/name": () =>
        new Response(null, { status: 301, headers: { location: "https://api.github.com/repositories/42" } }),
      "https://api.github.com/repositories/42": json({ id: 42, full_name: "new/name" }),
    });
    await expect(createGuardedGet({ token: TOKEN, fetch: same.fetch })("https://api.github.com/repos/old/name")).resolves.toEqual({
      id: 42,
      full_name: "new/name",
    });
    expect(same.calls.map((c) => c.method)).toEqual(["GET", "GET"]);

    const other = fakeFetch({
      "https://api.github.com/repos/a/b": () =>
        new Response(null, { status: 302, headers: { location: "https://evil.test/steal" } }),
    });
    const error = await caught(createGuardedGet({ token: TOKEN, fetch: other.fetch })("https://api.github.com/repos/a/b"));
    expect(error).toBeInstanceOf(GitHubRequestBlockedError);
    expect(other.calls.map((c) => c.url)).toEqual(["https://api.github.com/repos/a/b"]);
  });

  it("형식이 잘못된 Location 헤더는 날것의 TypeError 가 아니라 GitHubReadError 로 알린다 (토큰 없이)", async () => {
    const broken = fakeFetch({
      "https://api.github.com/repos/a/b": () =>
        new Response(null, { status: 301, headers: { location: `https://[${TOKEN}` } }),
    });
    const error = await caught(createGuardedGet({ token: TOKEN, fetch: broken.fetch })("https://api.github.com/repos/a/b"));
    expect(error).toBeInstanceOf(GitHubReadError);
    expect(error).not.toBeInstanceOf(TypeError);
    expect(error.message).toContain("해석할 수 없는 이동 주소");
    expectNoToken(error);
    expect(broken.calls).toHaveLength(1);
  });

  it("GitHub 가 거절하거나 네트워크가 실패해도 오류 메시지에 토큰이 없다", async () => {
    const echoing = fakeFetch({
      // 응답 본문이 토큰을 되돌려 주는 극단적인 경우에도 새지 않는지 본다
      "https://api.github.com/repos/a/b": json({ message: `Bad credentials ${TOKEN}` }, 401),
    });
    const rejected = await caught(createGuardedGet({ token: TOKEN, fetch: echoing.fetch })("https://api.github.com/repos/a/b"));
    expect(rejected).toBeInstanceOf(GitHubReadError);
    expect(rejected.message).toContain("401");
    expectNoToken(rejected);

    const failing = async (): Promise<Response> => {
      throw new Error(`connect ECONNREFUSED (Authorization: Bearer ${TOKEN})`);
    };
    const network = await caught(createGuardedGet({ token: TOKEN, fetch: failing })("https://api.github.com/repos/a/b"));
    expect(network).toBeInstanceOf(GitHubReadError);
    expectNoToken(network);
  });
});

describe("REST 읽기 어댑터", () => {
  const sha = (c: string) => c.repeat(40);
  const routes = {
    "https://api.github.com/repos/demo-org/payments": json({ id: 710001, full_name: "demo-org/payments" }),
    [`https://api.github.com/repos/demo-org/payments/pulls?state=all&sort=updated&direction=desc&per_page=${PULLS_PER_REPO}`]: json([
      {
        number: 12,
        title: "로그인 화면 추가",
        body: "studio-work-a1b2c3",
        state: "open",
        merged_at: null,
        html_url: "https://github.com/demo-org/payments/pull/12",
        updated_at: "2026-09-24T09:00:00Z",
        user: { login: "claude-cloud" },
        head: { ref: "feat/login-page", sha: sha("a"), repo: { id: 710001, full_name: "demo-org/payments" } },
      },
      {
        number: 15,
        title: "세션 만료 처리",
        body: null,
        state: "closed",
        merged_at: "2026-09-23T00:00:00Z",
        html_url: "https://github.com/demo-org/payments/pull/15",
        updated_at: "2026-09-23T00:00:00Z",
        user: { login: "local-dev" },
        head: { ref: "fix/session", sha: sha("b"), repo: null }, // 복제본이 지워지면 GitHub 가 head.repo 를 null 로 준다
      },
      {
        number: 18,
        title: "외부 기여",
        body: "studio-work-a1b2c3",
        state: "open",
        merged_at: null,
        html_url: "https://github.com/demo-org/payments/pull/18",
        updated_at: "2026-09-24T10:00:00Z",
        user: { login: "outsider" },
        head: { ref: "patch-1", sha: sha("d"), repo: { id: 990001, full_name: "outsider/payments" } }, // 복제본
      },
    ]),
    [`https://api.github.com/repos/demo-org/payments/commits/${sha("a")}/check-runs?per_page=100`]: json({
      total_count: 2,
      check_runs: [
        { status: "completed", conclusion: "success" },
        { status: "completed", conclusion: "failure" },
      ],
    }),
    [`https://api.github.com/repos/demo-org/payments/commits/${sha("b")}/check-runs?per_page=100`]: json({
      total_count: 0,
      check_runs: [],
    }),
    "https://api.github.com/repos/demo-org/payments/pulls/12/reviews?per_page=100": json([
      { state: "CHANGES_REQUESTED", user: { login: "kim" } },
      { state: "COMMENTED", user: { login: "kim" } },
    ]),
    [`https://api.github.com/repos/demo-org/payments/commits/${sha("d")}/check-runs?per_page=100`]: json({ check_runs: [] }),
    "https://api.github.com/repos/demo-org/payments/pulls/18/reviews?per_page=100": json([]),
    "https://api.github.com/repos/demo-org/payments/pulls/15/reviews?per_page=100": json([
      { state: "APPROVED", user: { login: "lee" } },
    ]),
  };

  it("저장소와 PR 을 GitHub 응답 모양에서 도메인 값으로 옮긴다", async () => {
    const { fetch } = fakeFetch(routes);
    const reader = createGitHubRestReader({ token: TOKEN, repos: ["demo-org/payments"], fetch });

    const repositories = await reader.listRepositories();
    expect(repositories).toEqual([{ id: 710001, fullName: "demo-org/payments" }]);
    const [repo] = repositories;
    if (repo === undefined) throw new Error("저장소가 없다");

    const prs = await reader.listPullRequests(repo);
    expect(prs).toEqual([
      expect.objectContaining({
        repoId: 710001,
        number: 12,
        branch: "feat/login-page",
        headRepoId: 710001, // 그 저장소 자신의 브랜치
        headSha: sha("a"),
        state: "open",
        checks: "failing",
        review: "changes_requested",
        body: "studio-work-a1b2c3",
      }),
      expect.objectContaining({ repoId: 710001, number: 15, headRepoId: null, state: "merged", checks: "none", review: "approved", body: "" }),
      expect.objectContaining({ repoId: 710001, number: 18, headRepoId: 990001 }), // 복제본의 저장소 ID 를 그대로 옮긴다
    ]);
  });

  it("모든 요청이 api.github.com 으로 가는 GET 이고, 토큰은 Authorization 헤더에만 실린다", async () => {
    const { fetch, calls } = fakeFetch(routes);
    const reader = createGitHubRestReader({ token: TOKEN, repos: ["demo-org/payments"], fetch });
    for (const repo of await reader.listRepositories()) await reader.listPullRequests(repo);

    expect(calls.length).toBe(8); // 저장소 1 + PR 목록 1 + (검사 1 + 리뷰 1) × PR 3
    for (const call of calls) {
      expect(call.method).toBe("GET");
      expect(new URL(call.url).origin).toBe("https://api.github.com");
      expect(call.url).not.toContain(TOKEN);
      expect(call.authorization).toBe(`Bearer ${TOKEN}`);
    }
    expect(calls.some((c) => c.url.includes(`per_page=${PULLS_PER_REPO}`))).toBe(true); // 상한이 요청에 실린다
  });

  it("어댑터에는 읽는 메서드만 있고, 읽기 범위의 상한을 화면용 문장으로 알린다", () => {
    const reader = createGitHubRestReader({ token: TOKEN, repos: [], fetch: fakeFetch({}).fetch });
    expect(Object.keys(reader).sort()).toEqual(["limitNote", "listPullRequests", "listRepositories", "source", "startRun"]);
    expect(reader.limitNote).toContain(String(PULLS_PER_REPO));
  });

  it("owner/name 형식이 아닌 저장소 이름은 요청하지 않는다", async () => {
    const { fetch, calls } = fakeFetch({});
    const reader = createGitHubRestReader({ token: TOKEN, repos: ["just-a-name"], fetch });
    await expect(reader.listRepositories()).rejects.toBeInstanceOf(GitHubReadError);
    expect(calls).toHaveLength(0);
  });

  it("검사 결과와 리뷰를 요약한다", () => {
    expect(summarizeChecks({ check_runs: [] })).toBe("none");
    expect(summarizeChecks({ check_runs: [{ status: "in_progress", conclusion: null }] })).toBe("pending");
    expect(summarizeChecks({ check_runs: [{ status: "completed", conclusion: "success" }] })).toBe("passing");
    expect(summarizeChecks({ check_runs: [{ status: "completed", conclusion: "skipped" }] })).toBe("passing");
    expect(
      summarizeChecks({ check_runs: [{ status: "in_progress" }, { status: "completed", conclusion: "timed_out" }] }),
    ).toBe("failing");

    expect(summarizeReviews([])).toBe("none");
    expect(summarizeReviews([{ state: "COMMENTED", user: { login: "a" } }])).toBe("none");
    expect(
      summarizeReviews([
        { state: "CHANGES_REQUESTED", user: { login: "a" } },
        { state: "APPROVED", user: { login: "a" } },
      ]),
    ).toBe("approved"); // 같은 리뷰어의 마지막 결정만 센다
    expect(
      summarizeReviews([
        { state: "APPROVED", user: { login: "a" } },
        { state: "CHANGES_REQUESTED", user: { login: "b" } },
      ]),
    ).toBe("changes_requested");
  });
});

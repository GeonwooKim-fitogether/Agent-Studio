/**
 * Sync 속도 — 지연을 넣은 가짜 GitHub 로 요청 수 · 동시에 나가는 요청 수 · 걸린 시간을 잰다.
 *
 * 사용자 컴퓨터의 실측(저장소 17개 · PR 102개, GitHub App 만, Sync 1회 86~103초)과 같은 모양을 만든다.
 * 요청 하나의 지연은 기본 25ms 이고, SYNC_BENCH_LATENCY_MS 로 바꿀 수 있다(예: 400 으로 실측과 비슷한 조건을 재현).
 */
import { describe, expect, it } from "vitest";
import { createGitHubAppReader } from "../../src/adapters/github/app/app-reader";
import { createMultiReader } from "../../src/adapters/github/multi/multi-reader";
import { createRequestMeter } from "../../src/adapters/github/rest/guarded-get";
import { createGitHubRestReader } from "../../src/adapters/github/rest/rest-reader";
import { createMemoryStore } from "../../src/adapters/store/memory/memory-store";
import type { AppDeps } from "../../src/application/deps";
import { syncAll } from "../../src/application/sync";
import type { GitHubReader } from "../../src/ports/github-reader";

const LATENCY_MS = Number(process.env["SYNC_BENCH_LATENCY_MS"] ?? "25");
const API = "https://api.github.com";
const REPOS = 17;
const PRS = 102;

/** 저장소 17개에 PR 102개를 나눠 담은 가짜 GitHub. 저장소마다 앞의 2개는 열린 PR, 나머지는 닫힌 PR 이다 */
function fakeGitHub(options: { latencyMs: number; failRepo?: string }) {
  const repos = Array.from({ length: REPOS }, (_, i) => ({ id: 5000 + i, full_name: `me/repo-${i}` }));
  const pullsOf = new Map<string, unknown[]>();
  for (let n = 0; n < PRS; n += 1) {
    const repo = repos[n % REPOS]!;
    const list = pullsOf.get(repo.full_name) ?? [];
    const open = list.length < 2;
    list.push({
      number: n + 1,
      title: `PR ${n + 1}`,
      body: "",
      state: open ? "open" : "closed",
      merged_at: open ? null : "2026-09-20T00:00:00Z",
      html_url: `https://github.com/${repo.full_name}/pull/${n + 1}`,
      updated_at: `2026-09-${String(10 + (n % 15)).padStart(2, "0")}T00:00:00Z`,
      user: { login: "dev" },
      head: { ref: `feat/${n + 1}`, sha: (n % 16).toString(16).repeat(40), repo: { id: repo.id } },
      base: { repo: { id: repo.id } },
    });
    pullsOf.set(repo.full_name, list);
  }
  const calls: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;

  function route(url: URL): { status: number; body: unknown } {
    const p = url.pathname;
    if (p === "/installation/repositories") return { status: 200, body: { repositories: repos } };
    if (p === "/user/repos") return { status: 200, body: repos };
    const m = /^\/repos\/(me\/repo-\d+)(\/.*)?$/.exec(p);
    if (m === null) return { status: 404, body: {} };
    const [, fullName = "", rest = ""] = m;
    if (options.failRepo === fullName && rest.includes("/reviews")) return { status: 500, body: {} };
    if (rest === "") return { status: 200, body: repos.find((r) => r.full_name === fullName) };
    const pulls = pullsOf.get(fullName) ?? [];
    if (rest === "/pulls") {
      const state = url.searchParams.get("state");
      return { status: 200, body: pulls.filter((pr) => state === "all" || (pr as { state: string }).state === state) };
    }
    if (rest.includes("/check-runs")) return { status: 200, body: { check_runs: [{ status: "completed", conclusion: "success" }] } };
    if (rest.includes("/reviews")) return { status: 200, body: [{ state: "APPROVED", user: { login: "rev" } }] };
    return { status: 404, body: {} };
  }

  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    calls.push(`${init.method ?? "GET"} ${url.replace(API, "")}`);
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    try {
      await new Promise((ok) => setTimeout(ok, options.latencyMs));
      const { status, body } = route(new URL(url));
      return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
    } finally {
      inFlight -= 1;
    }
  };
  return { fetch, calls, maxInFlight: () => maxInFlight };
}

function deps(reader: GitHubReader): AppDeps {
  let n = 0;
  return {
    reader,
    store: createMemoryStore(),
    now: () => new Date("2026-09-27T00:00:00.000Z"),
    newId: () => `id${(n += 1)}`,
  };
}

async function measure(reader: (fetch: ReturnType<typeof fakeGitHub>["fetch"]) => GitHubReader, failRepo?: string) {
  const github = fakeGitHub({ latencyMs: LATENCY_MS, ...(failRepo === undefined ? {} : { failRepo }) });
  const d = deps(reader(github.fetch));
  const started = performance.now();
  const result = await syncAll(d);
  const elapsedMs = Math.round(performance.now() - started);
  const snapshots = await d.store.listSnapshots();
  return { result, elapsedMs, requests: github.calls.length, maxInFlight: github.maxInFlight(), calls: github.calls, snapshots };
}

const appReader = (fetch: ReturnType<typeof fakeGitHub>["fetch"]) =>
  createGitHubAppReader({ tokens: { getToken: async () => "ghs_fake" }, fetch });

describe("Sync 속도 — 저장소 17개 · PR 102개, 요청마다 지연", { timeout: 600_000 }, () => {
  it("GitHub App 만: 요청 수는 그대로이고, 동시에 나가는 요청은 상한(8) 안이며, 걸린 시간이 직렬의 1/4 보다 짧다", async () => {
    const m = await measure(appReader);
    // 1(설치된 저장소 목록) + 저장소마다 2(열린 PR · 닫힌 PR 목록) + PR 마다 2(검사 · 리뷰)
    expect(m.requests).toBe(1 + REPOS * 2 + PRS * 2);
    expect(m.result).toMatchObject({ repositories: REPOS, pullRequests: PRS });
    expect(m.calls.every((c) => c.startsWith("GET "))).toBe(true);
    const serialMs = m.requests * LATENCY_MS;
    console.log(`[sync-speed] App: 요청 ${m.requests}번 · 동시 최대 ${m.maxInFlight} · ${m.elapsedMs}ms (직렬이면 약 ${serialMs}ms, 지연 ${LATENCY_MS}ms)`);
    expect(m.maxInFlight).toBeLessThanOrEqual(8);
    expect(m.elapsedMs).toBeLessThan(serialMs / 4);
  });

  it("겹쳐 읽어도 받아 적는 결과(스냅샷 · 순서 · 요청 목록)는 요청을 하나씩 보낼 때와 같다", async () => {
    const fast = await measure(appReader);
    // 동시 상한 1 인 예산을 넘기면 요청이 하나씩 나간다 — 바꾸기 전과 같은 직렬 읽기
    const serial = await measure((fetch) => {
      const reader = appReader(fetch);
      return { ...reader, startRun: () => reader.startRun!(createRequestMeter(1500, 1)) };
    });
    expect(serial.maxInFlight).toBe(1);
    const view = (m: typeof fast) => m.snapshots.map((s) => `${s.repoId}#${s.number}:${s.state}:${s.checks}:${s.review}`);
    expect(view(fast)).toHaveLength(PRS);
    expect(view(fast)).toEqual(view(serial));
    expect(fast.result).toEqual(serial.result);
    expect([...fast.calls].sort()).toEqual([...serial.calls].sort()); // 같은 요청을, 순서만 다르게 보낸다
  });

  it("두 출처(App + 토큰)를 함께 읽을 때도 요청 상한 예산 하나를 나눠 쓰고, 한 저장소의 실패는 그 출처만 멈춘다", async () => {
    const m = await measure(
      (fetch) =>
        createMultiReader(
          [
            { label: "GitHub App", reader: appReader(fetch) },
            { label: "Token (org)", reader: createGitHubRestReader({ token: "ghp_fake", repos: ["me/repo-0"], fetch }) },
          ],
          { maxRequests: 1500 },
        ),
      "me/repo-3",
    );
    expect(m.maxInFlight).toBeLessThanOrEqual(8);
    expect(m.requests).toBeLessThan(1 + REPOS * 2 + PRS * 2); // 실패한 뒤 App 쪽의 줄 서 있던 요청은 나가지 않았다
    const sources = m.result.sources;
    expect(sources[0]?.error).toContain("500");
    expect(sources[1]).toMatchObject({ error: null, repositories: 0 }); // repo-0 은 App 이 먼저 맡는다
    console.log(`[sync-speed] App + 토큰(App 쪽 실패 포함): 요청 ${m.requests}번 · 동시 최대 ${m.maxInFlight} · ${m.elapsedMs}ms`);
  });

  it("요청 상한은 병렬에서도 지켜진다 — 상한에 닿으면 넘는 요청은 나가지 않는다", async () => {
    const github = fakeGitHub({ latencyMs: 1 });
    const d = deps(createGitHubAppReader({ tokens: { getToken: async () => "ghs_fake" }, fetch: github.fetch, maxRequests: 50 }));
    await expect(syncAll(d)).rejects.toThrow("요청 상한(50번)");
    expect(github.calls.length).toBeLessThanOrEqual(50);
  });
});

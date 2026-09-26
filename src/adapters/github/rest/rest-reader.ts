/**
 * GitHub REST API 를 GET 으로만 부르는 읽기 어댑터 (개인 토큰 · fine-grained 토큰 경로, 결정 12).
 *
 * 읽을 저장소는 두 가지로 정한다. 둘 다 쓸 수 있고, 둘 다 없으면 조립부가 설정 오류로 막는다.
 *   - orgs: 조직 이름. 동기화할 때마다 GET /orgs/{org}/repos 를 페이지 끝까지 읽어, 조직에 새로 생긴 저장소도 들어온다.
 *   - repos: owner/name 목록. 저장소마다 GET /repos/{owner}/{name} 으로 다시 찾는다.
 *   같은 저장소(숫자 ID 같음)가 두 목록에 다 있으면 한 번만 읽는다.
 *
 * 읽는 범위의 상한 — 화면에도 한 문장으로 표시된다(limitNote). 조용히 자르지 않기 위해서다.
 *   - PR: 저장소마다 최근에 수정된 순으로 PULLS_PER_REPO(50)개까지. 그보다 오래된 PR 은 읽지 않는다.
 *   - 검사 결과: 커밋마다 check run CHECK_RUNS_PER_COMMIT(100)개까지. 옛 방식의 commit status API 는 읽지 않는다.
 *   - 리뷰: PR 마다 REVIEWS_PER_PR(100)개까지.
 *   - 한 번의 동기화에서 실제로 나가는 요청은 요청 예산(기본 MAX_REQUESTS_PER_SYNC)까지. 다른 출처와 함께 읽으면 예산을 나눠 쓴다.
 *   - 조직 저장소 목록의 다음 페이지(Link)와 리디렉션은 같은 경로로만 따라간다.
 *
 * 한 번 동기화할 때 저장소마다 요청 수는 1(저장소, repos 로 적은 것만) + 1(PR 목록) + 2 × PR 수(검사 · 리뷰) 다.
 */
import type { ChecksState, GitHubReviewState, PrSnapshot, PrState, Repository } from "../../../domain/model";
import type { GitHubReader, ReaderRun, RequestBudget } from "../../../ports/github-reader";
import {
  createGuardedGet,
  createRequestMeter,
  type FetchLike,
  GITHUB_API_ORIGIN,
  GitHubReadError,
  MAX_REQUESTS_PER_SYNC,
} from "./guarded-get";

export const PULLS_PER_REPO = 50;
export const CHECK_RUNS_PER_COMMIT = 100;
export const REVIEWS_PER_PR = 100;
export const ORG_REPOS_PAGE_SIZE = 100;

export interface RestReaderOptions {
  readonly token: string;
  /**
   * 읽을 저장소 목록 (owner/name). 동기화할 때마다 이 이름으로 저장소를 다시 찾는다(GET /repos/owner/name).
   * 찾은 뒤의 PR 요청에는 GitHub 가 돌려준 현재 이름을 쓰고, PR 의 동일성은 GitHub 가 돌려준 숫자 ID 로 판단한다.
   * 이름이 바뀐 저장소는 GitHub 의 리디렉션을 관문을 다시 거쳐 따라가 찾는다.
   */
  readonly repos: readonly string[];
  /** 저장소를 모두 읽을 조직 이름들 (GET /orgs/{org}/repos). 조직에 새로 생긴 저장소도 다음 동기화에 들어온다 */
  readonly orgs?: readonly string[];
  readonly fetch: FetchLike;
  /** 이 리더만 읽을 때의 요청 상한. 다른 출처와 예산을 나눠 쓸 때는 startRun 에 넘긴 예산이 이긴다 */
  readonly maxRequests?: number;
}

export function createGitHubRestReader(options: RestReaderOptions): GitHubReader {
  const maxRequests = options.maxRequests ?? MAX_REQUESTS_PER_SYNC;
  const orgs = options.orgs ?? [];
  const api = (path: string) => `${GITHUB_API_ORIGIN}${path}`;

  function startRun(budget?: RequestBudget): ReaderRun {
    const meter = budget ?? createRequestMeter(maxRequests);
    const get = createGuardedGet({ token: options.token, fetch: options.fetch, meter });

    /** 조직 저장소 목록을 페이지 끝까지 읽는다. 다음 페이지와 리디렉션은 첫 주소와 같은 경로로만 따라간다. */
    async function orgRepositories(org: string): Promise<Repository[]> {
      const path = `/orgs/${encodeURIComponent(org)}/repos`;
      const samePath = (target: URL) => target.pathname === path;
      const out: Repository[] = [];
      let next: string | null = api(`${path}?type=all&sort=full_name&per_page=${ORG_REPOS_PAGE_SIZE}`);
      while (next !== null) {
        const page = await get.page(next, { allowRedirect: samePath });
        for (const raw of asArray(page.json, `조직(${org}) 저장소 목록`)) out.push(parseRepository(raw, org));
        next = page.next;
        if (next !== null && !samePath(new URL(next))) {
          throw new GitHubReadError(`다음 페이지 주소가 다른 경로를 가리켜 따라가지 않는다 (${path})`);
        }
      }
      return out;
    }

    return {
      notes: () => [],

      async listRepositories() {
        const out: Repository[] = [];
        const seen = new Set<number>();
        const add = (repository: Repository) => {
          if (seen.has(repository.id)) return;
          seen.add(repository.id);
          out.push(repository);
        };
        for (const org of orgs) for (const repository of await orgRepositories(org)) add(repository);
        for (const fullName of options.repos) add(parseRepository(await get(api(`/repos/${repoPath(fullName)}`)), fullName));
        return out;
      },

      async listPullRequests(repository) {
        const base = `/repos/${repoPath(repository.fullName)}`;
        const pulls = asArray(
          await get(api(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=${PULLS_PER_REPO}`)),
          "PR 목록",
        );
        const out: PrSnapshot[] = [];
        for (const raw of pulls) {
          const pull = parsePull(raw);
          const checks = await get(api(`${base}/commits/${pull.headSha}/check-runs?per_page=${CHECK_RUNS_PER_COMMIT}`));
          const reviews = await get(api(`${base}/pulls/${pull.number}/reviews?per_page=${REVIEWS_PER_PR}`));
          out.push({
            repoId: repository.id,
            number: pull.number,
            title: pull.title,
            body: pull.body,
            branch: pull.branch,
            headRepoId: pull.headRepoId,
            headSha: pull.headSha,
            url: pull.url,
            author: pull.author,
            state: pull.state,
            updatedAt: pull.updatedAt,
            checks: summarizeChecks(checks),
            review: summarizeReviews(reviews),
          });
        }
        return out;
      },
    };
  }

  return {
    source: "github",
    limitNote: `저장소마다 최근 수정된 PR ${PULLS_PER_REPO}개까지 읽는다.`,
    startRun,
    // 실행 없이 바로 부르면 그때마다 새 실행으로 읽는다(동기화는 startRun 을 쓴다)
    listRepositories: () => startRun().listRepositories(),
    listPullRequests: (repository) => startRun().listPullRequests(repository),
  };
}

/** "owner/name" 을 주소 경로 조각으로. 두 부분이 아니면 요청하지 않는다. */
export function repoPath(fullName: string): string {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((p) => p.trim() === "")) {
    throw new GitHubReadError(`저장소 이름은 owner/name 형식이어야 한다: "${fullName}"`);
  }
  return parts.map((p) => encodeURIComponent(p.trim())).join("/");
}

// ── GitHub 응답 → 도메인 값 ───────────────────────────────────────────────

type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function asArray(value: unknown, what: string): unknown[] {
  if (!Array.isArray(value)) throw new GitHubReadError(`GitHub 응답의 ${what} 모양이 예상과 다르다`);
  return value;
}

function field<T>(obj: Json, key: string, check: (v: unknown) => v is T, what: string): T {
  const value = obj[key];
  if (!check(value)) throw new GitHubReadError(`GitHub 응답의 ${what}.${key} 모양이 예상과 다르다`);
  return value;
}

export const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);
const isString = (v: unknown): v is string => typeof v === "string";
/** 커밋 SHA 는 주소 경로에 들어가므로 16진수 40자만 받는다. */
const isSha = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{40}$/.test(v);

function parseRepository(json: unknown, requested: string): Repository {
  if (!isObject(json)) throw new GitHubReadError(`GitHub 응답의 저장소(${requested}) 모양이 예상과 다르다`);
  return { id: field(json, "id", isNumber, "repository"), fullName: field(json, "full_name", isString, "repository") };
}

export function parsePull(raw: unknown) {
  if (!isObject(raw)) throw new GitHubReadError("GitHub 응답의 PR 모양이 예상과 다르다");
  const head = field(raw, "head", isObject, "pull");
  const user = raw["user"];
  const state: PrState =
    raw["merged_at"] !== null && raw["merged_at"] !== undefined
      ? "merged"
      : field(raw, "state", isString, "pull") === "open"
        ? "open"
        : "closed";
  return {
    number: field(raw, "number", isNumber, "pull"),
    title: field(raw, "title", isString, "pull"),
    body: isString(raw["body"]) ? raw["body"] : "",
    branch: field(head, "ref", isString, "pull.head"),
    // 브랜치가 있는 저장소. 복제본이 지워졌으면 GitHub 가 head.repo 를 null 로 준다 — 그때는 알 수 없음(null)
    headRepoId: isObject(head["repo"]) && isNumber(head["repo"]["id"]) ? head["repo"]["id"] : null,
    headSha: field(head, "sha", isSha, "pull.head"),
    url: field(raw, "html_url", isString, "pull"),
    author: isObject(user) && isString(user["login"]) ? user["login"] : "",
    updatedAt: field(raw, "updated_at", isString, "pull"),
    state,
  };
}

const FAILING_CONCLUSIONS = new Set(["failure", "timed_out", "cancelled", "action_required", "startup_failure"]);

/** 검사 결과 요약. 하나라도 실패면 failing, 아니고 하나라도 진행 중이면 pending, 모두 끝났으면 passing, 없으면 none. */
export function summarizeChecks(json: unknown): ChecksState {
  if (!isObject(json)) throw new GitHubReadError("GitHub 응답의 check-runs 모양이 예상과 다르다");
  const runs = asArray(json["check_runs"], "check_runs").filter(isObject);
  if (runs.length === 0) return "none";
  if (runs.some((r) => FAILING_CONCLUSIONS.has(String(r["conclusion"])))) return "failing";
  if (runs.some((r) => r["status"] !== "completed")) return "pending";
  return "passing";
}

/** GitHub 리뷰 요약. 리뷰어마다 마지막 승인·변경 요청만 센다(COMMENTED 는 상태를 바꾸지 않는다). */
export function summarizeReviews(json: unknown): GitHubReviewState {
  const latestByReviewer = new Map<string, string>();
  for (const review of asArray(json, "reviews").filter(isObject)) {
    const state = String(review["state"]);
    const user = review["user"];
    const login = isObject(user) && isString(user["login"]) ? user["login"] : "";
    if (state === "APPROVED" || state === "CHANGES_REQUESTED" || state === "DISMISSED") latestByReviewer.set(login, state);
  }
  const states = [...latestByReviewer.values()];
  if (states.includes("CHANGES_REQUESTED")) return "changes_requested";
  if (states.includes("APPROVED")) return "approved";
  return "none";
}

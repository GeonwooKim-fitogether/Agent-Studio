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
 *   - 응답 PR 의 base.repo.id 가 요청한 저장소가 아니면(또는 없으면) 그 PR 은 버리고 알린다.
 *   - PR 목록은 한 페이지만 읽고, 리디렉션은 같은 저장소의 /pulls 경로로만 따라간다.
 *
 * 한 번 동기화할 때 저장소마다 요청 수는 1(저장소, repos 로 적은 것만) + 1(PR 목록) + 2 × PR 수(검사 · 리뷰) 다.
 * 저장소마다의 PR 목록은 부른 순서대로 하나씩(createTurns), PR 마다의 검사 · 리뷰 요청은 겹쳐 보낸다. 동시에 나가는 요청은 요청 예산의 동시 상한(MAX_CONCURRENT_REQUESTS) 안이고,
 * 요청 하나가 실패하면 이 출처의 나머지 요청은 보내지 않는다(halt).
 */
import type { ChecksState, GitHubReviewState, PrSnapshot, PrState, Repository } from "../../../domain/model";
import type { GitHubReader, ReaderRun, RequestBudget } from "../../../ports/github-reader";
import {
  createGuardedGet,
  createRequestMeter,
  type FetchLike,
  GITHUB_API_ORIGIN,
  GitHubReadError,
  type HaltSwitch,
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
    const halt: HaltSwitch = { halted: false };
    const get = createGuardedGet({ token: options.token, fetch: options.fetch, meter, halt });
    const listTurn = createTurns();

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

    const notes: string[] = [];

    return {
      notes: () => notes,

      listRepositories: () => halting(halt, async () => {
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
      }),

      listPullRequests: (repository) => halting(halt, async () => {
        const base = `/repos/${repoPath(repository.fullName)}`;
        // PR 목록은 한 페이지(최근 PULLS_PER_REPO 개)만 읽는다. 다음 페이지(Link)는 따라가지 않고,
        // 리디렉션은 같은 저장소의 /pulls 경로로만 따라간다(App 리더와 같은 규칙).
        const page = await listTurn(() =>
          get.page(api(`${base}/pulls?state=all&sort=updated&direction=desc&per_page=${PULLS_PER_REPO}`), {
            allowRedirect: (target) => target.pathname === `${base}/pulls`,
          }),
        );
        const pulls = asArray(page.json, "PR 목록");
        return snapshotsOf(get, base, repository, pulls, notes);
      }),
    };
  }

  return {
    source: "github",
    limitNote: `저장소마다 최근 수정된 PR ${PULLS_PER_REPO}개까지 읽는다.`,
    startRun,
    readPullRequestHead: (repository, number) =>
      readHead(
        createGuardedGet({ token: options.token, fetch: options.fetch, meter: createRequestMeter(HEAD_READ_REQUESTS), halt: { halted: false } }),
        repository,
        number,
      ),
    // 실행 없이 바로 부르면 그때마다 새 실행으로 읽는다(동기화는 startRun 을 쓴다)
    listRepositories: () => startRun().listRepositories(),
    listPullRequests: (repository) => startRun().listPullRequests(repository),
  };
}

/** PR 하나의 최신 커밋을 읽을 때 쓰는 요청 상한 (GET 하나에 리디렉션 · 401 재시도 · 토큰 교환이 붙을 수 있다) */
export const HEAD_READ_REQUESTS = 5;

/**
 * PR 하나의 지금 최신 커밋 SHA (GET /repos/{owner}/{name}/pulls/{number}, 결정 18). 내부 검토 결정을 저장하기 직전에만 쓴다.
 * 리디렉션은 같은 PR 경로로만 따라가고, 응답 PR 의 base.repo.id 가 요청한 저장소가 아니면 받아들이지 않는다.
 */
export async function readHead(get: ReturnType<typeof createGuardedGet>, repository: Repository, number: number): Promise<string> {
  const path = `/repos/${repoPath(repository.fullName)}/pulls/${number}`;
  const page = await get.page(`${GITHUB_API_ORIGIN}${path}`, { allowRedirect: (target) => target.pathname.endsWith(`/pulls/${number}`) });
  if (baseRepoId(page.json) !== repository.id) throw new GitHubReadError(`${repository.fullName}#${number} 의 응답이 요청한 저장소의 PR 이 아니다`);
  return parsePull(page.json).headSha;
}

/** 리더 실행의 일 하나. 실패하면(응답 모양 오류 포함) 이 출처의 나머지 요청을 보내지 않게 표시하고 그대로 던진다 */
export async function halting<T>(halt: HaltSwitch, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    halt.halted = true;
    throw error;
  }
}

/**
 * 부른 순서대로 하나씩 도는 차례. 저장소마다의 PR **목록** 요청을 이 차례로 보낸다 — 앞 저장소의 목록이 온 뒤에 다음 저장소의
 * 목록을 부르므로, 목록이 실패하면(예: 조직이 토큰을 막았다) 같은 출처의 다음 저장소는 부르지 않는다. PR 마다의 검사 · 리뷰는
 * 차례 밖에서 겹쳐 보내, 다음 저장소의 목록 요청과도 겹친다.
 */
export function createTurns(): <T>(task: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const mine = last.then(task, task);
    last = mine.catch(() => undefined);
    return mine;
  };
}

type GuardedGet = ReturnType<typeof createGuardedGet>;

/**
 * PR 목록의 원본들을 스냅샷으로. 요청한 저장소의 것이 아닌 PR 은 버리고 알린다.
 * PR 마다 검사 결과와 리뷰를 겹쳐 받는다(동시 상한은 관문이 지킨다). 결과의 순서는 GitHub 가 준 PR 순서 그대로다.
 */
export async function snapshotsOf(
  get: GuardedGet,
  base: string,
  repository: Repository,
  pulls: readonly unknown[],
  notes: string[],
): Promise<PrSnapshot[]> {
  const api = (path: string) => `${GITHUB_API_ORIGIN}${path}`;
  const mine: unknown[] = [];
  const foreign: number[] = [];
  for (const raw of pulls) {
    // 이 PR 이 정말 요청한 저장소의 것인가 — 아니면(또는 알 수 없으면) 받아 적지 않는다
    if (baseRepoId(raw) !== repository.id) foreign.push(isObject(raw) && isNumber(raw["number"]) ? raw["number"] : 0);
    else mine.push(raw);
  }
  if (foreign.length > 0) {
    notes.push(`${repository.fullName} 에 요청했는데 다른 저장소의 것으로 보이는 PR ${foreign.length}개를 버렸다: #${foreign.join(", #")}`);
  }
  const parsed = mine.map(parsePull); // 모양이 틀린 PR 이 있으면 검사 · 리뷰 요청을 보내기 전에 멈춘다
  return Promise.all(
    parsed.map(async (pull): Promise<PrSnapshot> => {
      const [checks, reviews] = await Promise.all([
        get(api(`${base}/commits/${pull.headSha}/check-runs?per_page=${CHECK_RUNS_PER_COMMIT}`)),
        get(api(`${base}/pulls/${pull.number}/reviews?per_page=${REVIEWS_PER_PR}`)),
      ]);
      return {
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
      };
    }),
  );
}

/** "owner/name" 을 주소 경로 조각으로. 두 부분이 아니면 요청하지 않는다. */
export function repoPath(fullName: string): string {
  const parts = fullName.split("/");
  if (parts.length !== 2 || parts.some((p) => p.trim() === "")) {
    // 값은 싣지 않는다 — 잘못 붙여 넣은 토큰일 수 있다
    throw new GitHubReadError("저장소 이름이 owner/name 형식이 아니라 요청하지 않는다.");
  }
  return parts.map((p) => encodeURIComponent(p.trim())).join("/");
}

// ── GitHub 응답 → 도메인 값 ───────────────────────────────────────────────

type Json = Record<string, unknown>;

export function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 응답 PR 의 base.repo.id (PR 이 속한 저장소). 없거나 숫자가 아니면 undefined */
export function baseRepoId(raw: unknown): unknown {
  const baseRepo = isObject(raw) && isObject(raw["base"]) ? raw["base"]["repo"] : undefined;
  return isObject(baseRepo) ? baseRepo["id"] : undefined;
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

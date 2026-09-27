/**
 * GitHub App 데이터 리더 — 설치 토큰으로 설치된 저장소들의 PR 을 GET 으로만 읽는다 (결정 11).
 *
 * 이 파일에는 POST 를 보내는 길이 없고, fetch 를 직접 부르지도 않는다. 모든 요청은 guarded-get(GET 전용 관문)을 지나고,
 * 토큰은 인증 모듈(app-auth)의 공급자에게서 받을 뿐이다. 401 을 받으면 관문이 토큰을 한 번만 새로 받아 다시 시도한다.
 *
 * 동기화 1회마다 startRun() 으로 새 "실행" 을 만든다. 요청 계수기와 알림은 그 실행에만 있으므로,
 * 동기화가 겹쳐도 서로의 상한과 알림을 초기화하지 않는다.
 *
 * 읽는 범위와 상한 — 화면 위쪽 띠에도 같은 문장으로 보인다(limitNote).
 *   - 저장소: 설치된 저장소 전부(페이지 넘김). GITHUB_REPOS 가 있으면 그중 적힌 것만.
 *   - PR: 저장소마다 **열린 PR 전부**(페이지 넘김) + **닫히거나 병합된 PR 은 최근 수정된 CLOSED_PER_REPO(30)개**.
 *   - 검사 결과: 커밋마다 check run 100개까지. 리뷰: PR 마다 100개까지.
 *   - 한 번의 동기화에서 **실제로 나가는 요청**(리디렉션 · 401 재시도 · 토큰 교환 포함)은 MAX_REQUESTS_PER_SYNC(1500)번까지.
 *     넘으면 그 자리에서 멈추고 오류로 알린다(조용히 일부만 읽고 성공처럼 보이지 않게).
 *   - 다음 페이지(Link)는 같은 경로로만, 리디렉션은 같은 저장소의 같은 종류 경로로만 따라간다.
 *   - 응답 PR 의 base.repo.id 가 요청한 저장소가 아니면 그 PR 은 버리고 알린다.
 */
import type { PrSnapshot, Repository } from "../../../domain/model";
import type { GitHubReader, ReaderRun, RequestBudget } from "../../../ports/github-reader";
import {
  createGuardedGet,
  createRequestMeter,
  type FetchLike,
  GITHUB_API_ORIGIN,
  GitHubReadError,
  MAX_REQUESTS_PER_SYNC,
  type TokenProvider,
} from "../rest/guarded-get";
import { asArray, baseRepoId, isNumber, isObject, parsePull, repoPath, summarizeChecks, summarizeReviews } from "../rest/rest-reader";

export const CLOSED_PER_REPO = 30;
export const PAGE_SIZE = 100;
export { MAX_REQUESTS_PER_SYNC };

export interface AppReaderOptions {
  readonly tokens: TokenProvider;
  readonly fetch: FetchLike;
  /** 읽을 저장소를 좁히는 목록(owner/name). 비어 있으면 설치된 저장소 전부 */
  readonly onlyRepos?: readonly string[];
  readonly maxRequests?: number;
}

export function createGitHubAppReader(options: AppReaderOptions): GitHubReader {
  const maxRequests = options.maxRequests ?? MAX_REQUESTS_PER_SYNC;
  const only = new Set((options.onlyRepos ?? []).map((r) => r.trim().toLowerCase()).filter((r) => r !== ""));
  const api = (path: string) => `${GITHUB_API_ORIGIN}${path}`;

  /** budget 을 넘기면(여러 출처를 함께 읽을 때) 그 예산을 나눠 쓰고, 없으면 이번 실행만의 예산을 만든다 */
  function startRun(budget?: RequestBudget): ReaderRun {
    const meter = budget ?? createRequestMeter(maxRequests);
    const get = createGuardedGet({ tokens: options.tokens, fetch: options.fetch, meter });
    const notes: string[] = [];

    /** 페이지를 끝까지 따라가며 모은다. 다음 페이지와 리디렉션은 첫 주소와 같은 경로로만 따라간다. */
    async function all(url: string, pick: (json: unknown) => unknown[]): Promise<unknown[]> {
      const path = new URL(url).pathname;
      const samePath = (target: URL) => target.pathname === path;
      const out: unknown[] = [];
      let next: string | null = url;
      while (next !== null) {
        const page = await get.page(next, { allowRedirect: samePath });
        out.push(...pick(page.json));
        next = page.next;
        if (next !== null && !samePath(new URL(next))) {
          throw new GitHubReadError(`다음 페이지 주소가 다른 경로를 가리켜 따라가지 않는다 (${path})`);
        }
      }
      return out;
    }

    return {
      notes: () => notes,

      async listRepositories() {
        const raw = await all(api(`/installation/repositories?per_page=${PAGE_SIZE}`), (json) =>
          asArray(isObject(json) ? json["repositories"] : undefined, "설치된 저장소 목록"),
        );
        const installed: Repository[] = raw.flatMap((r) =>
          isObject(r) && isNumber(r["id"]) && typeof r["full_name"] === "string" ? [{ id: r["id"], fullName: r["full_name"] }] : [],
        );
        if (only.size === 0) return installed;
        const picked = installed.filter((r) => only.has(r.fullName.toLowerCase()));
        const missing = [...only].filter((name) => !installed.some((r) => r.fullName.toLowerCase() === name));
        if (missing.length > 0) notes.push(`GITHUB_REPOS 에 적었지만 App 이 설치되지 않은 저장소: ${missing.join(", ")}`);
        return picked;
      },

      async listPullRequests(repository) {
        const base = `/repos/${repoPath(repository.fullName)}`;
        const open = await all(api(`${base}/pulls?state=open&sort=created&direction=desc&per_page=${PAGE_SIZE}`), (json) =>
          asArray(json, "PR 목록"),
        );
        const closed = asArray(
          (await get.page(api(`${base}/pulls?state=closed&sort=updated&direction=desc&per_page=${CLOSED_PER_REPO}`), {
            allowRedirect: (t) => t.pathname === `${base}/pulls`,
          })).json,
          "PR 목록",
        );
        const out: PrSnapshot[] = [];
        const foreign: number[] = [];
        for (const raw of [...open, ...closed]) {
          // 이 PR 이 정말 요청한 저장소의 것인가 — 아니면(또는 알 수 없으면) 받아 적지 않는다
          if (baseRepoId(raw) !== repository.id) {
            foreign.push(isObject(raw) && isNumber(raw["number"]) ? raw["number"] : 0);
            continue;
          }
          const pull = parsePull(raw);
          const checks = await get(api(`${base}/commits/${pull.headSha}/check-runs?per_page=100`));
          const reviews = await get(api(`${base}/pulls/${pull.number}/reviews?per_page=100`));
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
        if (foreign.length > 0) {
          notes.push(`${repository.fullName} 에 요청했는데 다른 저장소의 것으로 보이는 PR ${foreign.length}개를 버렸다: #${foreign.join(", #")}`);
        }
        return out;
      },
    };
  }

  return {
    source: "github_app",
    limitNote: `열린 PR 은 전부, 닫히거나 병합된 PR 은 저장소마다 최근 ${CLOSED_PER_REPO}개까지 읽는다. 한 번의 Sync 에 요청은 ${maxRequests}번까지.`,
    startRun,
    // 실행 없이 바로 부르면 그때마다 새 실행으로 읽는다(동기화는 startRun 을 쓴다)
    listRepositories: () => startRun().listRepositories(),
    listPullRequests: (repository) => startRun().listPullRequests(repository),
  };
}

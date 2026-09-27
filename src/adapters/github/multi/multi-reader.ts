/**
 * 여러 GitHub 출처를 함께 읽는 합성 리더 (결정 12).
 *
 * 개인 계정 저장소는 GitHub App 으로, 사용자가 Owner 가 아닌 조직의 저장소는 사용자 본인의 토큰으로 읽고,
 * 한 번의 Sync 에 합친다. 이 파일은 요청을 직접 보내지 않는다 — 기존 리더(app-reader · rest-reader)에게 맡길 뿐이다.
 *
 * 합치는 규칙
 *   1. 저장소 중복: 같은 저장소(숫자 ID 같음)가 여러 출처에서 오면 **앞의 출처**(조립부가 App 을 앞에 둔다)의 것만 받아 적는다.
 *      그 저장소의 PR 도 그 출처로만 읽는다. 식별은 숫자 ID 뿐이다(이름으로 같다고 보지 않는다).
 *   2. 출처별 실패 분리: 한 출처가 실패해도(토큰 만료 401, 조직 승인 대기 403 등) 다른 출처의 결과는 받아 적는다.
 *      실패한 출처는 이번 Sync 에서 더 부르지 않고, 화면 띠에 출처별 상태로 보인다(sources()).
 *      모든 출처가 저장소 목록부터 실패하면 Sync 전체를 실패로 알린다(성공처럼 보이지 않게).
 *   3. 요청 상한: 요청 예산 하나를 만들어 모든 출처에 넘긴다. 상한은 Sync 1회 전체 기준이고 실제 fetch 수로 센다.
 *
 * 화면에 보이는 실패 이유에는 우리가 만든 오류 문장만 싣는다. 그 문장들에는 토큰 · 키 · JWT 가 없다(guarded-get · app-auth).
 * 알 수 없는 종류의 오류는 문장을 싣지 않고 "알 수 없는 오류" 로만 보인다.
 */
import type { PrSnapshot, Repository } from "../../../domain/model";
import type { GitHubReader, ReaderRun, SourceReport } from "../../../ports/github-reader";
import { GitHubAuthError, GitHubAuthRequestBlockedError } from "../app-auth/app-auth";
import { createRequestMeter, GitHubReadError, GitHubRequestBlockedError, MAX_REQUESTS_PER_SYNC } from "../rest/guarded-get";

export interface ReaderSource {
  /** 화면에 보이는 출처 이름 (예: "GitHub App", "Token (fitogether-org)") */
  readonly label: string;
  readonly reader: GitHubReader;
}

export interface MultiReaderOptions {
  readonly maxRequests?: number;
}

interface SourceState {
  readonly label: string;
  readonly run: ReaderRun;
  repositories: number;
  pullRequests: number;
  error: string | null;
}

export function createMultiReader(sources: readonly ReaderSource[], options: MultiReaderOptions = {}): GitHubReader {
  const maxRequests = options.maxRequests ?? MAX_REQUESTS_PER_SYNC;

  function startRun(): ReaderRun {
    // 한 예산을 모든 출처가 나눠 쓴다
    const budget = createRequestMeter(maxRequests);
    const states: SourceState[] = sources.map(({ label, reader }) => ({
      label,
      run: reader.startRun?.(budget) ?? {
        listRepositories: () => reader.listRepositories(),
        listPullRequests: (repository) => reader.listPullRequests(repository),
        notes: () => [],
      },
      repositories: 0,
      pullRequests: 0,
      error: null,
    }));
    /** 저장소 숫자 ID → 그 저장소를 맡은 출처 */
    const owner = new Map<number, SourceState>();
    let duplicates = 0;

    return {
      async listRepositories() {
        const out: Repository[] = [];
        for (const state of states) {
          let repositories: Repository[];
          try {
            repositories = await state.run.listRepositories();
          } catch (error) {
            state.error = describeFailure(error);
            continue;
          }
          for (const repository of repositories) {
            if (owner.has(repository.id)) {
              duplicates += 1;
              continue;
            }
            owner.set(repository.id, state);
            state.repositories += 1;
            out.push(repository);
          }
        }
        if (states.length > 0 && states.every((s) => s.error !== null)) {
          throw new GitHubReadError(`모든 GitHub 출처가 실패했다 — ${states.map((s) => `${s.label}: ${s.error}`).join(" / ")}`);
        }
        return out;
      },

      async listPullRequests(repository): Promise<PrSnapshot[]> {
        const state = owner.get(repository.id);
        if (state === undefined || state.error !== null) return [];
        try {
          const pulls = await state.run.listPullRequests(repository);
          state.pullRequests += pulls.length;
          return pulls;
        } catch (error) {
          // 이 출처는 이번 Sync 에서 더 부르지 않는다. 다른 출처의 저장소는 계속 읽는다.
          state.error = describeFailure(error);
          return [];
        }
      },

      notes() {
        const notes = states.flatMap((s) => s.run.notes().map((note) => `${s.label}: ${note}`));
        if (duplicates > 0) notes.push(`두 출처에 모두 있는 저장소 ${duplicates}개는 ${states[0]?.label ?? "앞 출처"} 로 한 번만 읽었다`);
        return notes;
      },

      sources: (): SourceReport[] =>
        states.map((s) => ({ label: s.label, repositories: s.repositories, pullRequests: s.pullRequests, error: s.error })),
    };
  }

  return {
    source: "github_combined",
    limitNote: `${sources.map((s) => `${s.label}: ${s.reader.limitNote ?? "상한 없음"}`).join(" / ")} 두 출처를 합쳐 한 번의 Sync 에 요청은 ${maxRequests}번까지.`,
    startRun,
    listRepositories: () => startRun().listRepositories(),
    listPullRequests: (repository) => startRun().listPullRequests(repository),
  };
}

/** 실패 이유를 사람이 읽는 문장으로. 우리가 만든 오류 종류만 문장을 싣는다(토큰 · 키가 들어 있지 않은 문장들). */
export function describeFailure(error: unknown): string {
  if (error instanceof GitHubReadError) {
    if (error.status === 401) return `인증이 거절됐다 — 토큰이 만료됐거나 취소됐다 (${error.message})`;
    if (error.status === 403) return `접근이 막혔다 — 권한이 모자라거나, 조직이 이 토큰을 아직 승인하지 않았다(Pending) (${error.message})`;
    return error.message;
  }
  if (error instanceof GitHubRequestBlockedError || error instanceof GitHubAuthError || error instanceof GitHubAuthRequestBlockedError) {
    return error.message;
  }
  return "알 수 없는 오류";
}

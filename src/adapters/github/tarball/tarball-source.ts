/**
 * GitHub 에서 커밋 하나의 코드를 tarball 로 받는다 (docs/plan/04-remote-preview.md §5).
 *
 * `GET https://api.github.com/repos/{owner}/{repo}/tarball/{전체 SHA}` 한 번을 GET 관문(guarded-get)으로 보낸다.
 * git 을 쓰지 않는 이유: git 의 HTTPS 받기는 POST(git-upload-pack)를 보내 "GitHub 에는 GET 만" 경계를 흐리고,
 * 토큰을 자식 프로세스(git)에 넘겨야 한다. 여기서는 토큰이 Studio 프로세스 안의 Authorization 헤더에만 있다.
 *
 * 토큰 공급자가 여럿이면(App 과 조직 토큰, 결정 12) 앞의 것부터 쓰고, 403 · 404 로 거절되면 다음 것으로 한 번 더 받는다.
 */
import { isFullSha, isSafeRepoFullName } from "../../../domain/preview";
import { type CodeSource, CodeSourceError, MAX_ARCHIVE_BYTES } from "../../preview/local/code-source";
import { createGuardedGet, type FetchLike, GITHUB_API_ORIGIN, GitHubReadError, type TokenProvider } from "../rest/guarded-get";

export interface TarballSourceOptions {
  readonly tokens: readonly TokenProvider[];
  readonly fetch: FetchLike;
  readonly maxBytes?: number;
  /** 코드 묶음 하나를 받는 전체 시간 상한 (기본 5분) */
  readonly timeoutMs?: number;
}

export const DEFAULT_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

export function createGitHubTarballSource(options: TarballSourceOptions): CodeSource {
  const maxBytes = options.maxBytes ?? MAX_ARCHIVE_BYTES;
  const timeoutMs = options.timeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
  return {
    label: "GitHub",
    async archive(target, archiveOptions = {}) {
      if (!isFullSha(target.commitSha) || !isSafeRepoFullName(target.repoFullName)) {
        throw new CodeSourceError("받을 커밋이나 저장소 이름이 올바른 모양이 아니다.");
      }
      const [owner = "", name = ""] = target.repoFullName.split("/");
      const url = `${GITHUB_API_ORIGIN}/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/tarball/${target.commitSha}`;
      let lastStatus: number | undefined;
      for (const tokens of options.tokens) {
        try {
          const bytes = await createGuardedGet({ tokens, fetch: options.fetch }).download(url, { maxBytes, timeoutMs, signal: archiveOptions.signal });
          return { bytes, gzip: true, stripComponents: 1 };
        } catch (error) {
          if (error instanceof GitHubReadError && (error.status === 403 || error.status === 404)) {
            lastStatus = error.status;
            continue; // 이 출처로는 이 저장소를 못 읽는다 — 다음 출처로
          }
          throw new CodeSourceError(error instanceof Error ? `GitHub 에서 코드를 받지 못했다: ${error.message}` : "GitHub 에서 코드를 받지 못했다.");
        }
      }
      throw new CodeSourceError(
        `GitHub 에서 코드를 받지 못했다${lastStatus === undefined ? "" : `(${lastStatus})`} — 읽기 권한(Contents)이 이 저장소에 있는지 확인한다.`,
      );
    },
  };
}

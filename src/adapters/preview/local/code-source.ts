/**
 * 코드 받기 — 미리보기 실행기가 커밋 하나의 코드를 tar 묶음으로 받는 약속 (docs/plan/04-remote-preview.md §5).
 *
 * 실행기는 이 묶음을 새 격리 폴더에 풀 뿐, 어디서 받았는지 모른다. 구현은 둘이다.
 *   - GitHub: REST 의 tarball GET (src/adapters/github/tarball/tarball-source.ts). 토큰은 Studio 프로세스 안의 헤더에만 있다.
 *   - 로컬 git 저장소: `git archive <전체 SHA>` (./local-repo-source.ts). 시연 · 시험용이며 네트워크를 쓰지 않는다.
 */
import type { PreviewTarget } from "../../../domain/preview";

export interface CodeArchive {
  readonly bytes: Uint8Array;
  readonly gzip: boolean;
  /** 풀 때 벗길 맨 위 폴더 수 (GitHub tarball 은 `owner-repo-sha/` 한 겹을 씌운다) */
  readonly stripComponents: number;
}

export interface CodeSource {
  /** 화면 위쪽 띠에 보일 짧은 이름 (예: "GitHub", "local repositories") */
  readonly label: string;
  /** signal 이 취소되면(미리보기를 끄거나 다른 것을 열었을 때) 받기를 멈추고 거절한다 */
  archive(target: PreviewTarget, options?: { readonly signal?: AbortSignal }): Promise<CodeArchive>;
}

/** 코드를 받지 못했을 때의 오류. 메시지는 사람이 읽는 문장이고 토큰 · 경로를 싣지 않는다. */
export class CodeSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodeSourceError";
  }
}

/** 받을 코드 묶음의 크기 상한 */
export const MAX_ARCHIVE_BYTES = 200 * 1024 * 1024;

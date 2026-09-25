import type { GitHubReader } from "../ports/github-reader";
import type { StudioStore } from "../ports/studio-store";

/** 유스케이스가 바깥 세계에서 받는 것 전부. 어느 구현을 넣을지는 src/server/container.ts 한 곳에서 정한다. */
export interface AppDeps {
  readonly reader: GitHubReader;
  readonly store: StudioStore;
  /** 지금 시각. 테스트가 고정할 수 있게 주입한다. */
  readonly now: () => Date;
  /** 새 ID. 업무 ID 로도 쓰이므로 영문 소문자와 숫자만 만든다 (표식이 브랜치 이름에 들어가야 하므로). */
  readonly newId: () => string;
}

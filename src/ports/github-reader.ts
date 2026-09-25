/**
 * GitHub 와의 약속 — 읽기만 한다 (결정 4, 계약 §7-1).
 *
 * 이 인터페이스에는 읽는 메서드만 있다. 브랜치를 만들거나, 병합하거나, PR 을 고치는 메서드가
 * 포트에 없으므로 유스케이스는 GitHub 의 상태를 바꾸는 코드를 구조적으로 쓸 수 없다.
 */
import type { PrSnapshot, Repository } from "../domain/model";

/** 데이터가 어디서 왔나. 화면이 사용자에게 출처를 표시할 때 쓴다. */
/** fixture: 고정 시연 데이터 · github: 개인 토큰(개발용) · github_app: GitHub App 설치 토큰 (결정 11) */
export type DataSource = "fixture" | "github" | "github_app";

export interface GitHubReader {
  readonly source: DataSource;
  /** 읽기 범위의 한계를 사람이 읽는 한 문장으로 (예: 저장소마다 최근 PR 50개까지). 한계가 없으면 undefined. */
  readonly limitNote?: string;
  /** 읽도록 설정된 저장소들의 현재 정보. 이름이 바뀌었으면 새 이름이 온다 (숫자 ID 는 그대로). */
  listRepositories(): Promise<Repository[]>;
  /**
   * 동기화 1회분의 읽기를 시작한다(있으면). 요청 상한 · 알림 같은 "이번 동기화의" 상태는 여기서 만든 객체에만 있다.
   * 그래서 동기화 두 번이 겹쳐도 서로의 상한과 알림을 초기화하지 않는다. 없으면 리더 자신을 그대로 쓴다.
   */
  startRun?(): ReaderRun;
  /** 저장소 하나의 PR 스냅샷 목록. 저장소는 listRepositories() 가 돌려준 값을 그대로 넘긴다. */
  listPullRequests(repository: Repository): Promise<PrSnapshot[]>;
}

/** 동기화 1회분의 읽기. */
export interface ReaderRun {
  listRepositories(): Promise<Repository[]>;
  listPullRequests(repository: Repository): Promise<PrSnapshot[]>;
  /** 이번 동기화에서 사람이 알아야 할 것(예: 설치되지 않은 저장소, 버린 PR) */
  notes(): readonly string[];
}

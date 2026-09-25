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
  /** 마지막 동기화에서 사람이 알아야 할 것(예: 설치되지 않은 저장소). 없으면 빈 목록 */
  readonly lastRunNotes?: () => readonly string[];
  /** 저장소 하나의 PR 스냅샷 목록. 저장소는 listRepositories() 가 돌려준 값을 그대로 넘긴다. */
  listPullRequests(repository: Repository): Promise<PrSnapshot[]>;
}

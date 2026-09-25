/**
 * 저장과의 약속. 이번 단위의 구현은 서버 메모리(src/adapters/store/memory) 하나뿐이고,
 * PostgreSQL 구현은 다음 단위에서 같은 인터페이스로 붙는다. 그래서 지금부터 비동기(Promise)로 둔다.
 *
 * GitHub 에서 받아 적은 것(Repository, PrSnapshot)과 Studio 가 소유한 것(나머지)을 함께 담지만,
 * 받아 적은 것은 동기화(syncAll)만 쓴다.
 *
 * 구현은 저장할 때와 돌려줄 때 모두 복사본을 쓴다. 돌려받은 값을 고쳐도 저장된 값은 바뀌지 않아야 한다.
 */
import type {
  PreviewRecord,
  PrLink,
  PrRef,
  PrSnapshot,
  Project,
  Repository,
  ReviewDecision,
  Work,
} from "../domain/model";

export interface StudioStore {
  listProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<void>;

  listWorks(): Promise<Work[]>;
  getWork(id: string): Promise<Work | undefined>;
  /**
   * 새 업무를 만들고 PR 하나를 그 업무에 연결한다 — 둘 다 되거나 둘 다 안 되는 하나의 연산이다.
   * PR 이 이미 연결돼 있거나 같은 ID 의 업무가 있으면 아무것도 남기지 않고 오류를 낸다.
   * (따로 저장하면 동시 요청에서 연결 없는 빈 업무가 남는다. PostgreSQL 구현은 트랜잭션 하나로 한다.)
   */
  createWorkWithLink(work: Work, link: PrLink): Promise<void>;

  listRepositories(): Promise<Repository[]>;
  saveRepository(repository: Repository): Promise<void>;

  listSnapshots(): Promise<PrSnapshot[]>;
  getSnapshot(ref: PrRef): Promise<PrSnapshot | undefined>;
  saveSnapshot(snapshot: PrSnapshot): Promise<void>;

  listLinks(): Promise<PrLink[]>;
  getLink(ref: PrRef): Promise<PrLink | undefined>;
  /** 새 연결을 더한다. PR 하나에 연결은 하나뿐이므로, 이미 연결된 PR 이면 오류를 낸다. */
  addLink(link: PrLink): Promise<void>;

  listReviewDecisions(): Promise<ReviewDecision[]>;
  addReviewDecision(decision: ReviewDecision): Promise<void>;

  /** 미리보기 실행은 2단계에서 붙으므로 이번 단위에는 읽기만 있다. */
  listPreviewRecords(): Promise<PreviewRecord[]>;
}

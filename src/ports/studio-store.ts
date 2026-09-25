/**
 * 저장과의 약속. 이번 단위의 구현은 서버 메모리(src/adapters/store/memory) 하나뿐이고,
 * PostgreSQL 구현은 다음 단위에서 같은 인터페이스로 붙는다. 그래서 지금부터 비동기(Promise)로 둔다.
 *
 * GitHub 에서 받아 적은 것(Repository, PrSnapshot)과 Studio 가 소유한 것(나머지)을 함께 담지만,
 * 받아 적은 것은 동기화(syncAll)만 쓴다.
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
  saveWork(work: Work): Promise<void>;

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

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
  UnlinkRecord,
  Work,
} from "../domain/model";

/**
 * 서버가 처음 켜질 때 저장소에 심는 처음 상태(시연 데이터 등).
 * GitHub 에서 받아 적는 것(저장소, PR 스냅샷)은 넣지 않는다 — 동기화가 채운다.
 */
export interface StudioSeed {
  readonly projects?: readonly Project[];
  readonly works?: readonly Work[];
  readonly links?: readonly PrLink[];
  readonly reviews?: readonly ReviewDecision[];
  readonly previews?: readonly PreviewRecord[];
  readonly unlinks?: readonly UnlinkRecord[];
}

export interface StudioStore {
  listProjects(): Promise<Project[]>;
  saveProject(project: Project): Promise<void>;

  listWorks(): Promise<Work[]>;
  getWork(id: string): Promise<Work | undefined>;
  /**
   * 새 업무를 만들고 PR 하나를 그 업무에 연결한다 — 둘 다 되거나 둘 다 안 되는 하나의 연산이다.
   * PR 이 이미 연결돼 있거나 같은 ID 의 업무가 있으면 아무것도 남기지 않고 오류를 낸다.
   * 사람의 연결이므로(origin "user"), 그 PR 의 연결 해제 기록이 있으면 같은 연산 안에서 지운다.
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
  /**
   * 새 연결을 더한다. PR 하나에 연결은 하나뿐이므로, 이미 연결된 PR 이면 already_linked 오류를 낸다.
   * - 사람의 연결(origin "user")이면, 그 PR 의 연결 해제 기록을 같은 연산 안에서 지운다(결정 9: 사람이 다시 연결하면 표시가 사라진다).
   * - 표식의 연결(origin "marker")이면, 연결 해제 기록이 있는 PR 에는 unlinked_by_user 오류를 내고 아무것도 쓰지 않는다.
   *   판정(decideLink)이 이미 막지만, 판정과 쓰기 사이에 사람이 연결을 푼 경우까지 저장소가 막는다.
   *   구현은 같은 PR 에 대한 연결 쓰기와 연결 해제를 차례로만 실행해야 한다(메모리: 안에서 await 하지 않음,
   *   PostgreSQL: PR 단위 트랜잭션 잠금). 그래야 "해제 기록 확인 → 쓰기" 사이에 해제가 끼어들지 못한다.
   *
   * 확인 순서와 오류 코드는 구현마다 같아야 한다(저장 계약 시험이 두 구현에 같은 결과를 요구한다):
   *   PR 값이 범위 밖 → invalid_input, 이미 연결됨 → already_linked, 없는 업무 → not_found, 사람이 푼 PR → unlinked_by_user.
   * createWorkWithLink 는: 범위 밖 · 업무 ID 형식 → invalid_input, 이미 연결됨 → already_linked,
   *   없는 프로젝트 → not_found, 사람이 푼 PR → unlinked_by_user, 같은 업무 ID → invalid_input 순서다.
   * saveSnapshot 은 글 속 NUL 문자를 대체 문자로 바꿔 받아 적는다(withoutNul).
   */
  addLink(link: PrLink): Promise<void>;

  /**
   * 연결을 푼다(Unlink). 그 PR 이 바로 그 업무에 연결돼 있을 때만, 연결 삭제와 해제 기록 저장을 하나의 연산으로 한다.
   * 연결이 없거나 다른 업무에 연결돼 있으면 not_linked 오류를 내고 아무것도 바꾸지 않는다.
   */
  unlink(ref: PrRef & { readonly workId: string }, unlinkedAt: string): Promise<void>;
  listUnlinks(): Promise<UnlinkRecord[]>;

  listReviewDecisions(): Promise<ReviewDecision[]>;
  addReviewDecision(decision: ReviewDecision): Promise<void>;

  /** 미리보기 실행은 2단계에서 붙으므로 이번 단위에는 읽기만 있다. */
  listPreviewRecords(): Promise<PreviewRecord[]>;
}

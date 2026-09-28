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
  WorkStatus,
} from "../domain/model";
import type { Memo } from "../domain/memo";
import type { PrEvent } from "../domain/pr-event";
import type { PrFingerprint, StatusChange } from "../domain/work-status";

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
  /** PR 이벤트 (feature-plan F7). 시연 데이터는 넣지 않는다 — 기록은 Studio 가 실제로 읽은 변화에서만 시작한다 */
  readonly events?: readonly PrEvent[];
  /** 메모 (feature-plan F8). 시연 데이터는 넣지 않는다 */
  readonly memos?: readonly Memo[];
}

/**
 * 업무 상태 한 번의 갱신 (feature-plan F3). expected 는 판정할 때 읽은 상태다 — 그사이 다른 요청이 상태를 바꿨으면
 * 아무것도 쓰지 않고 false 를 돌려준다(같은 판정이 두 번 이력을 쌓지 않게). 상태 · 기준점 · 이력은 함께 쓰이거나 함께 안 쓰인다.
 */
export interface WorkStatusUpdate {
  readonly workId: string;
  readonly expected: WorkStatus;
  readonly status: WorkStatus;
  /** R6 의 기준점. 사람이 바꿨으면 그때의 PR 모습, 규칙이 판정했으면 null */
  readonly pin: PrFingerprint | null;
  /** 시간순으로 덧붙일 이력 (비어 있을 수 있다 — 기준점만 놓아 줄 때) */
  readonly changes: readonly StatusChange[];
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
  /**
   * PR 없이 빈 업무 하나를 만든다 (New Work, feature-plan F5). 표식이 든 PR 이 나중에 Sync 로 붙는다.
   * 확인 순서: 업무 ID 형식 → invalid_input, 없는 프로젝트 → not_found, 같은 ID 의 업무 → invalid_input. 걸리면 아무것도 쓰지 않는다.
   */
  createWork(work: Work): Promise<void>;

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

  /**
   * 업무 상태를 바꾼다 (WorkStatusUpdate). 없는 업무면 not_found, 상태 값이 목록 밖이면 invalid_input.
   * 지금 상태가 expected 와 다르면 false 를 돌려주고 아무것도 쓰지 않는다.
   */
  updateWorkStatus(update: WorkStatusUpdate): Promise<boolean>;
  /** 사람이 손으로 바꾼 뒤 규칙이 아직 덮지 않은 업무의 기준점 (업무 ID → 기준점). 기준점이 없는 업무는 빠진다 */
  listStatusPins(): Promise<Record<string, PrFingerprint>>;
  /** 상태 이력 전부. 쌓인 순서(오래된 것부터)다 */
  listStatusChanges(): Promise<StatusChange[]>;

  /**
   * PR 이벤트를 덧붙인다 (feature-plan F7, src/domain/pr-event.ts). 이미 있는 ID 의 이벤트는 건너뛴다 — 같은 변화를 두 번 읽어도
   * 한 번만 남는다(ID 가 변화의 내용에서 만들어지므로). 하나라도 걸리면 아무것도 쓰지 않는다.
   * 확인 순서: PR 값이 범위 밖이거나 종류가 목록 밖 → invalid_input, 없는 업무 → not_found.
   */
  addPrEvents(events: readonly PrEvent[]): Promise<void>;
  /** 한 업무의 PR 이벤트. 쌓인 순서(오래된 것부터)다 */
  listPrEvents(workId: string): Promise<PrEvent[]>;

  /**
   * 메모를 더한다 (feature-plan F8, src/domain/memo.ts). 답글(F9)도 이것으로 더한다 — thread 칸이 달린 항목을 가리킨다.
   * 하나라도 걸리면 아무것도 쓰지 않는다.
   * 확인 순서: 본문이 규칙 밖(isAcceptedMemoBody)이거나 작성자가 비었거나 고침 · 지움 시각이 차 있거나
   *   thread 가 모양 밖(isValidThreadTarget) → invalid_input, 없는 업무 → not_found, 같은 ID 의 메모 → invalid_input,
   *   thread 가 메모를 가리키는데 그것이 **같은 업무의 최상위 메모**가 아님(없음 · 다른 업무 · 그 자신이 답글) → invalid_input.
   *   (스레드는 한 단계만이다. PostgreSQL 은 이것을 표의 제약으로도 막는다.)
   * PR 카드 대상은 모양만 본다. 그 카드가 이 업무의 최신 카드인지는 유스케이스(application/memo.ts writeReply)가 본다.
   */
  addMemo(memo: Memo): Promise<void>;
  /** 한 업무의 메모 — 최상위 메모와 답글 모두. 쌓인 순서(오래된 것부터)다. 지운 메모도 자리를 지키려고 함께 돌아온다(본문은 비어 있다) */
  listMemos(workId: string): Promise<Memo[]>;
  /**
   * 메모 본문을 고치고 고친 시각을 남긴다. 그 업무에 그 메모가 없으면 not_found, 본문이 규칙 밖이거나 이미 지운 메모면 invalid_input.
   * 확인 순서: 본문 → 메모가 있는가 → 지웠는가.
   */
  editMemo(edit: { readonly workId: string; readonly id: string; readonly body: string; readonly editedAt: string }): Promise<void>;
  /**
   * 메모를 지운다 — 본문을 비우고 지운 시각을 남긴다. 그 업무에 그 메모가 없으면 not_found. 행은 남으므로 달린 답글도 그대로 남는다.
   * 이미 지운 메모면 아무것도 바꾸지 않는다(두 번 눌러도 처음 지운 시각이 남는다).
   */
  deleteMemo(target: { readonly workId: string; readonly id: string; readonly deletedAt: string }): Promise<void>;

  /** 미리보기 실행은 2단계에서 붙으므로 이번 단위에는 읽기만 있다. */
  listPreviewRecords(): Promise<PreviewRecord[]>;
}

/**
 * Agent Studio 의 도메인 모델 — docs/plan/00-domain-contract.md 의 다섯 개념.
 *
 * 이 폴더는 Next.js · GitHub · 데이터베이스는 물론 어떤 외부 패키지도 import 하지 않는다.
 * tests/unit/architecture.test.ts 가 소스를 읽어 이것을 확인한다.
 *
 * 상태의 주인이 둘이라는 점이 이 파일의 뼈대다 (계약 §5).
 *   - GitHub 가 소유하고 Studio 는 받아 적기만 하는 것: Repository, PrSnapshot
 *   - Studio 가 소유하는 것: Project, Work, PrLink, ReviewDecision, PreviewRecord
 * 두 쪽의 상태 값은 타입도 필드 이름도 겹치지 않게 갈라 둔다.
 */

/** GitHub 가 저장소에 부여한 숫자 ID. 이름(owner/repo)은 바뀔 수 있으므로 식별자로 쓰지 않는다 (계약 §3-1). */
export type RepoId = number;

/** GitHub 가 알려 준 저장소 정보. fullName 은 표시용이며 같은 저장소인지 판단하는 데 쓰지 않는다. */
export interface Repository {
  readonly id: RepoId;
  readonly fullName: string;
}

/** PR 을 가리키는 값. PR 의 동일성은 (저장소 숫자 ID, PR 번호) 쌍뿐이다. 브랜치 이름은 식별자가 아니다. */
export interface PrRef {
  readonly repoId: RepoId;
  readonly number: number;
}

/** PR 하나를 한 줄 문자열로 나타낸 열쇠. 저장소 이름이 아니라 숫자 ID 로 만든다. */
export function prKey(ref: PrRef): string {
  return `${ref.repoId}#${ref.number}`;
}

export function samePr(a: PrRef, b: PrRef): boolean {
  return a.repoId === b.repoId && a.number === b.number;
}

// ── GitHub 소유 (읽기 전용 거울) ─────────────────────────────────────────────

/** PR 상태. GitHub 에서만 바뀐다. */
export type PrState = "open" | "merged" | "closed";
/** 검사 결과 요약. "none" 은 검사가 하나도 없다는 뜻이다. */
export type ChecksState = "passing" | "failing" | "pending" | "none";
/** GitHub 리뷰 요약. Studio 의 내부 검토 결정(ReviewVerdict)과는 다른 것이다. */
export type GitHubReviewState = "approved" | "changes_requested" | "none";

/** GitHub 가 알려 준 PR 의 현재 상태. Studio 는 이 값을 만들거나 고치지 않고 받아 적기만 한다. */
export interface PrSnapshot extends PrRef {
  readonly title: string;
  readonly body: string;
  /** 브랜치 이름. 표식 판정에만 쓰고, PR 을 식별하는 데는 쓰지 않는다. */
  readonly branch: string;
  /** PR 의 최신 커밋 SHA. 커밋에 고정된 기록의 신선도를 이것과 비교한다. */
  readonly headSha: string;
  readonly url: string;
  readonly author: string;
  readonly state: PrState;
  readonly checks: ChecksState;
  readonly review: GitHubReviewState;
  readonly updatedAt: string;
}

// ── Studio 소유 ─────────────────────────────────────────────────────────────

/** 사용자가 만든 프로젝트. GitHub 저장소를 하나 이상 연결한다 (숫자 ID 로). */
export interface Project {
  readonly id: string;
  readonly name: string;
  readonly repoIds: readonly RepoId[];
}

/** 업무 상태 (계약 §5: 초안 · 진행 중 · 검토 필요 · 완료). */
export type WorkStatus = "draft" | "in_progress" | "needs_review" | "done";

/** 목표 하나를 가진 작업 단위. 업무는 Studio 가 발급한 ID 로만 같다 — 제목이 같아도 다른 업무다. */
export interface Work {
  readonly id: string;
  readonly projectId: string;
  readonly title: string;
  readonly status: WorkStatus;
  readonly createdAt: string;
}

/** 연결이 어떻게 생겼나. "marker" 는 표식으로 자동 연결, "user" 는 사람이 Inbox 에서 연결. */
export type LinkOrigin = "marker" | "user";

/** 업무와 PR 의 연결. PR 하나에는 연결이 최대 하나다. */
export interface PrLink extends PrRef {
  readonly workId: string;
  readonly origin: LinkOrigin;
  readonly linkedAt: string;
}

/** 내부 검토 결정 (계약 §5: 수정 요청 · 내부 검토 완료). GitHub 병합이나 GitHub 리뷰를 뜻하지 않는다. */
export type ReviewVerdict = "changes_requested" | "internal_review_done";

/** 내부 검토 결정 기록. "이 PR 의 이 커밋을 봤다" 가 기록 단위이므로 커밋 SHA 를 반드시 함께 갖는다. */
export interface ReviewDecision extends PrRef {
  readonly id: string;
  readonly workId: string;
  readonly commitSha: string;
  readonly verdict: ReviewVerdict;
  readonly decidedAt: string;
}

/**
 * 미리보기 실행 기록. 실제 실행은 2단계에서 붙는다.
 * 이번 단위에는 신선도 규칙(계약 §6)을 검증하기 위한 모양만 있다.
 */
export interface PreviewRecord extends PrRef {
  readonly id: string;
  readonly commitSha: string;
  readonly startedAt: string;
}

// ── 오류 ────────────────────────────────────────────────────────────────────

export type StudioErrorCode = "not_found" | "already_linked" | "project_mismatch" | "not_linked" | "invalid_input";

/** 도메인 규칙을 어기는 요청을 거절할 때 쓰는 오류. 메시지는 사용자에게 보여도 되는 한국어 문장이다. */
export class StudioError extends Error {
  readonly code: StudioErrorCode;

  constructor(code: StudioErrorCode, message: string) {
    super(message);
    this.name = "StudioError";
    this.code = code;
  }
}

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

/**
 * 값의 범위. GitHub 의 PR 번호는 저장소 안의 순번이라 32비트 정수(PostgreSQL integer) 안에 들어가고,
 * 저장소 ID 는 GitHub 전체의 순번이라 64비트(PostgreSQL bigint)로 둔다. JavaScript 가 정확히 셀 수 있는
 * 가장 큰 정수(2^53 - 1)가 bigint 보다 작으므로, 저장소 ID 의 상한은 그 값이다.
 */
export const MAX_PR_NUMBER = 2_147_483_647;
export const MAX_REPO_ID = Number.MAX_SAFE_INTEGER;

/** PR 을 가리키는 값이 받아들일 수 있는 범위 안인가 (양의 정수, 저장 칸의 범위 안). 입력의 경계에서 확인한다. */
export function isValidPrRef(ref: { readonly repoId: unknown; readonly number: unknown }): ref is PrRef {
  const inRange = (v: unknown, max: number) => typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= max;
  return inRange(ref.repoId, MAX_REPO_ID) && inRange(ref.number, MAX_PR_NUMBER);
}

/**
 * GitHub 에서 받은 글에 든 NUL 문자(U+0000)를 대체 문자(U+FFFD)로 바꾼다.
 * PostgreSQL 은 글 칸에 NUL 을 저장하지 못한다. 지우지 않고 바꾸는 이유는, 지우면 앞뒤 글자가 붙어
 * 원래 없던 표식이 생길 수 있기 때문이다(예: "studio-work-\u0000a1" → "studio-work-a1"). 대체 문자는 단어 문자가 아니라
 * 표식 판정에서 경계로 읽힌다 — NUL 이 그랬던 것과 같다.
 */
export function withoutNul(snapshot: PrSnapshot): PrSnapshot {
  const clean = (text: string) => text.replaceAll("\u0000", "\uFFFD");
  return {
    ...snapshot,
    title: clean(snapshot.title),
    body: clean(snapshot.body),
    branch: clean(snapshot.branch),
    url: clean(snapshot.url),
    author: clean(snapshot.author),
  };
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
  /**
   * PR 의 브랜치가 있는 저장소의 숫자 ID. PR 의 저장소(repoId)와 같으면 그 저장소 자신의 브랜치이고,
   * 다르면 복제본(fork)의 브랜치다. 복제본이 지워졌거나 알 수 없으면 null 이다 (결정 10).
   */
  readonly headRepoId: RepoId | null;
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

/** 표식을 찾은 자리. PR 제목은 표식을 찾는 자리가 아니다 (계약 §4: 본문 또는 브랜치 이름). */
export type MarkerPlace = "body" | "branch";

/**
 * 업무와 PR 의 연결. PR 하나에는 연결이 최대 하나다.
 * 표식으로 생긴 연결은 연결되던 순간 표식이 어디에 있었는지를 함께 남긴다 — 나중에 표식이 지워져도 기록은 남는다.
 */
export type PrLink = PrRef & {
  readonly workId: string;
  readonly linkedAt: string;
} & (
    | { readonly origin: "user" }
    | { readonly origin: "marker"; readonly markerFoundIn: readonly MarkerPlace[] }
  );

/**
 * 사람이 연결을 푼 기록 (Unlink, 결정 9). 이 기록이 있는 PR 은 표식이 있어도 자동으로 다시 붙지 않는다.
 * 사람이 Inbox 에서 다시 연결하면 기록은 지워진다.
 */
export interface UnlinkRecord extends PrRef {
  /** 연결이 풀리기 전에 이 PR 이 붙어 있던 업무 */
  readonly workId: string;
  readonly unlinkedAt: string;
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

export type StudioErrorCode =
  | "not_found"
  | "already_linked"
  | "project_mismatch"
  | "not_linked"
  | "invalid_input"
  | "unlinked_by_user"; // 사람이 연결을 푼 PR 에 표식으로 연결하려 했다

/** 도메인 규칙을 어기는 요청을 거절할 때 쓰는 오류. 메시지는 사용자에게 보여도 되는 한국어 문장이다. */
export class StudioError extends Error {
  readonly code: StudioErrorCode;

  constructor(code: StudioErrorCode, message: string) {
    super(message);
    this.name = "StudioError";
    this.code = code;
  }
}

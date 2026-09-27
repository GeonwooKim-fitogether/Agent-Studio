/**
 * 화면 라벨. 상태·기능 이름은 영어(결정 2), 설명 문장은 한국어로 쓴다.
 *
 * GitHub 의 리뷰와 Studio 의 내부 검토 결정은 같은 낱말(changes requested)을 쓰므로, Studio 쪽 검토 표기는
 * 모두 "Internal:" 로 시작한다. 한 카드에 둘이 함께 보여도 어느 쪽 것인지 글자만 보고 가릴 수 있어야 한다.
 */
import type { StatusChangeView } from "../../application/queries";
import type { ReviewBlock } from "../../application/review";
import type { InboxReason } from "../../domain/auto-link";
import type { ChecksState, GitHubReviewState, MarkerPlace, PrState, ReviewVerdict, WorkStatus } from "../../domain/model";
import type { PreviewBlock, PreviewPhase } from "../../domain/preview";
import { markerFor } from "../../domain/work-marker";
import type { StatusRule } from "../../domain/work-status";

export const WORK_STATUS: Record<WorkStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  needs_review: "Needs review",
  done_candidate: "Done candidate",
  done: "Done",
};

/** 완료 후보일 때 Mark as Done 옆의 이유 (결정 14, 시안 v2) */
export const DONE_CANDIDATE_NOTE =
  "연결된 PR 이 모두 병합됐다. 업무는 PR 보다 클 수 있어 자동으로 완료하지 않는다 — 남은 일이 없으면 Mark as Done 을 누른다.";

/** 사람이 상태를 손으로 고를 때의 안내 (R6) */
export const MANUAL_STATUS_NOTE =
  "손으로 고른 상태는 다음 PR 변화(새 커밋 · 새 연결 · 병합 · 닫힘)가 올 때까지 규칙이 덮지 않는다.";

/** 규칙이 상태를 바꾼 이유. 같은 규칙이라도 어느 상태로 갔느냐에 따라 뜻이 갈리는 것(R2 · R4)은 도착 상태로 나눈다 */
function ruleReason(rule: StatusRule, to: WorkStatus): string {
  switch (rule) {
    case "R1":
      return "첫 PR 이 연결됐다";
    case "R1b":
      return "연결된 PR 이 모두 빠져 검토할 PR 이 없다";
    case "R2":
      return to === "needs_review"
        ? "최신 커밋의 검사가 끝났고 아직 판단하지 않았다"
        : "최신 커밋의 검사가 아직 진행 중이거나 실패했다 — 판단할 차례가 아니다";
    case "R3":
      return "최신 커밋에 Request Changes 를 남겼다";
    case "R3b":
      return "최신 커밋에 Approve(내부 검토 완료)를 남겼다 — GitHub 병합을 기다린다";
    case "R4":
      return to === "done_candidate" ? "열린 PR 이 없고 병합된 PR 이 있다" : "연결된 PR 이 모두 병합 없이 닫혔다";
    case "R5":
      return "완료된 업무에 열린 PR 이 생겼다";
  }
}

/**
 * 업무 화면의 "상태 이력" 한 줄. 예: "규칙 R2 · demo-org/docs-site#12 커밋 6f7a8b9 · 최신 커밋의 검사가 끝났고 … · 2026-09-28 10:02:00 KST"
 * 사람이 바꿨으면 그 사실과, 아직 규칙이 덮지 않고 있다면(R6) 그 약속을 함께 적는다.
 */
export function statusChangeText(change: StatusChangeView | null, pinned: boolean): string {
  if (change === null) return "아직 규칙이나 사람이 상태를 바꾼 적이 없다";
  const at = formatKst(change.at);
  if (change.cause.kind === "person") {
    const what =
      change.cause.action === "mark_done" ? "사람이 Mark as Done 을 눌렀다" : `사람이 상태를 ${WORK_STATUS[change.to]} 로 바꿨다`;
    return [what, pinned ? "다음 PR 변화까지 규칙이 덮지 않는다" : null, at].filter((p) => p !== null).join(" · ");
  }
  const evidence = change.cause.evidence.map((e) => `${e.repoName}#${e.number} 커밋 ${shortSha(e.commitSha)}`).join(", ");
  return [`규칙 ${change.cause.rule}`, evidence === "" ? null : evidence, ruleReason(change.cause.rule, change.to), at]
    .filter((p) => p !== null)
    .join(" · ");
}

export const PR_STATE: Record<PrState, string> = { open: "Open", merged: "Merged", closed: "Closed" };

export const CHECKS: Record<ChecksState, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks pending",
  none: "No checks",
};

export const GITHUB_REVIEW: Record<GitHubReviewState, string> = {
  approved: "Approved",
  changes_requested: "Changes requested",
  none: "No review",
};

export const VERDICT: Record<ReviewVerdict, string> = {
  changes_requested: "Internal: changes requested",
  internal_review_done: "Internal: review done",
};

export const NO_INTERNAL_REVIEW = "Internal: not reviewed";

/** 내부 검토 결정의 한국어 설명. 카드에서 영어 표기 옆에 붙인다(feature-plan F2: "내부 검토 완료 · 커밋 a1b2c3d") */
export const VERDICT_MEANING: Record<ReviewVerdict, string> = {
  changes_requested: "수정 요청",
  internal_review_done: "내부 검토 완료",
};

/** Approve 옆의 작은 설명 — GitHub 의 승인 · 병합과 헷갈리지 않게 한다 (feature-plan F2, 계약 §5) */
export const APPROVE_NOTE = "내부 검토 완료 — GitHub 병합이 아니다";

/** 내부 검토 결정을 남길 수 없는 PR 쪽 이유 */
export const REVIEW_BLOCK: Record<ReviewBlock, string> = {
  merged: "GitHub 에서 이미 병합된 PR 이라 내부 검토 결정을 새로 남기지 않는다.",
  closed: "GitHub 에서 닫힌 PR 이라 내부 검토 결정을 새로 남기지 않는다.",
};

/** 카드가 있는 화면마다 한 줄로 보여 주는 범례 */
export const STATE_LEGEND =
  "GitHub 줄은 GitHub 가 알려 준 상태다. Studio 줄은 Studio 안에만 있는 기록이며 GitHub 에 반영되지 않는다.";

/** 연결 표기. 표식으로 연결됐으면 표식을 찾은 자리를 함께 적는다. */
export function linkLabel(origin: "marker" | "user" | null, foundIn: readonly MarkerPlace[]): string {
  if (origin === "user") return "Linked manually";
  if (origin === "marker") return foundIn.length > 0 ? `Linked by marker (${foundIn.join(", ")})` : "Linked by marker";
  return "Not linked";
}

export function inboxReasonText(
  reason: InboxReason | null,
  markedWorkIds: readonly string[],
  markedProjectName: string | null = null,
  unlinkedFromWorkTitle: string | null = null,
): string {
  const list = markedWorkIds.map(markerFor).join(", ");
  switch (reason) {
    case "unlinked_by_user":
      return `사람이 이 PR 의 연결을 풀었다${unlinkedFromWorkTitle === null ? "" : `('${unlinkedFromWorkTitle}' 업무에서)`}. 표식이 있어도 자동으로 다시 붙이지 않는다. 다시 연결하려면 아래에서 고른다.`;
    case "fork_head":
      return "PR 의 브랜치가 다른 저장소(복제본)에 있다. 팀 밖에서 온 PR 일 수 있어 표식이 있어도 자동으로 연결하지 않는다.";
    case "unknown_head":
      return "PR 의 브랜치가 어느 저장소에 있는지 알 수 없다(복제본이 지워졌을 수 있다). 복제본으로 보고 자동으로 연결하지 않는다.";
    case "no_marker":
      return "업무 표식이 없어 어느 업무의 것인지 판단하지 않았다.";
    case "unknown_work":
      return `표식 ${list} 가 가리키는 업무가 없다.`;
    case "other_project":
      return markedProjectName === null
        ? `표식 ${list} 는 다른 프로젝트의 업무를 가리킨다.`
        : `표식 ${list} 는 다른 프로젝트('${markedProjectName}')의 업무를 가리킨다.`;
    case "multiple_markers":
      return `서로 다른 업무를 가리키는 표식이 ${markedWorkIds.length}개 있다 (${list}).`;
    case null:
      return `표식 ${list} 가 있다. 다음 Sync 에서 자동으로 연결된다.`;
  }
}

export const shortSha = (sha: string) => sha.slice(0, 7);

const KST = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** ISO 시각을 한국 시간으로 (예: 2026-09-25 14:19:08 KST) */
export function formatKst(iso: string): string {
  return `${KST.format(new Date(iso))} KST`;
}

/** 마지막 동기화가 얼마 전인지 (예: "방금", "3분 전", "2시간 전"). 화면을 그리는 순간 기준이다 */
export function formatAgo(iso: string, nowMs: number): string {
  const minutes = Math.floor((nowMs - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "방금";
  if (minutes < 60) return `${minutes}분 전`;
  return `${Math.floor(minutes / 60)}시간 전`;
}

/** 미리보기를 열 수 없는 PR 쪽 이유 (docs/plan/04-remote-preview.md §4) */
export const PREVIEW_BLOCK: Record<PreviewBlock, string> = {
  fork: "복제본(fork)에서 온 PR 이라 미리보기로 실행하지 않는다. 팀 밖에서 온 코드를 이 컴퓨터에서 돌리지 않는다.",
  sha_not_full: "PR 의 최신 커밋이 전체 SHA 로 오지 않아, 무엇을 실행하는지 하나로 고정할 수 없다.",
  bad_repo: "저장소 이름이 코드를 받을 수 있는 모양이 아니다.",
};

/** 미리보기 진행 단계 */
export const PREVIEW_PHASE: Record<PreviewPhase, string> = {
  fetching: "Fetching code",
  installing: "Installing (npm ci)",
  starting: "Starting",
  running: "Running",
  failed: "Failed",
  stopped: "Stopped",
};

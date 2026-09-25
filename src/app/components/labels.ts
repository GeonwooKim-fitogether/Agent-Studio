/**
 * 화면 라벨. 상태·기능 이름은 영어(결정 2), 설명 문장은 한국어로 쓴다.
 *
 * GitHub 의 리뷰와 Studio 의 내부 검토 결정은 같은 낱말(changes requested)을 쓰므로, Studio 쪽 검토 표기는
 * 모두 "Internal:" 로 시작한다. 한 카드에 둘이 함께 보여도 어느 쪽 것인지 글자만 보고 가릴 수 있어야 한다.
 */
import type { InboxReason } from "../../domain/auto-link";
import type { ChecksState, GitHubReviewState, MarkerPlace, PrState, ReviewVerdict, WorkStatus } from "../../domain/model";
import { markerFor } from "../../domain/work-marker";

export const WORK_STATUS: Record<WorkStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  needs_review: "Needs review",
  done: "Done",
};

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
): string {
  const list = markedWorkIds.map(markerFor).join(", ");
  switch (reason) {
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

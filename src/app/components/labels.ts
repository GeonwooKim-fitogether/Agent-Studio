/** 화면 라벨. 상태·기능 이름은 영어(결정 2), 설명 문장은 한국어로 쓴다. */
import type { InboxReason } from "../../domain/auto-link";
import type { ChecksState, GitHubReviewState, LinkOrigin, PrState, ReviewVerdict, WorkStatus } from "../../domain/model";

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
  changes_requested: "Changes requested",
  internal_review_done: "Internal review done",
};

export const LINK_ORIGIN: Record<LinkOrigin, string> = {
  marker: "Linked by marker",
  user: "Linked in Inbox",
};

export function inboxReasonText(reason: InboxReason | null, markers: readonly string[]): string {
  const list = markers.map((id) => `studio-work-${id}`).join(", ");
  switch (reason) {
    case "no_marker":
      return "업무 표식이 없어 어느 업무의 것인지 판단하지 않았다.";
    case "unknown_work":
      return `표식 ${list} 가 가리키는 업무가 없다.`;
    case "other_project":
      return `표식 ${list} 는 다른 프로젝트의 업무를 가리킨다.`;
    case "multiple_markers":
      return `서로 다른 업무를 가리키는 표식이 ${markers.length}개 있다 (${list}).`;
    case null:
      return `표식 ${list} 가 있다. 다음 Sync 에서 자동으로 연결된다.`;
  }
}

export const shortSha = (sha: string) => sha.slice(0, 7);

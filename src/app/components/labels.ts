/**
 * 화면 라벨. 상태·기능 이름은 영어(결정 2), 설명 문장은 한국어로 쓴다.
 *
 * GitHub 의 리뷰와 Studio 의 내부 검토 결정은 같은 낱말(changes requested)을 쓰므로, Studio 쪽 검토 표기는
 * 모두 "Internal:" 로 시작한다. 한 카드에 둘이 함께 보여도 어느 쪽 것인지 글자만 보고 가릴 수 있어야 한다.
 */
import type { AttentionItem, AttentionKind } from "../../application/attention";
import type { MemoProblem } from "../../application/memo";
import type { NewWorkProblem } from "../../application/new-work";
import type { StatusChangeView } from "../../application/queries";
import type { DecisionBlock } from "../../application/review";
import type { SetGoalProblem } from "../../application/work-goal";
import type { ReviewNoteProblem } from "../../domain/review-note";
import { MAX_REVIEW_NOTE_LENGTH } from "../../domain/review-note";
import { MAX_WORK_GOAL_LENGTH } from "../../domain/work-goal";
import type { InboxReason } from "../../domain/auto-link";
import type { ChecksState, GitHubReviewState, MarkerPlace, PrState, ReviewVerdict, WorkStatus } from "../../domain/model";
import type { PreviewBlock, PreviewPhase } from "../../domain/preview";
import { markerFor } from "../../domain/work-marker";
import type { PrEvent } from "../../domain/pr-event";
import type { StatusRule } from "../../domain/work-status";
import { MAX_MEMO_LENGTH } from "../../domain/memo";
import { MAX_WORK_TITLE_LENGTH } from "../../domain/work-title";

export const WORK_STATUS: Record<WorkStatus, string> = {
  draft: "Draft",
  in_progress: "In progress",
  needs_review: "Needs review",
  done_candidate: "Done candidate",
  done: "Done",
};

/** 완료 후보일 때 Mark as Done 옆의 이유 (결정 14, 시안 v2) */
export const DONE_CANDIDATE_NOTE = "연결된 PR 이 모두 병합됐다. 업무는 PR 보다 클 수 있어 자동으로 완료하지 않는다.";

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
      return "최신 커밋에 Request changes 를 남겼다";
    case "R3b":
      return "최신 커밋에 Approve in Studio(내부 검토 완료)를 남겼다 — GitHub 병합을 기다린다";
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
  return [statusCauseText(change, pinned), formatKst(change.at)].join(" · ");
}

/** 상태를 누가 · 왜 바꿨나 (시각 없이). Chat 타임라인의 상태 줄과 업무 머리의 이력 한 줄이 함께 쓴다 */
export function statusCauseText(change: StatusChangeView, pinned = false): string {
  if (change.cause.kind === "person") {
    const what =
      change.cause.action === "mark_done" ? "사람이 Mark as Done 을 눌렀다" : `사람이 상태를 ${WORK_STATUS[change.to]} 로 바꿨다`;
    return [what, pinned ? "다음 PR 변화까지 규칙이 덮지 않는다" : null].filter((p) => p !== null).join(" · ");
  }
  const evidence = change.cause.evidence.map((e) => `${e.repoName}#${e.number} 커밋 ${shortSha(e.commitSha)}`).join(", ");
  return [`규칙 ${change.cause.rule}`, evidence === "" ? null : evidence, ruleReason(change.cause.rule, change.to)]
    .filter((p) => p !== null)
    .join(" · ");
}

/** GitHub 의 PR 상태 · 검사 · 리뷰. 늘 "GitHub" 이라고 적힌 줄 안에서만 쓰므로 출처를 글자에 다시 붙이지 않는다 (결정 18) */
export const PR_STATE: Record<PrState, string> = { open: "Open", merged: "Merged", closed: "Closed" };

export const CHECKS: Record<ChecksState, string> = {
  passing: "Checks passing",
  failing: "Checks failing",
  pending: "Checks pending",
  none: "No checks",
};

export const GITHUB_REVIEW: Record<GitHubReviewState, string> = { approved: "Approved", changes_requested: "Changes requested", none: "No review" };

/** GitHub 줄의 칩 셋 (상태 · 검사 · 리뷰). 카드 · Inbox 항목 · Up next · Review 패널이 같은 셋을 쓴다 */
export interface GitHubState {
  readonly state: PrState;
  readonly checks: ChecksState;
  readonly review: GitHubReviewState;
}
export const githubChips = (g: GitHubState): readonly { readonly text: string; readonly className: string }[] => [
  { text: PR_STATE[g.state], className: `pr-${g.state}` },
  { text: CHECKS[g.checks], className: `checks-${g.checks}` },
  { text: GITHUB_REVIEW[g.review], className: "" },
];
export const githubLine = (g: GitHubState) => `${PR_STATE[g.state]} · ${CHECKS[g.checks]} · ${GITHUB_REVIEW[g.review]}`;

export const VERDICT: Record<ReviewVerdict, string> = {
  changes_requested: "Internal: changes requested",
  internal_review_done: "Internal: review done",
};

export const NO_INTERNAL_REVIEW = "Internal: not reviewed";

/** 결정 버튼 아래의 한 줄 — Studio 의 승인은 GitHub 의 승인 · 병합이 아니다 (feature-plan F2, 계약 §5). 결정을 내리는 자리라 여기에는 둔다 */
export const APPROVE_NOTE = "Studio 에만 기록된다 — GitHub 리뷰 · 병합이 아니다.";

/** 내부 검토 결정을 남길 수 없는 이유 */
export const REVIEW_BLOCK: Record<DecisionBlock, string> = {
  merged: "GitHub 에서 이미 병합된 PR 이라 내부 검토 결정을 새로 남기지 않는다.",
  closed: "GitHub 에서 닫힌 PR 이라 내부 검토 결정을 새로 남기지 않는다.",
  outdated_preview:
    "지금 돌고 있는 미리보기가 이전 커밋이다. 오래된 화면을 보고 최신 커밋을 판단하지 않도록 결정을 막았다 — Open Preview 로 최신 커밋을 다시 연다.",
};

/** 미리보기 기기가 꺼져 있을 때 Review 패널 · Next action 에 보이는 한 줄 (Q10) — 검토는 막지 않는다 */
export const PREVIEW_HOST_OFFLINE = "Preview host offline — 미리보기 없이 GitHub 에서 확인한다.";

/** Review 패널이 결정을 남기지 않은 이유 (?problem=). stale 은 새 커밋 SHA 를 받아 문장을 만든다 */
export type ReviewProblem = ReviewNoteProblem | "stale" | "outdated_preview" | "refused";
export function reviewProblemText(problem: ReviewProblem, headSha: string): string {
  switch (problem) {
    case "stale":
      return `새 커밋 ${shortSha(headSha)} 이 도착해 저장하지 않았다. 최신 커밋을 확인한 뒤 다시 판단한다.`;
    case "reason_missing":
      return "Request changes 에는 Reason(무엇이 왜 문제인가)이 필요하다.";
    case "done_when_missing":
      return "Request changes 에는 Done when(무엇이 되면 수정이 끝나나)이 필요하다.";
    case "too_long":
      return `글이 ${MAX_REVIEW_NOTE_LENGTH}자를 넘는다. 줄여서 적는다.`;
    case "control_char":
      return "글에 보이지 않는 제어 문자(탭 등)가 들어 있다. 줄바꿈은 된다.";
    case "outdated_preview":
      return REVIEW_BLOCK.outdated_preview;
    case "refused":
      return "결정을 남기지 않았다 — 화면이 오래됐을 수 있다(그사이 PR 이 병합 · 닫히거나 연결이 풀렸을 수 있다). 지금 상태를 확인한다.";
  }
}
export const REVIEW_PROBLEMS: readonly ReviewProblem[] = [
  "stale",
  "reason_missing",
  "done_when_missing",
  "too_long",
  "control_char",
  "outdated_preview",
  "refused",
];

/** 목표를 적지 않은 이유 */
export const GOAL_PROBLEM: Record<SetGoalProblem, string> = {
  empty: "목표가 비어 있다. 이 업무가 끝나면 무엇이 달라지는지 한두 문장으로 적는다.",
  too_long: `목표가 ${MAX_WORK_GOAL_LENGTH}자를 넘는다. 한두 문장으로 줄인다.`,
  control_char: "목표에 보이지 않는 제어 문자(탭 등)가 들어 있다. 줄바꿈은 된다.",
  no_work: "이 업무를 찾지 못했다.",
};

/** 연결 표기. 표식으로 연결됐으면 표식을 찾은 자리를 함께 적는다. */
export function linkLabel(origin: "marker" | "user" | null, foundIn: readonly MarkerPlace[]): string {
  if (origin === "user") return "Linked manually";
  if (origin === "marker") return foundIn.length > 0 ? `Linked by marker (${foundIn.join(", ")})` : "Linked by marker";
  return "Not linked";
}

/**
 * Inbox 항목의 짧은 사유 (결정 18 — 판단에 필요한 것만). 표식이 없어 온 보통의 경우는 사유를 적지 않는다(null) —
 * Inbox 에 있다는 것 자체가 그 뜻이다. 그 밖의 경우(복제본 · 연결 해제 · 표식 문제)만 한 구절로 적는다.
 */
export function inboxReasonText(
  reason: InboxReason | null,
  markedWorkIds: readonly string[],
  markedProjectName: string | null = null,
  unlinkedFromWorkTitle: string | null = null,
): string | null {
  const list = markedWorkIds.map(markerFor).join(", ");
  switch (reason) {
    case "unlinked_by_user":
      return `사람이 연결을 풀었다${unlinkedFromWorkTitle === null ? "" : `('${unlinkedFromWorkTitle}' 업무에서)`} · 자동으로 다시 붙지 않는다`;
    case "fork_head":
      return "복제본(fork)에서 온 PR · 자동으로 연결하지 않는다";
    case "unknown_head":
      return "브랜치의 저장소를 알 수 없어 복제본으로 본다 · 자동으로 연결하지 않는다";
    case "no_marker":
      return null;
    case "unknown_work":
      return `표식 ${list} 가 가리키는 업무가 없다`;
    case "other_project":
      return markedProjectName === null
        ? `표식 ${list} 는 다른 프로젝트의 업무를 가리킨다`
        : `표식 ${list} 는 다른 프로젝트('${markedProjectName}')의 업무를 가리킨다`;
    case "multiple_markers":
      return `서로 다른 업무의 표식이 ${markedWorkIds.length}개 (${list})`;
    case null:
      return `표식 ${list} · 다음 Sync 에서 자동으로 연결된다`;
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

/** Needs your attention 의 종류 표기 (시안 v2) */
export const ATTENTION_KIND: Record<AttentionKind, string> = {
  needs_review: "Needs review",
  checks_failing: "Checks failing",
  outdated_preview: "Outdated preview",
  inbox: "Inbox",
};

/** 모을 것이 없을 때의 문장 (시안 v2) */
export const ATTENTION_EMPTY = "지금 판단할 일이 없다.";

/** Needs your attention 항목의 대상(굵은 글자)과 한 구절 설명. 설명은 Up next 에서 큰 커밋 번호 아래 한 줄로 보인다(커밋은 거기 있으니 되풀이하지 않는다) — 줄에는 종류만 붙는다 */
export function attentionText(item: AttentionItem): { readonly target: string; readonly detail: string } {
  switch (item.kind) {
    case "needs_review":
      return {
        target: `'${item.workTitle}'`,
        detail:
          item.pr === null
            ? "업무 상태가 Needs review 다 · 판단할 PR 은 없다"
            : `${item.pr.repoName}#${item.pr.number} · 검사 끝남, 판단 전`,
      };
    case "checks_failing":
      return {
        target: `'${item.workTitle}' · ${item.pr.repoName}#${item.pr.number}`,
        detail: `${item.pr.repoName}#${item.pr.number} · 검사 실패, 작성자가 고칠 차례`,
      };
    case "outdated_preview":
      return {
        target: `'${item.workTitle}' · ${item.pr.repoName}#${item.pr.number}`,
        detail: `미리보기는 커밋 ${shortSha(item.previewCommitSha)}, 최신은 ${shortSha(item.pr.headSha)}`,
      };
    case "inbox":
      return { target: `PR ${item.count}개가 업무 연결을 기다린다`, detail: "어느 업무의 것인지 확실하지 않은 PR" };
  }
}

/** New Work 가 빈 업무를 만들지 않은 이유 (feature-plan F5) */
export const NEW_WORK_PROBLEM: Record<NewWorkProblem, string> = {
  empty: "제목이 비어 있다. 업무의 목표를 한 줄로 적는다.",
  too_long: `제목이 ${MAX_WORK_TITLE_LENGTH}자를 넘는다. 목록 한 줄에 보일 이름으로 줄인다.`,
  control_char: "제목에 줄바꿈이나 보이지 않는 제어 문자가 들어 있다. 한 줄의 보이는 글자로 적는다.",
  no_project: "고른 프로젝트를 찾지 못했다. 목록에서 다시 고른다.",
  goal_empty: "목표가 비어 있다. 이 업무가 끝나면 무엇이 달라지는지 한두 문장으로 적는다.",
  goal_too_long: `목표가 ${MAX_WORK_GOAL_LENGTH}자를 넘는다. 한두 문장으로 줄인다.`,
  goal_control_char: "목표에 보이지 않는 제어 문자(탭 등)가 들어 있다. 줄바꿈은 된다.",
};

/** 표식 옆의 한 구절 — 표식을 어디에 넣으면 자동으로 연결되는지. 본문이 아니라 title(마우스를 올리면 보이는 설명)로 붙인다 */
export const MARKER_HINT = "PR 본문이나 브랜치 이름에 이 표식을 앞뒤를 띄어 넣으면 다음 Sync 에서 이 업무에 자동으로 연결된다.";

// ── 업무 Chat (feature-plan F7, 시안 v2 의 2.5단계) ──────────────────────────────

const KST_HM = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit", hour12: false });
const KST_DAY = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Seoul", year: "numeric", month: "2-digit", day: "2-digit" });
const WEEKDAY = ["일", "월", "화", "수", "목", "금", "토"];

/** 타임라인 줄의 시각 (한국 시간, 예: 09:58) */
export const formatKstTime = (iso: string) => KST_HM.format(new Date(iso));
/** 타임라인의 날짜 구분 열쇠 (한국 시간의 날짜, 예: 2026-09-28) */
export const kstDay = (iso: string) => KST_DAY.format(new Date(iso));
/** 날짜 구분선의 글자 (예: "9월 28일 (월)") — kstDay 의 값을 받는다 */
export function dayLabel(day: string): string {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  return `${m}월 ${d}일 (${WEEKDAY[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]})`;
}

/** 이벤트 줄의 주인 표시 (계약 §5 — GitHub 가 알려 준 것과 Studio 가 한 것을 가른다) */
export const OWNER_TAG = { github: "GitHub", studio: "Studio" } as const;

/** 타임라인 맨 위의 작은 한 줄 — 기록이 언제부터 남는지(그전의 PR 변화는 기록되지 않았다) */
export function recordStartText(since: string): string {
  return `기록 시작 · ${formatKst(since)}`;
}

/** PR 이벤트 한 줄 (PR 이름은 앞에 굵게 따로 붙인다). 커밋 번호는 연결 사건에만 적는다 — 줄마다 되풀이하지 않는다 (Focus 시안) */
export function prEventText(event: PrEvent): string {
  switch (event.kind) {
    case "linked":
      return `연결됨 · ${event.origin === "marker" ? "Linked by marker" : "Linked manually"} · 커밋 ${shortSha(event.commitSha)}`;
    case "unlinked":
      return `연결 해제 (Unlink) · Inbox 로 돌아갔다`;
    case "new_commit":
      return "새 커밋 도착";
    case "checks":
      return CHECKS[event.checks];
    case "merged":
      return "병합됨 (Merged)";
    case "closed":
      return `닫힘 (Closed) · 병합 없이 닫혔다`;
    case "reopened":
      return `다시 열림 (Open)`;
  }
}

/** 내부 검토 결정 한 줄 */
export function reviewEventText(verdict: ReviewVerdict, commitSha: string): string {
  const button = verdict === "internal_review_done" ? "Approve in Studio" : "Request changes";
  return `커밋 ${shortSha(commitSha)} 에 ${button} — ${VERDICT[verdict]}`;
}

/** 채널 목록 아래의 한 줄 (시안 v2) */
export const CHANNELS_FOOT = "채널 하나가 업무 하나다. 새 업무는 Workspace 의 New Work 로 만든다.";

// ── 메모 (feature-plan F8, 시안 v2 의 composer · memo) ──────────────────────────────

/** 메모 작성자 "나" (결정 15: 첫 버전의 작성자는 한 명이다) */
export const MEMO_AUTHOR_LABEL = "나";
export const MEMO_PLACEHOLDER = "판단의 이유를 메모로 남긴다";
/** 입력칸의 title(마우스를 올리면 보이는 설명) — 이 칸이 AI 에게 가지 않는다는 것을 보인다(결정 7). 본문에는 두지 않는다 */
export const MEMO_NOTE = "메모는 AI 에게 전달되지 않는다. 첫 버전은 나 혼자 보는 기록이다.";
export const MEMO_EDITED = "고침";
export const MEMO_DELETED = "지워진 메모";

/** 메모를 남기거나 고치지 않은 이유 */
export const MEMO_PROBLEM: Record<MemoProblem, string> = {
  empty: "메모가 비어 있다. 남길 내용을 적는다.",
  too_long: `메모가 ${MAX_MEMO_LENGTH}자를 넘는다. 나눠서 남긴다.`,
  control_char: "메모에 보이지 않는 제어 문자(탭 등)가 들어 있다. 줄바꿈은 된다.",
  no_work: "이 업무를 찾지 못했다.",
  no_memo: "그 메모가 없거나 이미 지워졌다 — 화면이 오래됐을 수 있다.",
  no_thread: "이 스레드에는 새 답글을 달 수 없다 — 메모가 지워졌거나 새 커밋이 와서 최신 카드가 바뀌었을 수 있다(화면이 오래됐을 수 있다).",
};

// ── 스레드 (feature-plan F9, 시안 v2 의 thread 패널) ──────────────────────────────

export const REPLY_PLACEHOLDER = "답글을 남긴다";
/** 스레드 입력칸의 title — 메모와 같다 */
export const REPLY_NOTE = "답글도 AI 에게 전달되지 않는다.";
export const NO_REPLIES = "아직 답글이 없다.";
export const repliesLabel = (n: number) => `답글 ${n}`;
/** 새 답글을 받지 않는 스레드의 이유 (입력칸 자리에 보인다) */
export function threadClosedText(reason: "deleted_memo" | "old_card", headSha: string | null): string {
  return reason === "deleted_memo"
    ? "지워진 메모의 스레드다. 남은 답글은 읽을 수 있고, 새 답글은 달지 않는다."
    : `이전 커밋 카드의 스레드다. 남은 답글은 여기에 그대로 있고, 새 답글은 최신 카드(${shortSha(headSha ?? "")})의 Reply 로 남긴다.`;
}

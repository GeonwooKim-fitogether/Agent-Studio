/**
 * Focus 시안(결정 18)의 Workspace 와 업무 화면이 "먼저 볼 것" 을 고르는 순수 함수들. 저장소나 GitHub 에 묻지 않는다.
 *
 * Workspace (Q5)
 *   - Needs your attention: collectAttention 의 항목을 **업무 하나에 한 줄**로 합친다. 한 업무에 이유가 여럿이면 가장 앞선 이유
 *     (collectAttention 의 순서: 검토 필요 → 검사 실패 → 오래된 미리보기)를 보이고 나머지는 개수로만 붙인다. Inbox 는 한 줄 그대로다.
 *   - Other work: Needs your attention 에 있는 업무는 넣지 않는다 — 같은 업무를 두 번 보이지 않는다(사용자 요구 1).
 *     필터는 Open(초안 · 진행 중 · 검토 필요) · Done candidate · Done, 그리고 프로젝트.
 *   - Up next: 고른 attention 업무 하나(없으면 첫 줄)의 요약.
 * 업무 화면 (Q6)
 *   - Next action: 지금 그 업무에서 사람이 할 일 하나(nextActionFor).
 */
import type { AttentionItem, RunningPreview } from "./attention";
import { freshnessOf } from "../domain/freshness";
import { samePr, type WorkStatus } from "../domain/model";
import type { PrCardView, WorkspaceView, WorkSummaryView } from "./queries";
import { visibleReviews } from "./review";

type WorkItem = Exclude<AttentionItem, { kind: "inbox" }>;

export type AttentionRow =
  | {
      readonly kind: "work";
      readonly workId: string;
      readonly workTitle: string;
      readonly projectId: string;
      readonly projectName: string;
      /** 이 업무를 올린 이유들 (앞선 것부터). 첫 번째가 줄에 보이는 이유다 */
      readonly reasons: readonly WorkItem[];
    }
  | { readonly kind: "inbox"; readonly count: number };

/** collectAttention 의 항목을 업무 단위로 합친다. 줄의 순서는 그 업무의 가장 앞선 이유가 나온 순서다 */
export function attentionRows(items: readonly AttentionItem[], view: WorkspaceView): AttentionRow[] {
  const projectOf = new Map(view.projects.flatMap((p) => p.works.map((w) => [w.work.id, p.project] as const)));
  const rows: AttentionRow[] = [];
  const byWork = new Map<string, WorkItem[]>();
  for (const item of items) {
    if (item.kind === "inbox") {
      rows.push({ kind: "inbox", count: item.count });
      continue;
    }
    const existing = byWork.get(item.workId);
    if (existing !== undefined) {
      existing.push(item);
      continue;
    }
    const reasons = [item];
    byWork.set(item.workId, reasons);
    const project = projectOf.get(item.workId);
    rows.push({
      kind: "work",
      workId: item.workId,
      workTitle: item.workTitle,
      projectId: project?.id ?? "",
      projectName: project?.name ?? "",
      reasons,
    });
  }
  // Inbox 줄은 업무 줄들 뒤에 둔다 (collectAttention 도 맨 뒤에 둔다)
  return [...rows.filter((r) => r.kind === "work"), ...rows.filter((r) => r.kind === "inbox")];
}

export type OtherWorkFilter = "open" | "done_candidate" | "done";
export const OTHER_WORK_FILTERS: readonly OtherWorkFilter[] = ["open", "done_candidate", "done"];

export function isOtherWorkFilter(value: unknown): value is OtherWorkFilter {
  return typeof value === "string" && (OTHER_WORK_FILTERS as readonly string[]).includes(value);
}

const FILTER_STATUSES: Record<OtherWorkFilter, readonly WorkStatus[]> = {
  open: ["draft", "in_progress", "needs_review"],
  done_candidate: ["done_candidate"],
  done: ["done"],
};

export interface OtherWorkItem {
  readonly summary: WorkSummaryView;
  readonly projectId: string;
  readonly projectName: string;
}

export interface WorkspaceFocusView {
  /** 프로젝트 필터를 건 attention 줄 (Inbox 줄은 필터와 무관하게 남는다 — Inbox 는 프로젝트를 가로질러 한 곳이다) */
  readonly attention: readonly AttentionRow[];
  /** Other work — attention 에 있는 업무를 뺀, 필터에 맞는 업무 */
  readonly other: readonly OtherWorkItem[];
  /** 탭마다의 개수 (프로젝트 필터와 attention 제외를 적용한 뒤) */
  readonly counts: Readonly<Record<OtherWorkFilter, number>>;
  /** Up next 에 보일 attention 업무. 고른 것이 없거나 목록에 없으면 첫 업무 줄, 업무 줄이 없으면 null */
  readonly focus: Extract<AttentionRow, { kind: "work" }> | null;
}

export function workspaceFocus(
  view: WorkspaceView,
  rows: readonly AttentionRow[],
  options: { readonly filter: OtherWorkFilter; readonly projectId: string | null; readonly focusId: string | null },
): WorkspaceFocusView {
  const inProject = (projectId: string) => options.projectId === null || projectId === options.projectId;
  const attention = rows.filter((r) => r.kind === "inbox" || inProject(r.projectId));
  const attentionIds = new Set(attention.flatMap((r) => (r.kind === "work" ? [r.workId] : [])));
  // attention 에서 뺀 업무는 프로젝트 필터 밖의 것이라도 Other work 에 나오지 않는다 — 필터 밖이면 애초에 보이지 않는다
  const all = view.projects
    .filter((p) => inProject(p.project.id))
    .flatMap((p) => p.works.map((summary) => ({ summary, projectId: p.project.id, projectName: p.project.name })))
    .filter((w) => !attentionIds.has(w.summary.work.id));
  const counts = Object.fromEntries(
    OTHER_WORK_FILTERS.map((f) => [f, all.filter((w) => FILTER_STATUSES[f].includes(w.summary.work.status)).length]),
  ) as Record<OtherWorkFilter, number>;
  const workRows = attention.filter((r): r is Extract<AttentionRow, { kind: "work" }> => r.kind === "work");
  return {
    attention,
    other: all.filter((w) => FILTER_STATUSES[options.filter].includes(w.summary.work.status)),
    counts,
    focus: workRows.find((r) => r.workId === options.focusId) ?? workRows[0] ?? null,
  };
}

// ── 업무 화면의 Next action (Q6) ─────────────────────────────────────────────

export type NextAction =
  | { readonly kind: "done" }
  | { readonly kind: "mark_done" }
  | { readonly kind: "review"; readonly pr: PrCardView }
  | { readonly kind: "outdated_preview"; readonly pr: PrCardView; readonly previewCommitSha: string }
  | { readonly kind: "checks_failing"; readonly pr: PrCardView }
  | { readonly kind: "set_goal" }
  | { readonly kind: "link_pr" }
  | { readonly kind: "changes_requested"; readonly pr: PrCardView }
  | { readonly kind: "await_merge"; readonly pr: PrCardView }
  | { readonly kind: "checks_pending"; readonly pr: PrCardView }
  | { readonly kind: "open_review"; readonly pr: PrCardView };

/** 최신 커밋에 대한 마지막 결정 (없으면 null) */
export function currentDecisionOf(pr: PrCardView) {
  return visibleReviews(pr.studio.reviews).filter((r) => r.freshness === "current").at(-1) ?? null;
}

/**
 * 지금 이 업무에서 사람이 할 일 하나. 앞선 것이 이긴다.
 *   완료 → 완료 후보(Mark as Done) → 이 PR 의 미리보기가 이전 커밋을 실행 중(결정을 막으므로 먼저 최신 커밋으로 다시 연다)
 *   → 판단할 PR(검사가 끝났고 최신 커밋에 결정 없음) → 검사 실패
 *   → 목표가 비었다(Set goal) → PR 이 없다(Link a PR) → 수정 요청을 남겼다(새 커밋을 기다린다) → Studio 승인 뒤 GitHub 병합을 기다린다
 *   → 검사가 진행 중이다 → 그 밖(열린 PR 의 Review 를 연다)
 * 같은 종류 안에서는 PR 카드 순서(저장소 이름 → 번호)의 첫 것이다.
 */
export function nextActionFor(summary: WorkSummaryView, preview: RunningPreview | null): NextAction {
  const { work, prs } = summary;
  if (work.status === "done") return { kind: "done" };
  if (work.status === "done_candidate") return { kind: "mark_done" };
  const open = prs.filter((p) => p.github.state === "open");
  const awaiting = open.find(
    (p) => (p.github.checks === "passing" || p.github.checks === "none") && currentDecisionOf(p) === null,
  );
  const outdated =
    preview !== null && preview.phase === "running"
      ? open.find((p) => samePr(preview.target, p) && freshnessOf(preview.target, p.headSha) === "outdated")
      : undefined;
  if (outdated !== undefined && preview !== null) return { kind: "outdated_preview", pr: outdated, previewCommitSha: preview.target.commitSha };
  if (awaiting !== undefined) return { kind: "review", pr: awaiting };
  const failing = open.find((p) => p.github.checks === "failing");
  if (failing !== undefined) return { kind: "checks_failing", pr: failing };
  if (work.goal === "") return { kind: "set_goal" };
  if (prs.length === 0) return { kind: "link_pr" };
  const changes = open.find((p) => currentDecisionOf(p)?.verdict === "changes_requested");
  if (changes !== undefined) return { kind: "changes_requested", pr: changes };
  const approved = open.find((p) => currentDecisionOf(p)?.verdict === "internal_review_done");
  if (approved !== undefined) return { kind: "await_merge", pr: approved };
  const pending = open.find((p) => p.github.checks === "pending");
  if (pending !== undefined) return { kind: "checks_pending", pr: pending };
  const first = open[0] ?? prs[0];
  return first === undefined ? { kind: "link_pr" } : { kind: "open_review", pr: first };
}

/** Work details 의 속성 줄이 가리키는 PR — Next action 의 PR, 없으면 첫 열린 PR, 없으면 첫 PR */
export function primaryPrOf(summary: WorkSummaryView, action: NextAction): PrCardView | null {
  if ("pr" in action) return action.pr;
  return summary.prs.find((p) => p.github.state === "open") ?? summary.prs[0] ?? null;
}

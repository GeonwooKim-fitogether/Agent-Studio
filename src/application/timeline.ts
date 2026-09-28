/**
 * 업무 Chat 의 타임라인 조립 (feature-plan F7, 시안 v2 의 timelineFor). 순수 함수 하나다 — 저장소를 모르고 재료만 받는다.
 *
 * 재료는 다섯이다. PR 이벤트(연결 · 새 커밋 · 검사 · 병합 · 닫힘 · 다시 열림 · 연결 해제), 업무 상태 이력, 내부 검토 결정, 업무를 만든 시각,
 * 그리고 사람이 쓴 메모(F8 — 쓴 시각의 자리에 놓인다. 고쳐도 자리는 그대로이고, 지운 메모도 "지워진 메모" 로 자리를 지킨다).
 * 이것들을 시간순으로 늘어놓고, 날짜가 바뀌는 자리에 구분선을 넣고, 항목마다 주인(GitHub · Studio)을 붙인다(계약 §5).
 *
 * PR 카드는 **커밋 단위**다(계약 §3-2 "이 PR 의 이 커밋", 결정 16-5). 지금 연결된 PR 마다 Studio 가 아는 커밋의 카드가 하나씩 생긴다.
 *   - 연결됨 · 새 커밋 이벤트의 커밋 → 그 이벤트 바로 뒤에
 *   - 이벤트는 없지만 내부 검토 결정이 가리키는 커밋 → 그 결정 바로 앞에 (Studio 에 남은 기록이 그 커밋을 보았다는 근거다)
 *   - PR 의 지금 커밋인데 어느 기록에도 없는 것(기록이 생기기 전부터 연결돼 있던 PR) → 맨 위 "기록 시작" 줄 바로 뒤에
 * 지금 커밋의 카드가 최신 카드이고, 버튼(Open Preview · Approve · Request Changes · Unlink)은 그 카드에만 둔다. 나머지는 이전 커밋의 기록이다.
 *
 * 기록이 생기기 전의 변화는 없다. 그런 카드가 하나라도 있으면 맨 위에 "이 업무의 기록은 언제부터 남는다" 는 줄을 둔다.
 */
import type { ChecksState, PrRef, ReviewDecision, ReviewVerdict, Work } from "../domain/model";
import { samePr } from "../domain/model";
import type { Memo } from "../domain/memo";
import { eventOwner, type PrEvent } from "../domain/pr-event";
import type { PrCardView, StatusChangeView } from "./queries";

export type Owner = "github" | "studio";

export type TimelineEntry =
  | { readonly type: "note"; readonly key: string; readonly since: string }
  | { readonly type: "day"; readonly key: string; readonly day: string }
  | { readonly type: "work_created"; readonly key: string; readonly at: string; readonly owner: "studio" }
  | { readonly type: "pr_event"; readonly key: string; readonly at: string; readonly owner: Owner; readonly event: PrEvent; readonly repoName: string }
  | {
      readonly type: "review";
      readonly key: string;
      readonly at: string;
      readonly owner: "studio";
      readonly repoName: string;
      readonly number: number;
      readonly commitSha: string;
      readonly verdict: ReviewVerdict;
    }
  | { readonly type: "status"; readonly key: string; readonly at: string; readonly owner: "studio"; readonly change: StatusChangeView }
  | { readonly type: "memo"; readonly key: string; readonly at: string; readonly owner: "studio"; readonly memo: Memo }
  | {
      readonly type: "card";
      readonly key: string;
      /** 카드가 자리 잡은 시각. 기록이 생기기 전부터 있던 커밋이면 null (맨 위) */
      readonly at: string | null;
      readonly pr: PrCardView;
      readonly commitSha: string;
      /** PR 의 지금 커밋인가. 버튼은 이 카드에만 있다 */
      readonly latest: boolean;
      /** 이 PR 의 카드가 둘 이상인가 (최신 카드에 "최신 커밋" 표시를 붙인다) */
      readonly several: boolean;
      /** 이전 커밋 카드일 때, 그 커밋에 대해 마지막으로 기록된 검사 결과. 없으면 null */
      readonly recordedChecks: ChecksState | null;
    };

export interface TimelineInput {
  readonly work: Work;
  /** 지금 이 업무에 연결된 PR 의 카드 (GitHub 의 지금 모습) */
  readonly cards: readonly PrCardView[];
  /** 이 업무의 PR 이벤트 (쌓인 순서) */
  readonly events: readonly PrEvent[];
  /** 이 업무의 상태 이력 (쌓인 순서) */
  readonly statusChanges: readonly StatusChangeView[];
  /** 이 업무의 내부 검토 결정 */
  readonly reviews: readonly ReviewDecision[];
  /** 이 업무의 메모 (쌓인 순서, 지운 메모 포함) */
  readonly memos: readonly Memo[];
  readonly repoName: (repoId: number) => string;
  /** 화면을 그리는 지금 시각 — 기록이 아직 하나도 없을 때 "지금부터" 의 기준 */
  readonly now: string;
  /** 시각이 어느 날인지 (날짜 구분선). 화면이 시간대를 정해 넘긴다. 기본은 UTC 날짜 */
  readonly dayOf?: (iso: string) => string;
}

/** 같은 시각이면 이 순서로 놓는다: 업무 생성 → PR 이벤트 → 카드 → 검토 결정 → 상태 변화 (원인이 결과보다 먼저) → 메모 */
const RANK = { work_created: 0, pr_event: 1, card: 2, review: 3, status: 4, memo: 5 } as const;

type Timed = Exclude<TimelineEntry, { type: "note" } | { type: "day" }>;

export function buildTimeline(input: TimelineInput): TimelineEntry[] {
  const dayOf = input.dayOf ?? ((iso: string) => iso.slice(0, 10));
  const timed: { entry: Timed; at: string | null; seq: number }[] = [];
  const push = (entry: Timed, at: string | null) => timed.push({ entry, at, seq: timed.length });

  push({ type: "work_created", key: `created-${input.work.id}`, at: input.work.createdAt, owner: "studio" }, input.work.createdAt);
  for (const event of input.events) {
    push({ type: "pr_event", key: `ev-${event.id}`, at: event.at, owner: eventOwner(event.kind), event, repoName: input.repoName(event.repoId) }, event.at);
  }
  for (const r of input.reviews) {
    const entry = {
      type: "review",
      key: `rev-${r.id}`,
      at: r.decidedAt,
      owner: "studio",
      repoName: input.repoName(r.repoId),
      number: r.number,
      commitSha: r.commitSha,
      verdict: r.verdict,
    } as const;
    push(entry, r.decidedAt);
  }
  input.statusChanges.forEach((change, i) => push({ type: "status", key: `st-${i}`, at: change.at, owner: "studio", change }, change.at));
  for (const memo of input.memos) push({ type: "memo", key: `memo-${memo.id}`, at: memo.createdAt, owner: "studio", memo }, memo.createdAt);

  let unrecorded = false;
  for (const pr of input.cards) {
    const commits = commitsOf(pr, input.events, input.reviews);
    if (commits.some((c) => c.from !== "event")) unrecorded = true;
    for (const c of commits) {
      const latest = c.sha === pr.headSha;
      const entry = {
        type: "card",
        key: `card-${pr.key}-${c.sha}`,
        at: c.at,
        pr,
        commitSha: c.sha,
        latest,
        several: commits.length > 1,
        recordedChecks: latest ? null : lastChecks(input.events, pr, c.sha),
      } as const;
      push(entry, c.at);
    }
  }

  // 시각 없는 카드(기록 전부터 있던 커밋)가 맨 위, 그다음 시각순. 같은 시각이면 RANK, 그래도 같으면 넣은 순서
  timed.sort((a, b) => {
    if (a.at === null || b.at === null) return a.at === b.at ? a.seq - b.seq : a.at === null ? -1 : 1;
    return a.at.localeCompare(b.at) || RANK[a.entry.type] - RANK[b.entry.type] || a.seq - b.seq;
  });

  const out: TimelineEntry[] = [];
  if (unrecorded) {
    const firstEvent = input.events.map((e) => e.at).sort()[0];
    out.push({ type: "note", key: "note", since: firstEvent ?? input.now });
  }
  let lastDay: string | null = null;
  for (const { entry, at } of timed) {
    if (at !== null) {
      const day = dayOf(at);
      if (day !== lastDay) {
        out.push({ type: "day", key: `day-${day}`, day });
        lastDay = day;
      }
    }
    out.push(entry);
  }
  return out;
}

/** 이 PR 에 대해 Studio 가 아는 커밋들 — 처음 알게 된 시각과 어디서 알았는지. 같은 커밋은 한 번만 */
function commitsOf(
  pr: PrCardView,
  events: readonly PrEvent[],
  reviews: readonly ReviewDecision[],
): { sha: string; at: string | null; from: "event" | "review" | "current" }[] {
  const found = new Map<string, { sha: string; at: string | null; from: "event" | "review" | "current" }>();
  const add = (sha: string, at: string | null, from: "event" | "review" | "current") => {
    const seen = found.get(sha);
    if (seen === undefined || (seen.at !== null && (at === null || at < seen.at))) found.set(sha, { sha, at, from });
  };
  const ref: PrRef = { repoId: pr.repoId, number: pr.number };
  for (const e of events) {
    if (!samePr(e, ref)) continue;
    if (e.kind === "linked" || e.kind === "new_commit") add(e.commitSha, e.at, "event");
  }
  for (const r of reviews) if (samePr(r, ref)) add(r.commitSha, r.decidedAt, "review");
  if (!found.has(pr.headSha)) add(pr.headSha, null, "current");
  return [...found.values()];
}

function lastChecks(events: readonly PrEvent[], pr: PrRef, sha: string): ChecksState | null {
  let checks: ChecksState | null = null;
  for (const e of events) if (e.kind === "checks" && samePr(e, pr) && e.commitSha === sha) checks = e.checks;
  return checks;
}

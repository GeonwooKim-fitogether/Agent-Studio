/**
 * Needs your attention (feature-plan F4) — Workspace 맨 위에 "지금 사람이 판단할 일" 을 모아 보인다.
 *
 * 이 모음은 **새 상태를 만들지 않는다.** 이미 있는 넷을 읽어 늘어놓기만 한다(결정 6: 예외만 사람에게 올린다).
 *   1. needs_review      업무 상태가 검토 필요인 업무 (규칙 R2 가 붙였든 사람이 골랐든)
 *   2. checks_failing    업무에 연결된 열린 PR 중 검사가 실패한 것. 업무 상태는 바꾸지 않는다(결정 14, R2 의 반례)
 *   3. outdated_preview  실행 중인 미리보기가 PR 의 최신 커밋이 아닌 이전 커밋을 보여 준다(계약 §6)
 *   4. inbox             Inbox 에서 업무 연결을 기다리는 열린 PR 이 있다 — 개수 한 줄
 * 완료 후보는 넣지 않는다(결정 16 의 4). 검사가 진행 중인 PR 도 넣지 않는다 — 기다림은 판단거리가 아니다.
 *
 * 순서는 위 번호 순서이고, 같은 종류 안에서는 Workspace 에 보이는 순서(프로젝트 → 업무 → PR)를 그대로 따른다.
 * 그래서 같은 상태에서는 언제나 같은 목록이 나온다.
 */
import { freshnessOf } from "../domain/freshness";
import { type PrRef, samePr } from "../domain/model";
import type { PreviewPhase } from "../domain/preview";
import type { PrCardView, WorkspaceView } from "./queries";

export type AttentionKind = "needs_review" | "checks_failing" | "outdated_preview" | "inbox";

/** 항목이 가리키는 PR 한 줄 */
export interface AttentionPr {
  readonly repoName: string;
  readonly number: number;
  readonly headSha: string;
}

export type AttentionItem =
  | {
      readonly kind: "needs_review";
      readonly workId: string;
      readonly workTitle: string;
      /** 아직 판단하지 않은, 검사가 끝난 열린 PR. 사람이 손으로 검토 필요를 골라 그런 PR 이 없으면 null */
      readonly pr: AttentionPr | null;
    }
  | { readonly kind: "checks_failing"; readonly workId: string; readonly workTitle: string; readonly pr: AttentionPr }
  | {
      readonly kind: "outdated_preview";
      readonly workId: string;
      readonly workTitle: string;
      readonly pr: AttentionPr;
      /** 미리보기가 실제로 돌고 있는 커밋 */
      readonly previewCommitSha: string;
    }
  | { readonly kind: "inbox"; readonly count: number };

/** 실행기가 지금 들고 있는 미리보기 (PreviewSession 에서 필요한 칸만) */
export interface RunningPreview {
  readonly target: PrRef & { readonly commitSha: string };
  readonly phase: PreviewPhase;
}

const toPr = (card: PrCardView): AttentionPr => ({ repoName: card.repoName, number: card.number, headSha: card.headSha });

/** 검사가 끝났고(통과 또는 검사 없음) 최신 커밋에 대한 내부 검토 결정이 아직 없는 열린 PR — R2 가 "사람이 볼 차례" 로 읽는 것 */
function awaitsDecision(card: PrCardView): boolean {
  return (
    card.github.state === "open" &&
    (card.github.checks === "passing" || card.github.checks === "none") &&
    !card.studio.reviews.some((r) => r.freshness === "current")
  );
}

/** Workspace 의 모양과 실행 중인 미리보기에서 판단할 일을 모은다. 저장소나 GitHub 에 묻지 않는 순수 함수다. */
export function collectAttention(view: WorkspaceView, preview: RunningPreview | null): AttentionItem[] {
  const works = view.projects.flatMap((p) => p.works);
  const needsReview: AttentionItem[] = [];
  const checksFailing: AttentionItem[] = [];
  const outdatedPreview: AttentionItem[] = [];

  for (const { work, prs } of works) {
    if (work.status === "needs_review") {
      const waiting = prs.find(awaitsDecision);
      needsReview.push({ kind: "needs_review", workId: work.id, workTitle: work.title, pr: waiting === undefined ? null : toPr(waiting) });
    }
    for (const card of prs) {
      if (card.github.state === "open" && card.github.checks === "failing") {
        checksFailing.push({ kind: "checks_failing", workId: work.id, workTitle: work.title, pr: toPr(card) });
      }
      // "실행 중인" 미리보기만 본다. 준비 중이거나 실패 · 종료된 것은 열어 볼 화면이 없으니 검토 근거로 오해될 일도 없다
      if (preview !== null && preview.phase === "running" && samePr(preview.target, card) && freshnessOf(preview.target, card.headSha) === "outdated") {
        outdatedPreview.push({
          kind: "outdated_preview",
          workId: work.id,
          workTitle: work.title,
          pr: toPr(card),
          previewCommitSha: preview.target.commitSha,
        });
      }
    }
  }

  const inbox: AttentionItem[] = view.inboxCount > 0 ? [{ kind: "inbox", count: view.inboxCount }] : [];
  return [...needsReview, ...checksFailing, ...outdatedPreview, ...inbox];
}

import type { PreviewCardView } from "../../application/preview";
import type { ChecksState, GitHubReviewState, PrState } from "../../domain/model";
import { Icon, type IconName } from "./glyph";
import { CHECKS, GITHUB_REVIEW, PR_STATE, PREVIEW_HOST_OFFLINE } from "./labels";
import { previewSummary } from "./preview-status";

/**
 * GitHub 상태의 아이콘 줄 (결정 19, 시안 v3 "사실 하나는 한 자리에만"). 칸은 늘 네 개이고 순서가 고정이다 —
 * [PR 상태 · 검사 · 리뷰 · 미리보기]. 정상 상태도 그린다(칸이 빠지면 무엇이 빠졌는지 읽는 사람이 세어야 한다).
 * Work details 의 PR 목록은 미리보기 칸을 뺀 세 칸이다(미리보기는 PR 이 아니라 기기의 속성이라).
 *
 * 상태는 아이콘과 색으로만 보인다. 낱말(Open · Checks failing · Changes requested …)은 마우스를 올리면 보이는 title 과
 * 화면 읽기 프로그램용 글자(sr-only)로만 둔다 — 같은 낱말을 카드 · 패널 · 목록마다 되풀이하지 않기 위해서다.
 * 색은 globals.css 의 값만 쓴다(.st.*).
 */

export interface GitHubState {
  readonly state: PrState;
  readonly checks: ChecksState;
  readonly review: GitHubReviewState;
}

/** 미리보기 칸의 네 모습. 무엇이 돌고 있는지(커밋)는 title 에만 있다 */
export type PreviewSlot = "running" | "outdated" | "offline" | "none";

export function previewSlotOf(view: PreviewCardView | undefined): PreviewSlot {
  if (view === undefined) return "none";
  const { session, availability } = view;
  if (session !== null && session.phase === "running") return session.freshness === "outdated" ? "outdated" : "running";
  if (session !== null && session.busy) return "none";
  return availability.kind === "runner_offline" ? "offline" : "none";
}

type Tone = "ink" | "ok" | "fail" | "merged" | "off" | "wait";

interface Slot {
  readonly slot: "state" | "checks" | "review" | "preview";
  readonly icon: IconName;
  readonly tone: Tone;
  readonly label: string;
  readonly value: string;
}

const STATE_ICON: Record<PrState, { icon: IconName; tone: Tone }> = {
  open: { icon: "prOpen", tone: "ink" },
  merged: { icon: "prMerged", tone: "merged" },
  closed: { icon: "prClosed", tone: "fail" },
};
const CHECKS_ICON: Record<ChecksState, { icon: IconName; tone: Tone }> = {
  passing: { icon: "checksPassing", tone: "ok" },
  failing: { icon: "checksFailing", tone: "fail" },
  pending: { icon: "checksPending", tone: "wait" },
  none: { icon: "dash", tone: "off" },
};
const REVIEW_ICON: Record<GitHubReviewState, { icon: IconName; tone: Tone }> = {
  approved: { icon: "reviewApproved", tone: "ok" },
  changes_requested: { icon: "reviewChanges", tone: "fail" },
  none: { icon: "reviewNone", tone: "off" },
};
const PREVIEW_ICON: Record<PreviewSlot, { icon: IconName; tone: Tone }> = {
  running: { icon: "monitor", tone: "ok" },
  outdated: { icon: "monitor", tone: "fail" },
  offline: { icon: "monitorOff", tone: "off" },
  none: { icon: "monitor", tone: "off" },
};

/** 한 칸의 아이콘 — 제목(title)과 화면 읽기용 낱말이 같다 */
export function StateIcon({ icon, tone, label, testId, slot, value }: { icon: IconName; tone: Tone; label: string; testId?: string; slot?: string; value?: string }) {
  return (
    <span className={`st ${tone}`} title={label} data-testid={testId} data-slot={slot} data-value={value}>
      <Icon name={icon} />
      <span className="sr-only">{label}</span>
    </span>
  );
}

/**
 * 아이콘 줄. github-status 는 앞 세 칸(GitHub 가 알려 준 것), preview-status 는 네 번째 칸(Studio 의 미리보기 기기)이다 —
 * 둘의 출처가 다르다는 것은 화면 읽기용 머리글(GitHub · Preview)로 남긴다.
 */
export function PrIcons({
  github,
  preview,
  withPreview = true,
  checksNote,
  lead,
}: {
  github: GitHubState;
  /** 이 PR 의 미리보기 상태. 없으면 빈 칸(회색)이다 */
  preview?: PreviewCardView | undefined;
  /** Work details 의 PR 목록은 false (세 칸) */
  withPreview?: boolean;
  /** 검사 칸의 title 뒤에 붙일 한 구절 (예: "작성자가 고칠 차례") */
  checksNote?: string;
  /** 줄 맨 앞의 구분선 (카드의 `#12 · 최신 커밋` 뒤처럼 글자 옆에 붙을 때) */
  lead?: boolean;
}) {
  const slots: Slot[] = [
    { slot: "state", ...STATE_ICON[github.state], label: PR_STATE[github.state], value: github.state },
    {
      slot: "checks",
      ...CHECKS_ICON[github.checks],
      label: checksNote === undefined ? CHECKS[github.checks] : `${CHECKS[github.checks]} — ${checksNote}`,
      value: github.checks,
    },
    { slot: "review", ...REVIEW_ICON[github.review], label: GITHUB_REVIEW[github.review], value: github.review },
  ];
  const previewSlot = previewSlotOf(preview);
  const previewLabel = previewSlot === "offline" ? PREVIEW_HOST_OFFLINE : `Preview: ${previewSummary(preview).text}`;
  return (
    <span className="st-row" data-testid="pr-icons">
      {lead === true && <span className="st-sep" aria-hidden="true" />}
      <span className="st-group" data-testid="github-status">
        <span className="sr-only">GitHub:</span>
        {slots.map((s) => (
          <StateIcon key={s.slot} icon={s.icon} tone={s.tone} label={s.label} slot={s.slot} value={s.value} />
        ))}
      </span>
      {withPreview && (
        <StateIcon {...PREVIEW_ICON[previewSlot]} label={previewLabel} testId="preview-status" slot="preview" value={previewSlot} />
      )}
    </span>
  );
}

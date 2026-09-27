import type { SourceReport } from "../../ports/github-reader";

/**
 * 출처별 상태 (두 GitHub 출처를 함께 읽을 때, 결정 12). 화면 위쪽 띠에 출처마다 한 줄로 보인다.
 * 예: "GitHub App: 저장소 3 · PR 12" / "Token (fitogether-org): 실패 — 인증이 거절됐다 …"
 */
export function SourceStatusList({ sources }: { sources: readonly SourceReport[] }) {
  return sources.map((s) => (
    <span key={s.label} className={s.error === null ? undefined : "source-error"} data-testid="source-status">
      {sourceStatusText(s)}
    </span>
  ));
}

export function sourceStatusText(s: SourceReport): string {
  return `${s.label}: ${s.error === null ? `저장소 ${s.repositories} · PR ${s.pullRequests}` : `실패 — ${s.error}`}`;
}

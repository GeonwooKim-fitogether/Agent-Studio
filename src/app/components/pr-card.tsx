import type { ReactNode } from "react";
import type { PrCardView } from "../../application/queries";
import type { DataSource } from "../../ports/github-reader";
import { Icon } from "./glyph";
import { CHECKS } from "./labels";

/** 저장소 이름에서 소유자(`owner/`)를 뗀 짧은 이름. 프로젝트 제목 아래에 있으므로 소유자는 반복하지 않는다 */
export const shortRepoName = (fullName: string) => fullName.slice(fullName.lastIndexOf("/") + 1);

/**
 * Inbox 항목 (결정 18 — Focus 시안의 밀도). 왼쪽 아이콘 원, 눈썹 `Unassigned PR`, 제목 한 줄, 그 아래 `저장소 · #번호 · 검사 상태` 한 줄, 오른쪽에 행동 하나.
 * 상태 칩 줄 · 브랜치 · 커밋은 두지 않는다 — 여기서 내릴 결정(어느 업무의 PR 인가)에 필요하지 않다. 그것은 업무 화면의 카드에 있다.
 * GitHub 로 가는 링크는 진짜 GitHub 에서 읽었을 때만 둔다. 고정 데이터의 주소는 실재하지 않기 때문이다.
 */
export function InboxCard({ pr, source, reason, actions }: { pr: PrCardView; source: DataSource; reason: string | null; actions: ReactNode }) {
  return (
    <article className="pr-card" data-testid={`pr-card-${pr.repoId}-${pr.number}`}>
      <span className="status-icon" aria-hidden="true">
        <Icon name="branch" />
      </span>
      <div className="grow">
        <span className="eyebrow pr-eyebrow">Unassigned PR</span>
        <b className="pr-title">{pr.title}</b>
        <small className="pr-meta">
          {shortRepoName(pr.repoName)} · #{pr.number} · <span className={`checks-${pr.github.checks}`}>{CHECKS[pr.github.checks]}</span>
          {source !== "fixture" && (
            <>
              {" "}
              ·{" "}
              <a className="pr-link" href={pr.url} target="_blank" rel="noreferrer">
                Open on GitHub
              </a>
            </>
          )}
        </small>
        {reason !== null && (
          <small className="pr-reason" data-testid="inbox-reason">
            {reason}
          </small>
        )}
      </div>
      {actions}
    </article>
  );
}

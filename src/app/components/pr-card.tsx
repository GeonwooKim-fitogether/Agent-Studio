import type { PrCardView } from "../../application/queries";
import type { DataSource } from "../../ports/github-reader";
import { CHECKS, GITHUB_REVIEW, LINK_ORIGIN, PR_STATE, shortSha, VERDICT } from "./labels";

/**
 * PR 카드. GitHub 의 상태와 Studio 의 상태를 서로 다른 줄에 둔다 — 한 문장으로 합치지 않는다 (계약 §5).
 * GitHub 로 가는 링크는 진짜 GitHub 에서 읽었을 때만 둔다. 고정 데이터의 주소는 실재하지 않기 때문이다.
 */
export function PrCard({ pr, source }: { pr: PrCardView; source: DataSource }) {
  const { github, studio } = pr;
  return (
    <article className="pr-card" data-testid={`pr-card-${pr.repoId}-${pr.number}`}>
      <header className="pr-head">
        <strong className="pr-id">
          {pr.repoName}#{pr.number}
        </strong>
        <span className="pr-title">{pr.title}</span>
        {source === "github" && (
          <a className="pr-link" href={pr.url} target="_blank" rel="noreferrer">
            Open on GitHub
          </a>
        )}
      </header>
      <p className="pr-meta">
        <code>{pr.branch}</code> · head <code>{shortSha(pr.headSha)}</code>
      </p>
      <dl className="state-rows">
        <div className="state-row" data-testid="github-status">
          <dt>GitHub</dt>
          <dd>
            <span className={`chip pr-${github.state}`}>{PR_STATE[github.state]}</span>
            <span className={`chip checks-${github.checks}`}>{CHECKS[github.checks]}</span>
            <span className="chip">{GITHUB_REVIEW[github.review]}</span>
          </dd>
        </div>
        <div className="state-row" data-testid="studio-status">
          <dt>Studio</dt>
          <dd>
            <span className="chip">{studio.linkOrigin ? LINK_ORIGIN[studio.linkOrigin] : "Not linked"}</span>
            {studio.reviews.length === 0 && studio.linkOrigin && <span className="chip quiet">No internal review</span>}
            {studio.reviews.map((r) => (
              <span key={r.id} className={`chip ${r.freshness}`} data-testid="review-decision" data-freshness={r.freshness}>
                {VERDICT[r.verdict]}
                {r.freshness === "outdated"
                  ? ` · 이전 버전 (커밋 ${shortSha(r.commitSha)} 에 대한 결정)`
                  : ` · 최신 커밋 ${shortSha(r.commitSha)}`}
              </span>
            ))}
            {studio.previews.map((p) => (
              <span key={p.id} className={`chip ${p.freshness}`} data-testid="preview-record" data-freshness={p.freshness}>
                Preview {shortSha(p.commitSha)}
                {p.freshness === "outdated" ? " · 이전 버전" : " · 최신 커밋"}
              </span>
            ))}
          </dd>
        </div>
      </dl>
    </article>
  );
}

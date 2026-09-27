import Link from "next/link";
import { collectAttention } from "../application/attention";
import { getWorkspace } from "../application/queries";
import { getContainer } from "../server/container";
import { NeedsYourAttention } from "./components/attention";
import { PrCard, StateLegend } from "./components/pr-card";
import { StatusBadge, StatusHistoryLine } from "./components/work-status";

export const dynamic = "force-dynamic";

/**
 * Workspace — 맨 위에 판단할 일(Needs your attention), 그 아래 프로젝트별 업무와 각 업무에 연결된 PR 카드.
 * 연결되지 않은 PR 은 Inbox 에 있고, 그 개수가 Needs your attention 의 한 줄로 보인다.
 */
export default async function WorkspacePage() {
  const container = getContainer();
  await container.ensureSynced();
  const view = await getWorkspace(container.deps);
  const attention = collectAttention(view, container.preview.current());
  const source = container.deps.reader.source;
  const hasCards = view.projects.some((p) => p.works.some((w) => w.prs.length > 0));

  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>Workspace</h1>
        <p className="muted">업무마다 연결된 PR 과 먼저 볼 일을 본다.</p>
      </div>

      <NeedsYourAttention items={attention} />

      {hasCards && <StateLegend />}

      {view.projects.map(({ project, repositories, works }) => (
        <section key={project.id} className="project" data-testid={`project-${project.id}`}>
          <header className="section-header">
            <h2>{project.name}</h2>
            <small>{repositories.map((r) => r.fullName).join(", ")}</small>
          </header>
          {works.length === 0 && <p className="empty-note">업무가 아직 없다. Inbox 에서 PR 로 새 업무를 만들 수 있다.</p>}
          {works.map((summary) => {
            const { work, prs } = summary;
            return (
            <article key={work.id} className="work-row" data-testid={`work-${work.id}`}>
              <div className="work-row-head">
                <Link href={`/works/${work.id}`} className="work-title">
                  {work.title}
                </Link>
                <StatusBadge status={work.status} />
              </div>
              <StatusHistoryLine summary={summary} />
              {prs.length === 0 ? (
                <p className="empty-note">연결된 PR 없음</p>
              ) : (
                <div className="pr-list">
                  {prs.map((pr) => (
                    <PrCard key={pr.key} pr={pr} source={source} />
                  ))}
                </div>
              )}
            </article>
            );
          })}
        </section>
      ))}
    </div>
  );
}

import Link from "next/link";
import { getWorkspace } from "../application/queries";
import { getContainer } from "../server/container";
import { WORK_STATUS } from "./components/labels";
import { PrCard } from "./components/pr-card";

export const dynamic = "force-dynamic";

/** Workspace — 프로젝트별 업무와, 각 업무에 연결된 PR 카드. 연결되지 않은 PR 은 Inbox 에 있다. */
export default async function WorkspacePage() {
  const container = getContainer();
  await container.ensureSynced();
  const view = await getWorkspace(container.deps);
  const source = container.deps.reader.source;

  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>Workspace</h1>
        <p className="muted">프로젝트마다 업무와 연결된 PR 을 본다.</p>
      </div>

      <section className={view.inboxCount > 0 ? "attention" : "attention empty"} data-testid="inbox-summary">
        <div>
          <p className="eyebrow">Inbox</p>
          <h2>
            <span data-testid="inbox-count">{view.inboxCount}</span>개 PR 이 업무 연결을 기다린다
          </h2>
          <p className="muted">어느 업무의 것인지 확실하지 않은 PR 은 자동으로 붙이지 않고 Inbox 에 둔다.</p>
        </div>
        <Link href="/inbox" className="btn primary">
          Open Inbox
        </Link>
      </section>

      {view.projects.map(({ project, repositories, works }) => (
        <section key={project.id} className="project" data-testid={`project-${project.id}`}>
          <header className="section-header">
            <h2>{project.name}</h2>
            <small>{repositories.map((r) => r.fullName).join(", ")}</small>
          </header>
          {works.length === 0 && <p className="empty-note">업무가 아직 없다. Inbox 에서 PR 로 새 업무를 만들 수 있다.</p>}
          {works.map(({ work, prs }) => (
            <article key={work.id} className="work-row" data-testid={`work-${work.id}`}>
              <div className="work-row-head">
                <Link href={`/works/${work.id}`} className="work-title">
                  {work.title}
                </Link>
                <span className={`status status-${work.status}`}>{WORK_STATUS[work.status]}</span>
              </div>
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
          ))}
        </section>
      ))}
    </div>
  );
}

import Link from "next/link";
import { collectAttention } from "../application/attention";
import { getWorkspace } from "../application/queries";
import { getContainer } from "../server/container";
import type { NewWorkProblem } from "../application/new-work";
import { NeedsYourAttention } from "./components/attention";
import { NEW_WORK_PROBLEM } from "./components/labels";
import { NewWorkButton, NewWorkCreated, NewWorkForm } from "./components/new-work";
import { PrCard, StateLegend } from "./components/pr-card";
import { StatusBadge, StatusHistoryLine } from "./components/work-status";

export const dynamic = "force-dynamic";

/**
 * Workspace — 맨 위에 판단할 일(Needs your attention), 그 아래 프로젝트별 업무와 각 업무에 연결된 PR 카드.
 * 연결되지 않은 PR 은 Inbox 에 있고, 그 개수가 Needs your attention 의 한 줄로 보인다.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
const isNewWorkProblem = (value: string | null): value is NewWorkProblem => value !== null && Object.hasOwn(NEW_WORK_PROBLEM, value);

export default async function WorkspacePage({ searchParams }: { searchParams: SearchParams }) {
  const query = await searchParams;
  const container = getContainer();
  await container.ensureSynced();
  const view = await getWorkspace(container.deps);
  const attention = collectAttention(view, container.preview.current());
  const source = container.deps.reader.source;
  const hasCards = view.projects.some((p) => p.works.some((w) => w.prs.length > 0));
  // New Work 의 두 모습 — 폼(?newWork=1), 만든 결과(?created=<업무 ID>). 결과 주소의 업무가 없으면(오래된 주소) 아무것도 보이지 않는다
  const createdId = one(query["created"]);
  const created = view.projects.flatMap((p) => p.works.map((w) => ({ work: w.work, projectName: p.project.name }))).find((w) => w.work.id === createdId);
  const formOpen = one(query["newWork"]) === "1" && view.projects.length > 0;
  const problem = one(query["problem"]);

  return (
    <div className="page-inner">
      <div className="page-head split">
        <div>
          <h1>Workspace</h1>
          <p className="muted">업무마다 연결된 PR 과 먼저 볼 일을 본다.</p>
        </div>
        {!formOpen && created === undefined && <NewWorkButton hasProjects={view.projects.length > 0} />}
      </div>

      {formOpen && (
        <NewWorkForm
          projects={view.projects.map((p) => p.project)}
          problem={isNewWorkProblem(problem) ? problem : null}
          projectId={one(query["project"])}
        />
      )}
      {created !== undefined && <NewWorkCreated work={created.work} projectName={created.projectName} />}

      <NeedsYourAttention items={attention} />

      {hasCards && <StateLegend />}

      {view.projects.map(({ project, repositories, works }) => (
        <section key={project.id} className="project" data-testid={`project-${project.id}`}>
          <header className="section-header">
            <h2>{project.name}</h2>
            <small>{repositories.map((r) => r.fullName).join(", ")}</small>
          </header>
          {works.length === 0 && <p className="empty-note">업무가 아직 없다. 위의 New Work 로 빈 업무를 만들거나, Inbox 에서 PR 로 새 업무를 만들 수 있다.</p>}
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
                <p className="empty-note">
                  연결된 PR 없음 · 표식 <code>{summary.marker}</code> 을 PR 에 넣으면 붙는다
                </p>
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

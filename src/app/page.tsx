import { collectAttention } from "../application/attention";
import { attentionRows, isOtherWorkFilter, workspaceFocus } from "../application/focus";
import type { NewWorkProblem } from "../application/new-work";
import { getPreviewCards } from "../application/preview";
import { getWorkspace } from "../application/queries";
import { getContainer } from "../server/container";
import { NEW_WORK_PROBLEM } from "./components/labels";
import { NewWorkButton, NewWorkCreated, NewWorkForm } from "./components/new-work";
import { Topbar } from "./components/topbar";
import { NeedsYourAttention, OtherWork, UpNext, type WorkspaceQuery } from "./components/workspace";

export const dynamic = "force-dynamic";

/**
 * Workspace (결정 18, Q5) — 여러 프로젝트에서 **지금 판단할 업무와 다음 행동**을 먼저 보인다.
 * 왼쪽 위 Needs your attention(업무 하나에 한 줄), 그 아래 Other work(attention 에 없는 업무만), 오른쪽 Up next(고른 업무 하나).
 * 같은 업무를 카드와 목록에 반복하지 않는다. PR 카드 전체는 업무 화면에 있다.
 *
 * 주소 파라미터: ?project=<프로젝트 ID>(사이드바의 Projects 와 같다) · ?filter=open|done_candidate|done · ?focus=<업무 ID>
 * 그리고 New Work 의 두 모습 — 폼(?newWork=1), 만든 결과(?created=<업무 ID>). 모두 자바스크립트 없이 동작한다.
 */
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : null);
const isNewWorkProblem = (value: string | null): value is NewWorkProblem => value !== null && Object.hasOwn(NEW_WORK_PROBLEM, value);

export default async function WorkspacePage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const container = getContainer();
  await container.ensureSynced();
  const view = await getWorkspace(container.deps);
  const rows = attentionRows(collectAttention(view, container.preview.current()), view);
  const projectParam = one(params["project"]);
  const filterParam = one(params["filter"]);
  const query: WorkspaceQuery = {
    filter: isOtherWorkFilter(filterParam) ? filterParam : "open",
    projectId: view.projects.some((p) => p.project.id === projectParam) ? projectParam : null,
    focusId: one(params["focus"]),
  };
  const focus = workspaceFocus(view, rows, query);
  const focusSummary = focus.focus === null ? null : (view.projects.flatMap((p) => p.works).find((w) => w.work.id === focus.focus?.workId) ?? null);
  const focusPr = focusSummary?.prs.find((p) => p.github.state === "open") ?? focusSummary?.prs[0];
  const previews = focusPr === undefined ? new Map() : await getPreviewCards(container.deps, container.preview, [focusPr]);

  // New Work 의 두 모습. 결과 주소의 업무가 없으면(오래된 주소) 아무것도 보이지 않는다
  const createdId = one(params["created"]);
  const created = view.projects.flatMap((p) => p.works.map((w) => ({ work: w.work, projectName: p.project.name }))).find((w) => w.work.id === createdId);
  const formOpen = one(params["newWork"]) === "1" && view.projects.length > 0;
  const problem = one(params["problem"]);
  const workCount = focus.attention.filter((r) => r.kind === "work").length;
  const projectName = view.projects.find((p) => p.project.id === query.projectId)?.project.name;

  return (
    <>
      <Topbar crumbs={projectName === undefined ? ["Workspace"] : [<a key="w" href="/">Workspace</a>, projectName]} />
      <div className="content">
        <div className="pageheading">
          <div>
            <h1>Workspace</h1>
            <p data-testid="workspace-lead">
              {projectName !== undefined && <b>{projectName} · </b>}
              {workCount === 0 ? "지금 판단할 업무가 없다." : `${workCount}개의 업무에 다음 결정이 필요하다.`}
            </p>
          </div>
          {!formOpen && created === undefined && <NewWorkButton hasProjects={view.projects.length > 0} />}
        </div>

        {formOpen && (
          <NewWorkForm
            projects={view.projects.map((p) => p.project)}
            problem={isNewWorkProblem(problem) ? problem : null}
            projectId={one(params["project"])}
          />
        )}
        {created !== undefined && <NewWorkCreated work={created.work} projectName={created.projectName} />}

        <div className="workspace-grid">
          <div className="workspace-main">
            <NeedsYourAttention view={focus} query={query} />
            <OtherWork view={focus} query={query} projects={view.projects.map((p) => ({ id: p.project.id, name: p.project.name }))} />
          </div>
          <UpNext focus={focus.focus} summary={focusSummary} preview={focusPr === undefined ? undefined : previews.get(focusPr.key)} />
        </div>
      </div>
    </>
  );
}

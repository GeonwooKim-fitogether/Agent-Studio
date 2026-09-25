import { getInbox } from "../../application/queries";
import { getContainer } from "../../server/container";
import { linkToWorkAction, newWorkFromPrAction } from "../actions";
import { inboxReasonText } from "../components/labels";
import { PrCard } from "../components/pr-card";

export const dynamic = "force-dynamic";

/** Inbox — 어느 업무의 것인지 판단할 수 없는 PR. 사람이 기존 업무에 연결하거나 새 업무를 만든다. */
export default async function InboxPage() {
  const container = getContainer();
  await container.ensureSynced();
  const view = await getInbox(container.deps);
  const source = container.deps.reader.source;

  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>Inbox</h1>
        <p className="muted">표식이 없거나 모호한 PR 이다. 같은 프로젝트의 업무에 연결하거나, 그 PR 로 새 업무를 만든다.</p>
      </div>

      {view.total === 0 && <p className="empty-note" data-testid="inbox-empty">연결을 기다리는 PR 이 없다.</p>}

      {view.groups.map(({ project, candidates, items }) => (
        <section key={project.id} className="project" data-testid={`inbox-project-${project.id}`}>
          <header className="section-header">
            <h2>{project.name}</h2>
            <small>{items.length}개</small>
          </header>
          {items.map(({ pr, reason, markedWorkIds }) => (
            <article key={pr.key} className="inbox-item" data-testid={`inbox-${pr.repoId}-${pr.number}`}>
              <PrCard pr={pr} source={source} />
              <p className="reason">{inboxReasonText(reason, markedWorkIds)}</p>
              <div className="inbox-actions">
                {candidates.length > 0 && (
                  <form action={linkToWorkAction} className="inline-form">
                    <input type="hidden" name="repoId" value={pr.repoId} />
                    <input type="hidden" name="number" value={pr.number} />
                    <label>
                      <span>Work</span>
                      <select name="workId" required defaultValue="">
                        <option value="" disabled>
                          업무 선택
                        </option>
                        {candidates.map((w) => (
                          <option key={w.id} value={w.id}>
                            {w.title}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="submit" className="btn primary">
                      Link to Work
                    </button>
                  </form>
                )}
                <form action={newWorkFromPrAction} className="inline-form">
                  <input type="hidden" name="repoId" value={pr.repoId} />
                  <input type="hidden" name="number" value={pr.number} />
                  <button type="submit" className="btn">
                    New Work
                  </button>
                </form>
              </div>
            </article>
          ))}
        </section>
      ))}
    </div>
  );
}

import Link from "next/link";
import { getInbox, getPrNotice } from "../../application/queries";
import { type PrRef, type StudioErrorCode } from "../../domain/model";
import { markerFor } from "../../domain/work-marker";
import { getContainer } from "../../server/container";
import { linkToWorkAction, newWorkFromPrAction } from "../actions";
import { inboxReasonText } from "../components/labels";
import { PrCard, StateLegend } from "../components/pr-card";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

const NOTICE_CODES: readonly StudioErrorCode[] = ["already_linked", "project_mismatch", "not_found", "not_linked", "invalid_input"];

/** Inbox — 어느 업무의 것인지 판단할 수 없는 PR. 사람이 기존 업무에 연결하거나 새 업무를 만든다. */
export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
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

      <Notice searchParams={await searchParams} />

      <p className="hint" data-testid="marker-hint">
        PR 본문이나 브랜치 이름에 업무 표식(<code>studio-work-…</code>)을 앞뒤를 띄어 넣으면 다음 Sync 에서 그 업무에 자동으로 연결된다. 각 업무의
        표식은 아래 Work 선택지와 업무 화면에 있다.
      </p>

      {view.total === 0 ? (
        <p className="empty-note" data-testid="inbox-empty">
          연결을 기다리는 PR 이 없다.
        </p>
      ) : (
        <StateLegend />
      )}

      {view.groups.map(({ project, candidates, items }) => (
        <section key={project.id} className="project" data-testid={`inbox-project-${project.id}`}>
          <header className="section-header">
            <h2>{project.name}</h2>
            <small>{items.length}개</small>
          </header>
          {items.map(({ pr, reason, markedWorkIds, markedProjectName }) => (
            <article key={pr.key} className="inbox-item" data-testid={`inbox-${pr.repoId}-${pr.number}`}>
              <PrCard pr={pr} source={source} />
              <p className="reason">{inboxReasonText(reason, markedWorkIds, markedProjectName)}</p>
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
                            {w.title} · {markerFor(w.id)}
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

/** 서버 액션이 거절한 뒤 보여 주는 사유. 문장은 주소에서 받지 않고, 코드와 PR 로 지금 상태를 다시 읽어 만든다. */
async function Notice({ searchParams }: { searchParams: Awaited<SearchParams> }) {
  const code = NOTICE_CODES.find((c) => c === searchParams["notice"]);
  if (code === undefined) return null;
  const repoId = Number(searchParams["repoId"]);
  const number = Number(searchParams["number"]);
  const ref: PrRef | null = Number.isSafeInteger(repoId) && Number.isSafeInteger(number) ? { repoId, number } : null;
  const pr = ref === null ? undefined : await getPrNotice(getContainer().deps, ref);
  const label = pr === undefined ? "이 PR" : `이 PR(${pr.repoName}#${pr.number})`;

  let body;
  switch (code) {
    case "already_linked":
      body =
        pr?.linkedWork != null ? (
          <>
            {label}은 이미 &apos;{pr.linkedWork.title}&apos; 업무에 연결돼 있어 처리하지 않았다.{" "}
            <Link href={`/works/${pr.linkedWork.id}`}>Open work</Link>
          </>
        ) : (
          <>{label}은 이미 다른 업무에 연결돼 있어 처리하지 않았다.</>
        );
      break;
    case "project_mismatch":
      body = <>{label}은 다른 프로젝트의 업무에 연결할 수 없다. 같은 프로젝트의 업무를 고르거나 New Work 로 새 업무를 만든다.</>;
      break;
    case "not_found":
      body = <>그 PR 이나 업무를 찾을 수 없다. 화면이 오래됐을 수 있으니 Sync 한 뒤 다시 시도한다.</>;
      break;
    default:
      body = <>요청 값이 올바르지 않아 처리하지 않았다.</>;
  }
  return (
    <div className="notice" role="status" data-testid="inbox-notice">
      {body}
    </div>
  );
}

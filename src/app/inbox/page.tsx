import Link from "next/link";
import { getInbox, getPrNotice } from "../../application/queries";
import { isValidPrRef, type PrRef, type StudioErrorCode } from "../../domain/model";
import { markerFor } from "../../domain/work-marker";
import { getContainer } from "../../server/container";
import { linkToWorkAction, newWorkFromPrAction } from "../actions";
import { inboxReasonText } from "../components/labels";
import { InboxCard } from "../components/pr-card";
import { Topbar } from "../components/topbar";

export const dynamic = "force-dynamic";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

/** 주소로 받을 수 있는 알림 코드. 거절 사유(StudioErrorCode)와, 성공 알림 unlinked 뿐이다. */
const NOTICE_CODES: readonly (StudioErrorCode | "unlinked")[] = [
  "unlinked",
  "already_linked",
  "project_mismatch",
  "not_found",
  "not_linked",
  "invalid_input",
];

/**
 * Inbox — 어느 업무의 것인지 판단할 수 없는 PR. 사람이 기존 업무에 연결하거나 새 업무를 만든다.
 * 규칙 설명은 화면에 늘어놓지 않는다(결정 18). 표식으로 자동 연결되는 방법은 머리의 작은 "?" 를 펼쳐야 보인다.
 */
export default async function InboxPage({ searchParams }: { searchParams: SearchParams }) {
  const container = getContainer();
  await container.ensureSynced();
  const view = await getInbox(container.deps);
  const source = container.deps.reader.source;

  return (
    <>
      <Topbar crumbs={["Inbox"]} />
      <div className="content">
        <div className="pageheading">
          <div>
            <h1>Inbox</h1>
            <p>
              어느 업무의 것인지 확인이 필요한 PR 이다.
              {view.closedUnlinkedCount > 0 && (
                <span className="closed-count" data-testid="closed-unlinked-count">
                  {" "}
                  닫히거나 병합된 PR {view.closedUnlinkedCount}개는 목록에 없다.
                </span>
              )}
            </p>
          </div>
          <span className="pill" data-testid="inbox-total">
            {view.total} unresolved
          </span>
        </div>

        <Notice searchParams={await searchParams} />

        {view.total === 0 ? (
          <p className="empty-note" data-testid="inbox-empty">
            연결을 기다리는 PR 이 없다.
          </p>
        ) : (
          <details className="help" data-testid="marker-hint">
            <summary aria-label="How PRs link automatically">?</summary>
            <p>
              PR 본문이나 브랜치 이름에 업무 표식(<code>studio-work-…</code>)을 앞뒤를 띄어 넣으면 다음 Sync 에서 그 업무에 자동으로 연결된다. 표식은 Work
              선택지와 업무 화면에 있다.
            </p>
          </details>
        )}

        {view.groups.map(({ project, candidates, items }) => (
          <section key={project.id} className="project" data-testid={`inbox-project-${project.id}`}>
            <div className="section-head">
              <h2>
                {project.name} <small className="counter">{items.length}</small>
              </h2>
            </div>
            {items.map(({ pr, reason, markedWorkIds, markedProjectName, unlinkedFromWorkTitle }) => (
              <div key={pr.key} className="inbox-item" data-testid={`inbox-${pr.repoId}-${pr.number}`}>
                <InboxCard
                  pr={pr}
                  source={source}
                  reason={inboxReasonText(reason, markedWorkIds, markedProjectName, unlinkedFromWorkTitle)}
                  actions={
                    <div className="inbox-actions">
                      {candidates.length > 0 ? (
                        <>
                          <form action={linkToWorkAction} className="inline-form">
                            <input type="hidden" name="repoId" value={pr.repoId} />
                            <input type="hidden" name="number" value={pr.number} />
                            <select name="workId" required defaultValue="" aria-label="Work">
                              <option value="" disabled>
                                업무 선택
                              </option>
                              {candidates.map((w) => (
                                <option key={w.id} value={w.id}>
                                  {w.title} · {markerFor(w.id)}
                                </option>
                              ))}
                            </select>
                            <button type="submit" className="btn primary">
                              Link to Work
                            </button>
                          </form>
                          <form action={newWorkFromPrAction} className="inline-form">
                            <input type="hidden" name="repoId" value={pr.repoId} />
                            <input type="hidden" name="number" value={pr.number} />
                            <button type="submit" className="btn text">
                              New Work
                            </button>
                          </form>
                        </>
                      ) : (
                        <form action={newWorkFromPrAction} className="inline-form">
                          <input type="hidden" name="repoId" value={pr.repoId} />
                          <input type="hidden" name="number" value={pr.number} />
                          <button type="submit" className="btn primary">
                            New Work
                          </button>
                        </form>
                      )}
                    </div>
                  }
                />
              </div>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}

/** 서버 액션이 거절한 뒤 보여 주는 사유. 문장은 주소에서 받지 않고, 코드와 PR 로 지금 상태를 다시 읽어 만든다. */
async function Notice({ searchParams }: { searchParams: Awaited<SearchParams> }) {
  const code = NOTICE_CODES.find((c) => c === searchParams["notice"]);
  if (code === undefined) return null;
  const candidate = { repoId: Number(searchParams["repoId"]), number: Number(searchParams["number"]) };
  // 주소의 값은 믿지 않는다. 범위 밖이면 PR 을 특정하지 않은 안내만 보여 준다(저장소에 묻지 않는다).
  const ref: PrRef | null = isValidPrRef(candidate) ? candidate : null;
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
    case "unlinked":
      body = <>{label}의 연결을 풀었다. 표식이 있어도 다음 Sync 에서 자동으로 다시 붙지 않는다.</>;
      break;
    case "not_linked":
      body = <>{label}은 그 업무에 연결돼 있지 않아 처리하지 않았다. 이미 연결이 풀렸거나 다른 탭에서 바뀌었을 수 있다.</>;
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

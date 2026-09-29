import Link from "next/link";
import type { AttentionRow, OtherWorkFilter, OtherWorkItem, WorkspaceFocusView } from "../../application/focus";
import type { PreviewCardView } from "../../application/preview";
import type { WorkSummaryView } from "../../application/queries";
import type { WorkStatus } from "../../domain/model";
import { Icon, type IconName } from "./glyph";
import { allSameRepo, ATTENTION_EMPTY, ATTENTION_KIND, attentionText, prRef, shortSha } from "./labels";
import { PrIcons } from "./pr-icons";
import { StatusBadge } from "./work-status";

/**
 * Workspace 의 세 조각 (결정 18, Q5). 무엇을 어느 순서로 보일지는 application/focus.ts 가 정하고, 여기서는 받은 것을 그리기만 한다.
 *   - NeedsYourAttention: 업무 하나에 한 줄 — 제목 · 프로젝트 · 왼쪽 상태 아이콘 하나(종류는 아이콘의 title). PR 글자는 두지 않는다(결정 19). 넓은 화면에서 줄을 누르면 오른쪽 Up next 가 그 업무로 바뀌고(?focus=),
 *     휴대전화 폭에서는 곧바로 업무 화면으로 간다(두 링크 중 하나만 보인다). 자바스크립트 없이도 동작한다.
 *   - OtherWork: attention 에 없는 업무의 목록(제목 · 프로젝트, PR 이 있으면 `#12` 와 세 칸 아이콘 줄). 필터 탭(Open · Done candidate · Done)과 프로젝트.
 *   - UpNext: 고른 업무 하나 — 프로젝트 · 제목 · 큰 커밋 번호 한 번 · `#12` 와 아이콘 줄 · 버튼 하나.
 * Workspace 는 PR 카드 전체를 반복해 그리지 않는다 — 카드는 업무 화면에 있다.
 */

export interface WorkspaceQuery {
  readonly filter: OtherWorkFilter;
  readonly projectId: string | null;
  readonly focusId: string | null;
}

/** 지금 조건(필터 · 프로젝트 · 초점)을 유지한 채 하나만 바꾼 주소 */
export function workspaceHref(query: WorkspaceQuery, change: Partial<WorkspaceQuery>): string {
  const next = { ...query, ...change };
  const params = new URLSearchParams();
  if (next.projectId !== null) params.set("project", next.projectId);
  if (next.filter !== "open") params.set("filter", next.filter);
  if (next.focusId !== null) params.set("focus", next.focusId);
  const text = params.toString();
  return text === "" ? "/" : `/?${text}`;
}

const workHref = (id: string) => `/works/${encodeURIComponent(id)}`;

export function NeedsYourAttention({ view, query }: { view: WorkspaceFocusView; query: WorkspaceQuery }) {
  const rows = view.attention;
  return (
    <section className="block" data-testid="attention" aria-labelledby="attn-h">
      <div className="section-head">
        <h2 id="attn-h">
          Needs your attention <small className="counter" data-testid="attention-count">{rows.length}</small>
        </h2>
        <small className="muted">Your next moves</small>
      </div>
      {rows.length === 0 ? (
        <p className="empty-card" data-testid="attention-empty">
          {ATTENTION_EMPTY}
        </p>
      ) : (
        <div className="attention">
          {rows.map((row) => (
            <AttentionLine key={row.kind === "inbox" ? "inbox" : row.workId} row={row} query={query} selected={row.kind === "work" && view.focus?.workId === row.workId} />
          ))}
        </div>
      )}
    </section>
  );
}

/** attention 줄 왼쪽의 상태 아이콘 — 종류마다 하나. 아이콘 줄(pr-icons.tsx)과 같은 모양 · 색이다 */
const LEAD_ICON: Record<"needs_review" | "checks_failing" | "outdated_preview", { readonly name: IconName; readonly tone: string }> = {
  needs_review: { name: "review", tone: "ready" },
  checks_failing: { name: "checksFailing", tone: "fail" },
  outdated_preview: { name: "monitor", tone: "fail" },
};

function AttentionLine({ row, query, selected }: { row: AttentionRow; query: WorkspaceQuery; selected: boolean }) {
  if (row.kind === "inbox") {
    return (
      <Link href="/inbox" className="attention-row" data-testid="attention-row" data-kind="inbox">
        <span className="status-icon">
          <Icon name="inbox" />
        </span>
        <span className="grow">
          <b className="row-title">
            PR <span data-testid="inbox-count">{row.count}</span>개가 업무 연결을 기다린다
          </b>
          <small className="row-meta">Inbox</small>
        </span>
        <span className="go">Open Inbox</span>
        <Icon name="chevron" />
      </Link>
    );
  }
  const [lead, ...rest] = row.reasons;
  if (lead === undefined) return null;
  const icon = LEAD_ICON[lead.kind];
  const body = (
    <>
      <span className={`status-icon ${icon.tone}`} title={ATTENTION_KIND[lead.kind]}>
        <Icon name={icon.name} />
        <span className="sr-only">{ATTENTION_KIND[lead.kind]}</span>
      </span>
      <span className="grow">
        <b className="row-title">{row.workTitle}</b>
        <small className="row-meta">
          {row.projectName}
          {rest.length > 0 && (
            <span className="more" title={rest.map((r) => ATTENTION_KIND[r.kind]).join(" · ")}>
              {" "}
              +{rest.length}
            </span>
          )}
        </small>
      </span>
      <Icon name="chevron" />
    </>
  );
  return (
    <div className={selected ? "attention-row-wrap selected" : "attention-row-wrap"} data-testid="attention-row" data-kind={lead.kind} data-work={row.workId}>
      {/* 넓은 화면: Up next 를 이 업무로 바꾼다 */}
      <Link href={workspaceHref(query, { focusId: row.workId })} className="attention-row desk-only" aria-current={selected ? "true" : undefined} scroll={false}>
        {body}
      </Link>
      {/* 휴대전화 폭: 곧바로 업무 화면으로 간다 */}
      <Link href={workHref(row.workId)} className="attention-row mobile-only">
        {body}
      </Link>
    </div>
  );
}

const FILTER_LABEL: Record<OtherWorkFilter, string> = { open: "Open", done_candidate: "Done candidate", done: "Done" };

const ring = (status: WorkStatus) =>
  status === "done" ? "work-ring done" : status === "done_candidate" ? "work-ring candidate" : status === "draft" ? "work-ring" : "work-ring progress";

export function OtherWork({
  view,
  query,
  projects,
}: {
  view: WorkspaceFocusView;
  query: WorkspaceQuery;
  projects: readonly { readonly id: string; readonly name: string }[];
}) {
  return (
    <section className="block" data-testid="other-work" aria-labelledby="other-h">
      <div className="section-head">
        <h2 id="other-h">
          Other work <small className="counter">{view.other.length}</small>
        </h2>
      </div>
      <div className="list-toolbar">
        <nav className="tabs" aria-label="Work filter">
          {(["open", "done_candidate", "done"] as const).map((f) => (
            <Link
              key={f}
              href={workspaceHref(query, { filter: f })}
              className={query.filter === f ? "active" : undefined}
              aria-current={query.filter === f ? "true" : undefined}
              data-testid={`filter-${f}`}
            >
              {FILTER_LABEL[f]} <span className="n">{view.counts[f]}</span>
            </Link>
          ))}
        </nav>
        {/* 프로젝트 거르기. 사이드바의 Projects 와 같은 값이다 — 사이드바가 없는 휴대전화 폭에서도 쓸 수 있게 여기에 둔다 */}
        <form action="/" method="get" className="project-filter">
          {query.filter !== "open" && <input type="hidden" name="filter" value={query.filter} />}
          <select name="project" defaultValue={query.projectId ?? ""} aria-label="Project">
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button type="submit" className="btn small">
            Show
          </button>
        </form>
      </div>
      {view.other.length === 0 ? (
        <p className="empty-note" data-testid="other-empty">
          {query.filter === "open" ? "진행 중인 다른 업무가 없다." : `${FILTER_LABEL[query.filter]} 인 업무가 없다.`}
        </p>
      ) : (
        <div className="work-table">
          {view.other.map((item) => (
            <WorkLine key={item.summary.work.id} item={item} />
          ))}
        </div>
      )}
      <p className="list-foot" data-testid="other-foot">
        {/* 프로젝트 수는 사이드바 Projects 머리글 한 곳에만 둔다(결정 19 — 사실 하나는 한 자리). 여기서 다시 세면 두 숫자가 어긋나 보인다 */}
        <span>{view.other.length} works</span>
        {query.projectId !== null && <span>Filtered by project</span>}
      </p>
    </section>
  );
}

function WorkLine({ item }: { item: OtherWorkItem }) {
  const { work, prs } = item.summary;
  const pr = prs.find((p) => p.github.state === "open") ?? prs[0];
  const sameRepo = allSameRepo(prs.map((p) => p.repoName));
  return (
    <Link href={workHref(work.id)} className="work-row" data-testid={`work-${work.id}`} data-project={item.projectId}>
      <span className={ring(work.status)} aria-hidden="true" />
      <span className="grow">
        <span className="work-title">{work.title}</span>
        <small className="row-meta">
          {item.projectName}
          {pr !== undefined && (
            <>
              {" "}
              <span className="row-pr" data-testid="work-pr">
                <span className="pr-no">{prRef(pr.repoName, pr.number, sameRepo)}</span>
                <PrIcons github={pr.github} withPreview={false} />
                {prs.length > 1 && <span className="more">+{prs.length - 1}</span>}
              </span>
            </>
          )}
        </small>
      </span>
      <StatusBadge status={work.status} />
      <Icon name="chevron" />
    </Link>
  );
}

/** 오른쪽의 Up next — 고른 attention 업무 하나 (Q5). 넓은 화면에서만 보인다. 목표, 이유 한 구절, PR 요약 몇 줄, 버튼 하나 */
export function UpNext({
  focus,
  summary,
  preview,
}: {
  focus: WorkspaceFocusView["focus"];
  summary: WorkSummaryView | null;
  preview: PreviewCardView | undefined;
}) {
  if (focus === null || summary === null) {
    return (
      <aside className="focus-panel desk-only" aria-label="Up next" data-testid="up-next">
        <div className="focus-top">
          <span className="eyebrow">Up next</span>
        </div>
        <div className="focus-body">
          <p className="muted">지금 판단할 업무가 없다.</p>
        </div>
      </aside>
    );
  }
  const [lead] = focus.reasons;
  const pr = (lead !== undefined && "pr" in lead && lead.pr !== null
    ? summary.prs.find((p) => p.repoName === lead.pr!.repoName && p.number === lead.pr!.number)
    : undefined) ?? summary.prs.find((p) => p.github.state === "open") ?? summary.prs[0];
  const label = lead?.kind === "needs_review" ? "Review work" : "Open work";
  const sameRepo = allSameRepo(summary.prs.map((p) => p.repoName));
  const checksNote = lead?.kind === "checks_failing" ? "작성자가 고칠 차례" : lead?.kind === "needs_review" ? "판단 전" : undefined;
  return (
    <aside className="focus-panel desk-only" aria-label="Up next" data-testid="up-next" data-kind={lead?.kind}>
      <div className="focus-top">
        <span className="eyebrow">Up next</span>
      </div>
      <div className="focus-body">
        <p className="focus-context">{focus.projectName}</p>
        <h2 data-testid="up-next-title">{focus.workTitle}</h2>
        {summary.work.goal !== "" && <p className="focus-goal">{summary.work.goal}</p>}
        {/* 서명: 결정의 대상인 커밋을 크게 한 번 (결정 18 — 본 커밋으로 결정한다). 그 아래 `#12` 와 아이콘 줄 (결정 19) */}
        {pr !== undefined ? (
          <>
            <code className="sha-big" data-testid="up-next-sha" title={pr.headSha}>
              {shortSha(pr.headSha)}
            </code>
            <p className="sha-line" data-testid="up-next-pr">
              <span className="pr-no">{prRef(pr.repoName, pr.number, sameRepo)}</span>{" "}
              <PrIcons github={pr.github} preview={preview} checksNote={checksNote} />
            </p>
          </>
        ) : (
          lead !== undefined && (
            <p className="focus-reason" data-testid="up-next-reason">
              {attentionText(lead).detail}
            </p>
          )
        )}
        <Link href={workHref(focus.workId)} className="btn accent wide" data-testid="up-next-open">
          {label}
          <Icon name="arrow" />
        </Link>
      </div>
    </aside>
  );
}

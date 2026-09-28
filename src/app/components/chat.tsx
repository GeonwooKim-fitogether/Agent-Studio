import type { ReactNode } from "react";
import type { PreviewCardView } from "../../application/preview";
import type { PrCardView } from "../../application/queries";
import { visibleReviews } from "../../application/review";
import type { TimelineEntry } from "../../application/timeline";
import { threadKey } from "../../domain/memo";
import type { ReviewVerdict } from "../../domain/model";
import { Icon } from "./glyph";
import {
  allSameRepo,
  CHECKS,
  dayLabel,
  formatKst,
  formatKstTime,
  OWNER_TAG,
  prEventText,
  prRef,
  recordStartText,
  REVIEW_BUTTON,
  shortSha,
  VERDICT,
  WORK_STATUS,
} from "./labels";
import { MemoEvent, ReplyFoot } from "./memo";
import { PrIcons } from "./pr-icons";

/**
 * 업무 화면의 타임라인 (feature-plan F7, 결정 18 의 Q7). 무엇을 어떤 순서로 보일지는 application/timeline.ts 가 정하고,
 * 여기서는 받은 목록을 그리기만 한다.
 *
 *   - GitHub · Studio 의 시스템 사건(연결 · 새 커밋 · 검사 · 병합 · 상태 변화)은 **작은 한 줄**이다("PR #12 연결됨"). 주인(GitHub = 검정 점, Studio = 강조색 점)이 왼쪽 6px 점이다.
 *     저장소 이름 · 커밋 번호 · 연결 방식은 줄에 적지 않는다(결정 19 — 사실 하나는 한 자리에만). 같은 날 셋 이상 이어지는 시스템 사건은 "N건 · 펼치기" 한 줄로 접힌다(details, 자바스크립트 없음).
 *   - 내부 검토 결정은 "Request changes 남김 · PR #12" 한 줄이고, 그 결정이 PR 의 지금 커밋이 아니면 "이전 커밋" 표시가 붙는다. Reason · Done when 이 있으면 그 아래에 보인다.
 *     어느 커밋에 대한 결정인지는 줄의 data-commit 과 표시의 title 에 있다.
 *   - PR 결과는 **최신 커밋 카드 하나**만 크게 보인다(제목 · #번호 · 아이콘 줄 · 결정이 있을 때만 Studio 알약 · Open review). 설명 문장은 두지 않는다(결정 18).
 *     이전 커밋 카드는 한 줄로 접힌다(펼치면 그 커밋의 기록이 보이고, 버튼은 없다 — 결정 16-5). 답글 개수는 그대로 붙는다.
 *   - 메모(F8)는 memo.tsx 가, 스레드 칸(F9)은 thread.tsx 가 그린다.
 */

/** 타임라인 속 커밋 카드의 자리 (스레드를 닫거나 열 때 돌아오는 곳) */
export const cardAnchor = (repoId: number, number: number, commitSha: string) => `card-${repoId}-${number}-${shortSha(commitSha)}`;

/** 주인 점 — 6px. 이름은 화면 읽기 프로그램에만 읽힌다 */
const Tag = ({ owner }: { owner: "github" | "studio" }) => (
  <span className={`src ${owner === "github" ? "gh" : "studio"}`} data-testid="event-owner" title={OWNER_TAG[owner]}>
    <span className="sr-only">{OWNER_TAG[owner]}</span>
  </span>
);

/** 접을 수 있는 조용한 시스템 사건 — 결정(이유가 붙는다) · 메모 · 카드는 아니다 */
const isQuiet = (e: TimelineEntry) => e.type === "work_created" || e.type === "pr_event" || e.type === "status";
/** 같은 날 이어지는 조용한 사건이 이만큼 이상이면 한 줄로 접는다 */
const GROUP_MIN = 3;

/** 항목들을 순서대로 놓되, 이어지는 조용한 사건 셋 이상은 한 묶음으로 */
function groupQuiet(entries: readonly TimelineEntry[]): (TimelineEntry | { readonly type: "group"; readonly key: string; readonly items: readonly TimelineEntry[] })[] {
  const out: (TimelineEntry | { readonly type: "group"; readonly key: string; readonly items: readonly TimelineEntry[] })[] = [];
  let run: TimelineEntry[] = [];
  const flush = () => {
    if (run.length >= GROUP_MIN) out.push({ type: "group", key: `group-${run[0]!.key}`, items: run });
    else out.push(...run);
    run = [];
  };
  for (const e of entries) {
    if (isQuiet(e)) run.push(e);
    else {
      flush();
      out.push(e);
    }
  }
  flush();
  return out;
}

const Time = ({ at }: { at: string }) => (
  <time dateTime={at} title={formatKst(at)}>
    {formatKstTime(at)}
  </time>
);

export function Timeline({
  entries: all,
  workId,
  editingMemoId,
  previewFor,
  reviewHrefFor,
}: {
  entries: readonly TimelineEntry[];
  workId: string;
  /** 고치기 칸을 연 메모 (?edit=). 없으면 null */
  editingMemoId: string | null;
  previewFor: (pr: PrCardView) => PreviewCardView | undefined;
  reviewHrefFor: (pr: PrCardView) => string;
}) {
  // 한 업무의 PR 이 모두 같은 저장소면 저장소 이름을 적지 않는다
  const sameRepo = allSameRepo(
    all.flatMap((e) => (e.type === "pr_event" || e.type === "review" ? [e.repoName] : e.type === "card" ? [e.pr.repoName] : [])),
  );
  const ref = (repoName: string, number: number) => prRef(repoName, number, sameRepo);
  const heads = new Map(all.flatMap((e) => (e.type === "card" && e.latest ? [[`${e.pr.repoName}#${e.pr.number}`, e.pr.headSha] as const] : [])));
  const decided = (repoName: string, number: number, commitSha: string) =>
    all.some((e) => e.type === "review" && e.repoName === repoName && e.number === number && e.commitSha === commitSha);
  // 결정이 가리키는 이전 커밋의 카드는 답글이 없으면 그리지 않는다 — 결정 줄의 "이전 커밋" 이 같은 사실이다
  const entries = all.filter((e) => !(e.type === "card" && !e.latest && e.replies === 0 && decided(e.pr.repoName, e.pr.number, e.commitSha)));
  const renderOne = (e: TimelineEntry): ReactNode => {
        switch (e.type) {
          case "note":
            return (
              <div key={e.key} className="date-line" data-testid="record-start">
                {recordStartText(e.since)}
              </div>
            );
          case "day":
            return (
              <div key={e.key} className="date-line" data-testid="day">
                {dayLabel(e.day)}
              </div>
            );
          case "work_created":
            return (
              <div key={e.key} className="ev sys" data-testid="event" data-kind="work_created">
                <Tag owner={e.owner} />
                <span className="sys-text">업무를 만들었다</span>
                <Time at={e.at} />
              </div>
            );
          case "pr_event":
            return (
              <div key={e.key} className="ev sys" data-testid="event" data-kind={e.event.kind}>
                <Tag owner={e.owner} />
                <span className="sys-text">
                  PR {ref(e.repoName, e.event.number)} {prEventText(e.event)}
                </span>
                <Time at={e.at} />
              </div>
            );
          case "review": {
            const head = heads.get(`${e.repoName}#${e.number}`);
            const old = head !== undefined && head !== e.commitSha;
            return (
              <div
                key={e.key}
                className="ev decision"
                id={`decision-${e.key.replace(/^rev-/, "")}`}
                data-testid="event"
                data-kind="review"
                data-verdict={e.verdict}
                data-commit={shortSha(e.commitSha)}
                data-freshness={head === undefined ? undefined : old ? "outdated" : "current"}
              >
                <div className="ev sys">
                  <Tag owner={e.owner} />
                  <span className="sys-text" title={`${VERDICT[e.verdict]} · 커밋 ${shortSha(e.commitSha)}`}>
                    <b>{REVIEW_BUTTON[e.verdict]}</b> 남김 · PR {ref(e.repoName, e.number)}
                    {old && <span className="old-tag">이전 커밋</span>}
                  </span>
                  <Time at={e.at} />
                </div>
                {(e.reason !== null || e.doneWhen !== null) && (
                  <dl className="decision-note" data-testid="decision-note">
                    {e.reason !== null && (
                      <div>
                        <dt>{e.verdict === "changes_requested" ? "Reason" : "Note"}</dt>
                        <dd data-testid="decision-reason">{e.reason}</dd>
                      </div>
                    )}
                    {e.doneWhen !== null && (
                      <div>
                        <dt>Done when</dt>
                        <dd data-testid="decision-done-when">{e.doneWhen}</dd>
                      </div>
                    )}
                  </dl>
                )}
              </div>
            );
          }
          case "status":
            return (
              <div key={e.key} className="ev sys" data-testid="event" data-kind="status">
                <Tag owner={e.owner} />
                <span className="sys-text">
                  업무 상태 {WORK_STATUS[e.change.from]} → <b>{WORK_STATUS[e.change.to]}</b>{" "}
                  <span className="muted">· {e.change.cause.kind === "rule" ? `규칙 ${e.change.cause.rule}` : "사람"}</span>
                </span>
                <Time at={e.at} />
              </div>
            );
          case "memo":
            return (
              <div key={e.key} className="ev msg" id={`memo-${e.memo.id}`} data-testid="event" data-kind="memo">
                <span className="avatar" aria-hidden="true">
                  나
                </span>
                <div className="msg-body">
                  <Time at={e.at} />
                  <MemoEvent memo={e.memo} workId={workId} editing={e.memo.id === editingMemoId} replies={e.replies} />
                </div>
              </div>
            );
          case "card": {
            const anchor = cardAnchor(e.pr.repoId, e.pr.number, e.commitSha);
            const foot = (
              <div className="ev-foot card-foot" data-testid={`card-foot-${e.pr.repoId}-${e.pr.number}-${shortSha(e.commitSha)}`}>
                <ReplyFoot
                  workId={workId}
                  thread={threadKey({ kind: "card", repoId: e.pr.repoId, number: e.pr.number, commitSha: e.commitSha })}
                  anchor={anchor}
                  replies={e.replies}
                  canReply={e.latest}
                />
              </div>
            );
            return (
              <div key={e.key} className={e.latest ? "ev card-ev" : "ev card-ev old"} id={anchor} data-testid="event" data-kind="card">
                {e.latest ? (
                  <ResultCard
                    pr={e.pr}
                    prLabel={ref(e.pr.repoName, e.pr.number)}
                    several={e.several}
                    preview={previewFor(e.pr)}
                    reviewHref={reviewHrefFor(e.pr)}
                    at={e.at}
                    foot={foot}
                  />
                ) : (
                  <OldPrCard pr={e.pr} prLabel={ref(e.pr.repoName, e.pr.number)} commitSha={e.commitSha} recordedChecks={e.recordedChecks} foot={foot} />
                )}
              </div>
            );
          }
        }
  };
  return (
    <div className="tl" data-testid="timeline">
      {groupQuiet(entries).map((e) =>
        e.type === "group" ? (
          <details key={e.key} className="sys-group" data-testid="event-group">
            <summary>
              <Icon name="chevron" />
              <span className="sys-text">
                <b>시스템 사건 {e.items.length}건</b> · 펼치기
              </span>
              {"at" in e.items[e.items.length - 1]! && <Time at={(e.items[e.items.length - 1] as { at: string }).at} />}
            </summary>
            <div className="sys-body">{e.items.map(renderOne)}</div>
          </details>
        ) : (
          renderOne(e)
        ),
      )}
    </div>
  );
}

/** Studio 의 결정 알약 — 아이콘 줄 옆에 하나, 결정이 있을 때만 (결정 19). 어느 커밋에 대한 것인지는 title 에만 둔다 */
export function DecisionPill({ verdict, commitSha }: { verdict: ReviewVerdict; commitSha: string }) {
  return (
    <span className={`decision-pill studio-${verdict}`} data-testid="studio-status" title={`Studio 의 내부 검토 결정 · 커밋 ${shortSha(commitSha)}`}>
      <span data-testid="review-decision" data-freshness="current" data-verdict={verdict}>
        {VERDICT[verdict]}
      </span>
    </span>
  );
}

/**
 * 최신 커밋의 결과 카드 (Q7, 결정 19). 제목 · `#12`(저장소가 섞일 때만 짧은 저장소 이름) · "최신 커밋" 표시 · 아이콘 줄 · Studio 결정 알약 · Open review · Reply.
 * GitHub 상태는 아이콘 줄 하나에만 있다 — GITHUB · STUDIO · PREVIEW 줄을 따로 두지 않는다. 커밋 번호는 Next action 과 Review 패널에 있다.
 */
export function ResultCard({
  pr,
  prLabel,
  several,
  preview,
  reviewHref,
  at,
  foot,
}: {
  pr: PrCardView;
  prLabel: string;
  several: boolean;
  preview: PreviewCardView | undefined;
  reviewHref: string;
  at: string | null;
  foot: ReactNode;
}) {
  const current = visibleReviews(pr.studio.reviews).filter((r) => r.freshness === "current").at(-1);
  return (
    <article className="result-card" data-testid={`pr-card-${pr.repoId}-${pr.number}`} data-commit={shortSha(pr.headSha)}>
      <header className="result-head">
        <Icon name="prOpen" />
        <div className="grow">
          <b className="result-title">{pr.title}</b>
          <span className="result-meta">
            <span className="pr-no">{prLabel}</span>
            {several && (
              <span className="new-tag" title={`커밋 ${shortSha(pr.headSha)}`}>
                최신 커밋
              </span>
            )}{" "}
            <PrIcons github={pr.github} preview={preview} lead />
            {current !== undefined && <DecisionPill verdict={current.verdict} commitSha={current.commitSha} />}
          </span>
        </div>
        {at !== null && <Time at={at} />}
      </header>
      <div className="result-foot">
        <a className="btn small" href={reviewHref} data-testid="open-review">
          <Icon name="review" />
          Open review
        </a>
        {foot}
      </div>
    </article>
  );
}

/**
 * 이전 커밋의 카드 — 기록이다. 한 줄(`PR #12 · 이전 커밋`)로 접혀 있고, 펼치면 그 커밋 번호와 그 커밋에 대해 기록된 검사 결과 · 미리보기가 보인다.
 * PR 의 지금 상태(열림 · 병합 등)는 최신 카드에 있다. 이 카드에는 버튼이 없다(결정 16-5).
 * 그 커밋에 대한 결정이 타임라인에 있고 답글이 없으면 이 카드는 따로 그리지 않는다 — 결정 줄의 "이전 커밋" 이 같은 사실이다 (Timeline 이 거른다).
 */
export function OldPrCard({
  pr,
  prLabel,
  commitSha,
  recordedChecks,
  foot,
}: {
  pr: PrCardView;
  prLabel: string;
  commitSha: string;
  recordedChecks: PrCardView["github"]["checks"] | null;
  foot?: ReactNode;
}) {
  const reviews = visibleReviews(pr.studio.reviews).filter((r) => r.commitSha === commitSha);
  const previews = pr.studio.previews.filter((p) => p.commitSha === commitSha);
  return (
    <div className="old-card-wrap">
      <details className="old-card" data-testid={`pr-card-old-${pr.repoId}-${pr.number}-${shortSha(commitSha)}`}>
        <summary>
          <Icon name="chevron" />
          <span>PR {prLabel}</span>
          <span className="old-tag">이전 커밋</span>
          {reviews.map((r) => (
            <span key={r.id} className="chip outdated" data-testid="old-review">
              {VERDICT[r.verdict]}
            </span>
          ))}
        </summary>
        <dl className="chip-rows">
          <div className="chip-row">
            <dt>Commit</dt>
            <dd>
              <code>{shortSha(commitSha)}</code>
            </dd>
          </div>
          <div className="chip-row">
            <dt>Checks</dt>
            <dd>
              <span className="chip quiet">{recordedChecks === null ? "검사 기록 없음" : CHECKS[recordedChecks]}</span>
            </dd>
          </div>
          {(reviews.length > 0 || previews.length > 0) && (
            <div className="chip-row">
              <dt>Studio</dt>
              <dd>
                {reviews.map((r) => (
                  <span key={r.id} className="chip outdated">
                    {VERDICT[r.verdict]}
                    {r.reason !== null && ` · ${r.reason}`}
                  </span>
                ))}
                {previews.map((p) => (
                  <span key={p.id} className="chip outdated">
                    Preview {shortSha(p.commitSha)}
                  </span>
                ))}
              </dd>
            </div>
          )}
        </dl>
      </details>
      {foot}
    </div>
  );
}

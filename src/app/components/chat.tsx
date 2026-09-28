import type { ReactNode } from "react";
import type { PreviewCardView } from "../../application/preview";
import type { PrCardView } from "../../application/queries";
import { visibleReviews } from "../../application/review";
import type { TimelineEntry } from "../../application/timeline";
import { threadKey } from "../../domain/memo";
import { Icon } from "./glyph";
import { CHECKS, dayLabel, formatKst, formatKstTime, githubChips, OWNER_TAG, prEventText, recordStartText, reviewEventText, shortSha, VERDICT, WORK_STATUS } from "./labels";
import { MemoEvent, ReplyFoot } from "./memo";
import { PreviewStatus, previewSummary } from "./preview-status";

/**
 * 업무 화면의 타임라인 (feature-plan F7, 결정 18 의 Q7). 무엇을 어떤 순서로 보일지는 application/timeline.ts 가 정하고,
 * 여기서는 받은 목록을 그리기만 한다.
 *
 *   - GitHub · Studio 의 시스템 사건(연결 · 새 커밋 · 검사 · 병합 · 상태 변화)은 **작은 한 줄**이다. 주인(GitHub · Studio)이 앞에 붙는다.
 *   - 내부 검토 결정은 한 줄에 더해 Reason · Done when · 본 커밋("Reviewed abc1234")을 함께 보인다 — 다음 사람이 무엇을 고치면 되는지 읽는다.
 *   - PR 결과는 **최신 커밋 카드 하나**만 크게 보인다(제목 · PR · 커밋 · GitHub 칩 셋 · 결정이 있을 때만 Studio 줄 · 미리보기가 돌 때만 그 줄 · Open review).
 *     설명 문장은 두지 않는다(결정 18). 이전 커밋 카드는 한 줄로 접힌다(펼치면 그 커밋의 기록이 보이고, 버튼은 없다 — 결정 16-5). 답글 개수는 그대로 붙는다.
 *   - 메모(F8)는 memo.tsx 가, 스레드 칸(F9)은 thread.tsx 가 그린다.
 */

/** 타임라인 속 커밋 카드의 자리 (스레드를 닫거나 열 때 돌아오는 곳) */
export const cardAnchor = (repoId: number, number: number, commitSha: string) => `card-${repoId}-${number}-${shortSha(commitSha)}`;

const Tag = ({ owner }: { owner: "github" | "studio" }) => (
  <span className={`src ${owner === "github" ? "gh" : "studio"}`} data-testid="event-owner">
    {OWNER_TAG[owner]}
  </span>
);

const Time = ({ at }: { at: string }) => (
  <time dateTime={at} title={formatKst(at)}>
    {formatKstTime(at)}
  </time>
);

export function Timeline({
  entries,
  marker,
  workId,
  editingMemoId,
  previewFor,
  reviewHrefFor,
}: {
  entries: readonly TimelineEntry[];
  marker: string;
  workId: string;
  /** 고치기 칸을 연 메모 (?edit=). 없으면 null */
  editingMemoId: string | null;
  previewFor: (pr: PrCardView) => PreviewCardView | undefined;
  reviewHrefFor: (pr: PrCardView) => string;
}) {
  return (
    <div className="tl" data-testid="timeline">
      {entries.map((e) => {
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
                <Icon name="clock" />
                <Tag owner={e.owner} />
                <span className="sys-text">
                  업무를 만들었다 · 표식 <code>{marker}</code>
                </span>
                <Time at={e.at} />
              </div>
            );
          case "pr_event":
            return (
              <div key={e.key} className="ev sys" data-testid="event" data-kind={e.event.kind}>
                <Icon name={e.owner === "github" ? "github" : "branch"} />
                <Tag owner={e.owner} />
                <span className="sys-text">
                  <b>
                    {e.repoName}#{e.event.number}
                  </b>{" "}
                  {prEventText(e.event)}
                </span>
                <Time at={e.at} />
              </div>
            );
          case "review":
            return (
              <div key={e.key} className="ev decision" id={`decision-${e.key.replace(/^rev-/, "")}`} data-testid="event" data-kind="review" data-verdict={e.verdict}>
                <div className="ev sys">
                  <Icon name="review" />
                  <Tag owner={e.owner} />
                  <span className="sys-text">
                    <b>
                      {e.repoName}#{e.number}
                    </b>{" "}
                    {reviewEventText(e.verdict, e.commitSha)}
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
                    <div>
                      <dt>Reviewed</dt>
                      <dd>
                        <code data-testid="decision-commit">{shortSha(e.commitSha)}</code>
                      </dd>
                    </div>
                  </dl>
                )}
              </div>
            );
          case "status":
            return (
              <div key={e.key} className="ev sys" data-testid="event" data-kind="status">
                <Icon name="check" />
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
                  <ResultCard pr={e.pr} several={e.several} preview={previewFor(e.pr)} reviewHref={reviewHrefFor(e.pr)} at={e.at} foot={foot} />
                ) : (
                  <OldPrCard pr={e.pr} commitSha={e.commitSha} recordedChecks={e.recordedChecks} foot={foot} />
                )}
              </div>
            );
          }
        }
      })}
    </div>
  );
}

/** 최신 커밋의 결과 카드 (Q7). GitHub 칩과 Studio 칩은 다른 줄이다 — 한 문장으로 합치지 않는다 (계약 §5). Studio 줄은 결정이 있을 때만 있다 */
export function ResultCard({
  pr,
  several,
  preview,
  reviewHref,
  at,
  foot,
}: {
  pr: PrCardView;
  several: boolean;
  preview: PreviewCardView | undefined;
  reviewHref: string;
  at: string | null;
  foot: ReactNode;
}) {
  const current = visibleReviews(pr.studio.reviews).filter((r) => r.freshness === "current").at(-1);
  const showPreview = preview !== undefined && previewSummary(preview).tone !== "quiet";
  return (
    <article className="result-card" data-testid={`pr-card-${pr.repoId}-${pr.number}`}>
      <header className="result-head">
        <Icon name="branch" />
        <div className="grow">
          <b className="result-title">{pr.title}</b>
          <small className="result-meta">
            {pr.repoName}#{pr.number} · <code>{shortSha(pr.headSha)}</code>
            {several && <span className="new-tag">최신 커밋</span>}
            {at !== null && (
              <>
                {" "}
                · <Time at={at} />
              </>
            )}
          </small>
        </div>
      </header>
      <dl className="chip-rows">
        <div className="chip-row" data-testid="github-status">
          <dt>GitHub</dt>
          <dd>
            {githubChips(pr.github).map((c) => (
              <span key={c.text} className={`chip ${c.className}`}>
                {c.text}
              </span>
            ))}
          </dd>
        </div>
        {current !== undefined && (
          <div className="chip-row" data-testid="studio-status">
            <dt>Studio</dt>
            <dd>
              <span className={`chip studio-${current.verdict}`} data-testid="review-decision" data-freshness="current" data-verdict={current.verdict}>
                {VERDICT[current.verdict]} · 커밋 {shortSha(current.commitSha)}
              </span>
            </dd>
          </div>
        )}
        {showPreview && (
          <div className="chip-row">
            <dt>Preview</dt>
            <dd>
              <PreviewStatus view={preview} />
            </dd>
          </div>
        )}
      </dl>
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
 * 이전 커밋의 카드 — 기록이다. 한 줄로 접혀 있고, 펼치면 그 커밋에 대해 기록된 검사 결과 · 검토 결정 · 미리보기가 보인다.
 * PR 의 지금 상태(열림 · 병합 등)는 최신 카드에 있다. 이 카드에는 버튼이 없다(결정 16-5).
 */
export function OldPrCard({
  pr,
  commitSha,
  recordedChecks,
  foot,
}: {
  pr: PrCardView;
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
          <span>
            {pr.repoName}#{pr.number} · 커밋 <code>{shortSha(commitSha)}</code>
          </span>
          <span className="old-tag">이전 커밋</span>
          {reviews.map((r) => (
            <span key={r.id} className="chip outdated" data-testid="old-review">
              {VERDICT[r.verdict]}
            </span>
          ))}
        </summary>
        <dl className="chip-rows">
          <div className="chip-row">
            <dt>GitHub</dt>
            <dd>
              <span className="chip quiet">{recordedChecks === null ? "검사 기록 없음" : CHECKS[recordedChecks]}</span>
            </dd>
          </div>
          <div className="chip-row">
            <dt>Studio</dt>
            <dd>
              {reviews.length === 0 && previews.length === 0 && <span className="chip quiet">기록 없음</span>}
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
        </dl>
      </details>
      {foot}
    </div>
  );
}

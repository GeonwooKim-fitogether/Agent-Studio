import Link from "next/link";
import type { ReactNode } from "react";
import type { ChannelGroupView, PrCardView } from "../../application/queries";
import { visibleReviews } from "../../application/review";
import type { TimelineEntry } from "../../application/timeline";
import type { DataSource } from "../../ports/github-reader";
import {
  CHANNELS_FOOT,
  CHECKS,
  dayLabel,
  formatKst,
  formatKstTime,
  oldCardNote,
  OWNER_TAG,
  prEventText,
  recordStartText,
  reviewEventText,
  shortSha,
  statusCauseText,
  VERDICT,
  VERDICT_MEANING,
  WORK_STATUS,
} from "./labels";
import { MemoEvent } from "./memo";
import { PrCard } from "./pr-card";

/**
 * 업무 Chat 의 조각들 (feature-plan F7, 시안 v2 의 renderChat · renderEvent). 무엇을 어떤 순서로 보일지는
 * application/timeline.ts 가 정하고, 여기서는 받은 목록을 그리기만 한다.
 *
 * 메모(F8)는 memo.tsx 가 그린다. Reply(F9 스레드)는 아직 그리지 않는다 — 동작하지 않는 칸을 두지 않는다(결정 7).
 */

/** 왼쪽 채널 목록 — 프로젝트 > 업무. 채널 하나가 업무 하나다 */
export function Channels({ groups, currentId }: { groups: readonly ChannelGroupView[]; currentId: string }) {
  return (
    <nav className="channels" aria-label="Channels" data-testid="channels">
      {groups.map(({ project, works }) => (
        <div key={project.id} className="ch-group">
          <h2>{project.name}</h2>
          {works.length === 0 && <p className="ch-empty">업무 없음</p>}
          {works.map((w) => (
            <Link
              key={w.id}
              href={`/works/${encodeURIComponent(w.id)}`}
              className="ch"
              aria-current={w.id === currentId ? "page" : undefined}
              data-testid={`channel-${w.id}`}
            >
              <span className="t">{w.title}</span>
              <span className={w.status === "needs_review" ? "s hot" : "s"}>{WORK_STATUS[w.status]}</span>
            </Link>
          ))}
        </div>
      ))}
      <p className="ch-foot">{CHANNELS_FOOT}</p>
    </nav>
  );
}

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

/**
 * 타임라인. 최신 카드에는 actionsFor 가 주는 버튼(미리보기 · 검토 · Unlink)을 그대로 붙이고,
 * 이전 커밋 카드에는 버튼 없이 "버튼은 최신 카드에서만 누른다" 한 줄을 둔다(결정 16-5).
 */
export function Timeline({
  entries,
  marker,
  source,
  actionsFor,
  workId,
  editingMemoId,
}: {
  entries: readonly TimelineEntry[];
  marker: string;
  source: DataSource;
  actionsFor: (pr: PrCardView) => ReactNode;
  workId: string;
  /** 고치기 칸을 연 메모 (?edit=). 없으면 null */
  editingMemoId: string | null;
}) {
  return (
    <div className="tl" data-testid="timeline">
      {entries.map((e) => {
        switch (e.type) {
          case "note":
            return (
              <p key={e.key} className="tl-note" data-testid="record-start">
                {recordStartText(e.since)}
              </p>
            );
          case "day":
            return (
              <div key={e.key} className="day" data-testid="day">
                {dayLabel(e.day)}
              </div>
            );
          case "work_created":
            return (
              <div key={e.key} className="ev" data-testid="event" data-kind="work_created">
                <Time at={e.at} />
                <div className="ev-sys">
                  <Tag owner={e.owner} />
                  업무를 만들었다 · 표식 <code>{marker}</code>
                </div>
              </div>
            );
          case "pr_event":
            return (
              <div key={e.key} className="ev" data-testid="event" data-kind={e.event.kind}>
                <Time at={e.at} />
                <div className="ev-sys">
                  <Tag owner={e.owner} />
                  <b>
                    {e.repoName}#{e.event.number}
                  </b>{" "}
                  {prEventText(e.event)}
                </div>
              </div>
            );
          case "review":
            return (
              <div key={e.key} className="ev" data-testid="event" data-kind="review">
                <Time at={e.at} />
                <div className="ev-sys">
                  <Tag owner={e.owner} />
                  <b>
                    {e.repoName}#{e.number}
                  </b>{" "}
                  {reviewEventText(e.verdict, e.commitSha)}
                </div>
              </div>
            );
          case "status":
            return (
              <div key={e.key} className="ev" data-testid="event" data-kind="status">
                <Time at={e.at} />
                <div className="ev-state">
                  <Tag owner={e.owner} />
                  업무 상태 {WORK_STATUS[e.change.from]} → <b>{WORK_STATUS[e.change.to]}</b>{" "}
                  <span className="muted">· {statusCauseText(e.change)}</span>
                </div>
              </div>
            );
          case "memo":
            return (
              <div key={e.key} className="ev" id={`memo-${e.memo.id}`} data-testid="event" data-kind="memo">
                <Time at={e.at} />
                <MemoEvent memo={e.memo} workId={workId} editing={e.memo.id === editingMemoId} />
              </div>
            );
          case "card":
            return (
              <div key={e.key} className="ev ev-card">
                {e.at === null ? <time /> : <Time at={e.at} />}
                <div>
                  {e.latest ? (
                    <PrCard
                      pr={e.pr}
                      source={source}
                      tag={e.several ? <span className="new-tag">최신 커밋</span> : null}
                      actions={actionsFor(e.pr)}
                    />
                  ) : (
                    <OldPrCard pr={e.pr} commitSha={e.commitSha} recordedChecks={e.recordedChecks} />
                  )}
                </div>
              </div>
            );
        }
      })}
    </div>
  );
}

/**
 * 이전 커밋의 카드 — 기록이다. GitHub 칸에는 그 커밋에 대해 기록된 검사 결과만, Studio 칸에는 그 커밋에 남은 검토 결정과 미리보기만 보인다.
 * PR 의 지금 상태(열림 · 병합 등)는 최신 카드에 있다. 이 카드에는 버튼이 없다.
 */
export function OldPrCard({ pr, commitSha, recordedChecks }: { pr: PrCardView; commitSha: string; recordedChecks: PrCardView["github"]["checks"] | null }) {
  const reviews = visibleReviews(pr.studio.reviews).filter((r) => r.commitSha === commitSha);
  const previews = pr.studio.previews.filter((p) => p.commitSha === commitSha);
  return (
    <article className="pr-card old" data-testid={`pr-card-old-${pr.repoId}-${pr.number}-${shortSha(commitSha)}`}>
      <header className="pr-head">
        <strong className="pr-id">
          {pr.repoName}#{pr.number}
        </strong>
        <span className="pr-title">{pr.title}</span>
        <span className="old-tag">이전 커밋</span>
      </header>
      <p className="pr-meta">
        커밋 <code>{shortSha(commitSha)}</code>
      </p>
      <dl className="state-rows">
        <div className="state-row">
          <dt>GitHub</dt>
          <dd>
            <span className="chip quiet">{recordedChecks === null ? "이 커밋의 검사 기록 없음" : `${CHECKS[recordedChecks]} (이 커밋의 마지막 기록)`}</span>
          </dd>
        </div>
        <div className="state-row">
          <dt>Studio</dt>
          <dd>
            {reviews.length === 0 && previews.length === 0 && <span className="chip quiet">이 커밋의 기록 없음</span>}
            {reviews.map((r) => (
              <span key={r.id} className="chip outdated" data-testid="old-review">
                {VERDICT[r.verdict]} · {VERDICT_MEANING[r.verdict]} · 커밋 {shortSha(r.commitSha)}
              </span>
            ))}
            {previews.map((p) => (
              <span key={p.id} className="chip outdated">
                Preview {shortSha(p.commitSha)} · 이전 버전
              </span>
            ))}
          </dd>
        </div>
      </dl>
      <p className="old-note" data-testid="old-card-note">
        {oldCardNote(pr.headSha)}
      </p>
    </article>
  );
}

import type { PreviewCardView } from "../../application/preview";
import { startPreviewAction, stopPreviewAction } from "../actions";
import { PREVIEW_BLOCK, PREVIEW_PHASE, shortSha } from "./labels";
import { AutoRefresh } from "./auto-refresh";
import { Icon } from "./glyph";

/**
 * PR 카드 안의 미리보기 칸 (docs/plan/04-remote-preview.md §4).
 *
 * 열 수 없으면 Open Preview 를 없애지 않고 비활성으로 두고 이유를 title 에 둔다(결정 7). PR 쪽 이유(복제본 등)는 옆에 문장으로도 보이고,
 * 미리보기 기기가 꺼진 것은 사이드바가 한 곳에서 말하므로 아이콘(꺼진 모니터)과 title 로만 보인다(결정 19).
 * 실행 중이면 "Running · PR #n · 커밋 앞 7자리 · 주소" 와 열기 링크 · 종료 버튼을 보인다.
 * PR 에 새 커밋이 올라와 실행 중인 커밋이 최신이 아니면 "이전 버전" 으로 표시하고 검토 근거로 쓰지 말라고 적는다(계약 §6).
 */
export function PreviewControls({
  view,
  pr,
  workId,
  review = null,
}: {
  view: PreviewCardView;
  pr: { readonly repoId: number; readonly number: number; readonly headSha: string };
  workId: string;
  /** Review 패널 안에서 그리면 그 패널의 이름(?review=) — 열기 · 끄기 뒤에 패널을 연 채로 돌아온다 */
  review?: string | null;
}) {
  const back = review === null ? null : <input type="hidden" name="review" value={review} />;
  const { availability, session, otherActive } = view;
  const reason =
    availability.kind === "runner_offline" ? availability.reason : availability.kind === "blocked" ? PREVIEW_BLOCK[availability.block] : null;
  const live = session !== null && (session.busy || session.phase === "running");
  const offline = availability.kind === "runner_offline";

  return (
    <section className="preview-box" data-testid="preview-box" aria-label="Preview">
      {session !== null && (
        <div className="preview-session" data-testid="preview-session" data-phase={session.phase} data-freshness={session.freshness}>
          {session.busy && <AutoRefresh />}
          <p className="preview-line">
            <span className={`chip ${session.phase === "running" ? "current" : ""}`} data-testid="preview-phase">
              {PREVIEW_PHASE[session.phase]}
            </span>{" "}
            PR #{pr.number} · 커밋 <code data-testid="preview-commit">{shortSha(session.commitSha)}</code>
            {session.url !== null && (
              <>
                {" "}
                · <code data-testid="preview-url">{session.url}</code>{" "}
                <a className="btn tiny" href={session.url} target="_blank" rel="noreferrer" data-testid="preview-open-link">
                  Open
                </a>
              </>
            )}
          </p>
          {session.freshness === "outdated" && (
            <p className="preview-outdated" data-testid="preview-outdated">
              이전 버전 — 이 미리보기는 커밋 {shortSha(session.commitSha)} 이고, PR 의 최신 커밋은 {shortSha(pr.headSha)} 이다. 검토 근거로 쓰지 않는다.
              Open Preview 로 최신 커밋을 다시 연다.
            </p>
          )}
          {session.replaced !== null && (
            <p className="muted" data-testid="preview-replaced">
              동시에 하나만 돈다 — 이전 미리보기({session.replaced.repoName}#{session.replaced.number} · 커밋 {shortSha(session.replaced.commitSha)})를
              종료했다.
            </p>
          )}
          {session.failure !== null && (
            <p className="source-error" data-testid="preview-failure">
              미리보기를 열지 못했다: {session.failure}
            </p>
          )}
          {session.logTail.length > 0 && (session.phase === "failed" || session.busy) && (
            <details open={session.phase === "failed"}>
              <summary>Log (최근 {session.logTail.length}줄)</summary>
              <pre className="preview-log" data-testid="preview-log">
                {session.logTail.join("\n")}
              </pre>
            </details>
          )}
        </div>
      )}
      <div className="preview-actions">
        {reason === null ? (
          <form action={startPreviewAction}>
            <input type="hidden" name="repoId" value={pr.repoId} />
            <input type="hidden" name="number" value={pr.number} />
            <input type="hidden" name="workId" value={workId} />
            {back}
            <button type="submit" className="btn">
              <Icon name="monitor" />
              Open Preview
            </button>
          </form>
        ) : (
          <>
            <button type="button" className="btn small" disabled title={reason} aria-describedby={`preview-reason-${pr.repoId}-${pr.number}`}>
              <Icon name={offline ? "monitorOff" : "monitor"} />
              Open Preview
            </button>
            {/* 기기가 꺼져 있다는 것은 사이드바 한 곳이 말한다 — 여기서는 아이콘과 title 로만 (결정 19). PR 쪽 이유(복제본 등)는 여기만 있으니 보인다 */}
            <span className={offline ? "sr-only" : "muted"} id={`preview-reason-${pr.repoId}-${pr.number}`} data-testid="preview-blocked-reason">
              {reason}
            </span>
          </>
        )}
        {live && (
          <form action={stopPreviewAction}>
            <input type="hidden" name="workId" value={workId} />
            {back}
            <button type="submit" className="btn">
              Stop Preview
            </button>
          </form>
        )}
        {reason === null && otherActive !== null && (
          <span className="muted" data-testid="preview-other-active">
            지금 {otherActive.repoName}#{otherActive.number} 의 미리보기가 돌고 있다. 열면 그것을 종료한다.
          </span>
        )}
      </div>
    </section>
  );
}

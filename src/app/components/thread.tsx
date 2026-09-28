import type { ThreadView } from "../../application/timeline";
import { MAX_MEMO_LENGTH, threadKey } from "../../domain/memo";
import { writeReplyAction } from "../actions";
import { cardAnchor } from "./chat";
import { CARD_THREAD_NOTE, formatKst, formatKstTime, MEMO_DELETED, NO_REPLIES, REPLY_NOTE, REPLY_PLACEHOLDER, shortSha, threadClosedText } from "./labels";
import { MemoEvent } from "./memo";
import { MemoTextarea } from "./memo-textarea";

/**
 * 업무 Chat 오른쪽의 스레드 칸 (feature-plan F9, 시안 v2 renderChat 의 thread 패널).
 * 머리(Thread · 대상 · Close), 대상 항목, 답글 시간순(없으면 "아직 답글이 없다."), 입력칸 · Reply · "답글도 AI 에게 전달되지 않는다."
 *
 * 주소 파라미터(?thread=)로 열리고 Close 는 파라미터 없는 주소로 돌아가는 링크라 자바스크립트 없이도 동작한다.
 * 답글은 메인 타임라인에 놓이지 않는다(Slack 방식, 결정 2). 휴대전화 폭에서는 이 칸이 화면 전체를 덮는다(globals.css).
 * 지운 메모와 이전 커밋 카드의 스레드는 읽기만 한다 — 입력칸 자리에 그 이유를 한 줄 보인다.
 */
export function ThreadPanel({
  thread,
  workId,
  editingMemoId,
  problem,
}: {
  thread: ThreadView;
  workId: string;
  /** 고치기 칸을 연 답글 (?edit=). 없으면 null */
  editingMemoId: string | null;
  /** 답글을 남기지 않은 이유 (?reply=). 없으면 null */
  problem: string | null;
}) {
  const { root, replies, closed } = thread;
  const key = threadKey(thread.target);
  const rootAnchor = root.type === "memo" ? `memo-${root.memo.id}` : cardAnchor(root.pr.repoId, root.pr.number, root.commitSha);
  const title = root.type === "memo" ? "메모" : `${root.pr.repoName}#${root.pr.number} · ${shortSha(root.commitSha)}`;
  return (
    <aside className="side-panel thread" id="thread" aria-label="Thread" data-testid="thread">
      <div className="thread-head">
        <div>
          <h2>Thread</h2>
          <small data-testid="thread-title">{title}</small>
        </div>
        <a className="btn tiny" href={`/works/${encodeURIComponent(workId)}#${rootAnchor}`} data-testid="thread-close">
          Close
        </a>
      </div>
      <div className="thread-body">
        <div className="thread-root" data-testid="thread-root">
          {root.type === "memo" ? (
            root.memo.deletedAt !== null ? (
              <span className="muted">{MEMO_DELETED}</span>
            ) : (
              <span className="memo-body">{root.memo.body}</span>
            )
          ) : (
            <>
              <b>
                {root.pr.repoName}#{root.pr.number}
              </b>{" "}
              · 커밋 <code>{shortSha(root.commitSha)}</code>
              {!root.latest && <span className="old-tag thread-old">이전 커밋</span>}
              <br />
              {root.pr.title}
              <p className="why thread-why">{CARD_THREAD_NOTE}</p>
            </>
          )}
        </div>
        {replies.length === 0 && <p className="muted" data-testid="no-replies">{NO_REPLIES}</p>}
        {replies.map((r) => (
          <div key={r.id} className="reply" id={`memo-${r.id}`} data-testid="reply">
            <time dateTime={r.createdAt} title={formatKst(r.createdAt)}>
              {formatKstTime(r.createdAt)}
            </time>
            <MemoEvent memo={r} workId={workId} editing={r.id === editingMemoId} inThread={key} />
          </div>
        ))}
      </div>
      <div className="composer thread-composer" data-testid="reply-composer">
        {problem !== null && (
          <p className="source-error" data-testid="reply-problem">
            답글을 저장하지 않았다 — {problem}
          </p>
        )}
        {closed === null ? (
          <>
            <form action={writeReplyAction} className="composer-box">
              <input type="hidden" name="workId" value={workId} />
              <input type="hidden" name="thread" value={key} />
              <MemoTextarea name="body" rows={1} required maxLength={MAX_MEMO_LENGTH} placeholder={REPLY_PLACEHOLDER} aria-label="Reply" />
              <button type="submit" className="btn">
                Reply
              </button>
            </form>
            <p className="note">{REPLY_NOTE}</p>
          </>
        ) : (
          <p className="note" data-testid="thread-closed">
            {threadClosedText(closed, root.type === "card" ? root.pr.headSha : null)}
          </p>
        )}
      </div>
    </aside>
  );
}

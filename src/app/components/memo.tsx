import type { Memo } from "../../domain/memo";
import { MAX_MEMO_LENGTH, threadKey } from "../../domain/memo";
import { deleteMemoAction, editMemoAction, writeMemoAction } from "../actions";
import { formatKst, MEMO_AUTHOR_LABEL, MEMO_DELETED, MEMO_EDITED, MEMO_NOTE, MEMO_PLACEHOLDER, repliesLabel } from "./labels";
import { MemoTextarea } from "./memo-textarea";

/**
 * 업무 Chat 의 메모 (feature-plan F8, 시안 v2 의 composer · renderEvent memo). 모두 서버 액션 폼이라 자바스크립트 없이도 동작한다.
 * 답글(F9)도 같은 조각으로 그린다 — 스레드 칸 안에서는 inThread 에 그 스레드 이름이 들어와, 고치기 · 지우기 뒤에 스레드로 돌아온다.
 */

/**
 * 스레드 칸을 여는 주소. 같은 화면을 ?thread= 로 다시 그린다(자바스크립트 없이도 동작한다).
 * 조각(#)은 대상 항목의 자리다 — 넓은 화면에서는 타임라인이 그 항목에 머문 채 오른쪽에 스레드가 열리고,
 * 휴대전화 폭에서는 스레드가 화면 전체를 덮으므로 어디에 머물든 상관없다.
 */
export function threadHref(workId: string, key: string, anchor: string): string {
  return `/works/${encodeURIComponent(workId)}?thread=${encodeURIComponent(key)}#${anchor}`;
}

/** 메모 · PR 카드 아래의 Reply · "답글 N". canReply 가 아니면 Reply 는 없고, 답글이 있을 때만 "답글 N" 으로 열어 읽는다 */
export function ReplyFoot({
  workId,
  thread,
  anchor,
  replies,
  canReply,
}: {
  workId: string;
  thread: string;
  /** 대상 항목의 자리 (id) */
  anchor: string;
  replies: number;
  canReply: boolean;
}) {
  if (!canReply && replies === 0) return null;
  const href = threadHref(workId, thread, anchor);
  return (
    <>
      {canReply && (
        <a className="btn text tiny" href={href} data-testid="reply-open">
          Reply
        </a>
      )}
      {replies > 0 && (
        <a className="replies" href={href} data-testid="reply-count">
          {repliesLabel(replies)}
        </a>
      )}
    </>
  );
}

/** 타임라인 아래의 입력칸 · Send · 안내 문장 */
export function MemoComposer({ workId, problem }: { workId: string; problem: string | null }) {
  return (
    <div className="composer" id="composer" data-testid="memo-composer">
      {problem !== null && (
        <p className="source-error" data-testid="memo-problem">
          메모를 저장하지 않았다 — {problem}
        </p>
      )}
      <form action={writeMemoAction} className="composer-box">
        <input type="hidden" name="workId" value={workId} />
        <MemoTextarea name="body" rows={1} required maxLength={MAX_MEMO_LENGTH} placeholder={MEMO_PLACEHOLDER} aria-label="Memo" />
        <button type="submit" className="btn">
          Send
        </button>
      </form>
      <p className="note">{MEMO_NOTE}</p>
    </div>
  );
}

/**
 * 타임라인의 메모 한 줄, 또는 스레드 칸의 답글 한 줄. 작성자 "나" · 본문(줄바꿈 그대로) · 고쳤으면 "고침".
 * 지운 메모는 "지워진 메모" 자리만 남는다. 고치기 칸은 Edit 을 눌렀을 때만 열리고, 거기서 Save · Delete · Cancel 을 고른다
 * (지우기는 고치기 칸 안에만 두어 한 번 더 누르게 한다).
 * 타임라인의 메모(inThread 가 null)에는 Reply · "답글 N" 이 붙는다. 스레드 안의 답글에는 Reply 가 없다 — 스레드는 한 단계만이고,
 * 이어서 쓰는 답글은 스레드 아래 입력칸에서 같은 스레드로 들어간다.
 */
export function MemoEvent({
  memo,
  workId,
  editing,
  inThread = null,
  replies = 0,
}: {
  memo: Memo;
  workId: string;
  editing: boolean;
  /** 스레드 칸 안에서 그릴 때 그 스레드 이름(threadKey). 타임라인이면 null */
  inThread?: string | null;
  /** 타임라인의 메모일 때, 그 스레드의 답글 수 */
  replies?: number;
}) {
  const byline = (
    <span className="by">
      {MEMO_AUTHOR_LABEL}
      <small>{inThread === null ? "메모" : "답글"}</small>
    </span>
  );
  const topFoot =
    inThread === null ? (
      <ReplyFoot workId={workId} thread={threadKey({ kind: "memo", memoId: memo.id })} anchor={`memo-${memo.id}`} replies={replies} canReply={memo.deletedAt === null} />
    ) : null;
  if (memo.deletedAt !== null) {
    return (
      <div className="memo deleted" data-testid="memo-deleted">
        {byline}
        <span title={formatKst(memo.deletedAt)}>{MEMO_DELETED}</span>
        {topFoot !== null && replies > 0 && <div className="ev-foot">{topFoot}</div>}
      </div>
    );
  }
  const workPath = `/works/${encodeURIComponent(workId)}`;
  const here = (extra: Record<string, string>) => {
    const query = new URLSearchParams({ ...(inThread === null ? {} : { thread: inThread }), ...extra }).toString();
    return `${workPath}${query === "" ? "" : `?${query}`}#memo-${memo.id}`;
  };
  if (editing) {
    return (
      <div className="memo" data-testid="memo-editing">
        {byline}
        <form action={editMemoAction} className="composer-box memo-edit">
          <input type="hidden" name="workId" value={workId} />
          <input type="hidden" name="memoId" value={memo.id} />
          {inThread !== null && <input type="hidden" name="thread" value={inThread} />}
          <MemoTextarea name="body" rows={2} required maxLength={MAX_MEMO_LENGTH} defaultValue={memo.body} aria-label="Edit memo" autoFocus />
          <div className="ev-foot">
            <button type="submit" className="btn tiny">
              Save
            </button>
            <button type="submit" className="btn tiny" formAction={deleteMemoAction} formNoValidate>
              Delete
            </button>
            <a className="btn text tiny" href={here({})}>
              Cancel
            </a>
          </div>
        </form>
      </div>
    );
  }
  return (
    <div className="memo" data-testid="memo">
      {byline}
      <span className="memo-body" data-testid="memo-body">
        {memo.body}
      </span>
      {memo.editedAt !== null && (
        <small className="memo-edited" title={formatKst(memo.editedAt)} data-testid="memo-edited">
          {MEMO_EDITED}
        </small>
      )}
      <div className="ev-foot">
        <a className="btn text tiny" href={here({ edit: memo.id })}>
          Edit
        </a>
        {topFoot}
      </div>
    </div>
  );
}

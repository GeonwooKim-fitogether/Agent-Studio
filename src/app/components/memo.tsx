import type { Memo } from "../../domain/memo";
import { MAX_MEMO_LENGTH } from "../../domain/memo";
import { deleteMemoAction, editMemoAction, writeMemoAction } from "../actions";
import { formatKst, MEMO_AUTHOR_LABEL, MEMO_DELETED, MEMO_EDITED, MEMO_NOTE, MEMO_PLACEHOLDER } from "./labels";
import { MemoTextarea } from "./memo-textarea";

/**
 * 업무 Chat 의 메모 (feature-plan F8, 시안 v2 의 composer · renderEvent memo). 모두 서버 액션 폼이라 자바스크립트 없이도 동작한다.
 * 스레드(F9)는 다음 단위라 Reply 는 그리지 않는다(결정 7).
 */

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
 * 타임라인의 메모 한 줄. 작성자 "나" · 본문(줄바꿈 그대로) · 고쳤으면 "고침".
 * 지운 메모는 "지워진 메모" 자리만 남는다. 고치기 칸은 Edit 을 눌렀을 때만 열리고, 거기서 Save · Delete · Cancel 을 고른다
 * (지우기는 고치기 칸 안에만 두어 한 번 더 누르게 한다).
 */
export function MemoEvent({ memo, workId, editing }: { memo: Memo; workId: string; editing: boolean }) {
  const byline = (
    <span className="by">
      {MEMO_AUTHOR_LABEL}
      <small>메모</small>
    </span>
  );
  if (memo.deletedAt !== null) {
    return (
      <div className="memo deleted" data-testid="memo-deleted">
        {byline}
        <span title={formatKst(memo.deletedAt)}>{MEMO_DELETED}</span>
      </div>
    );
  }
  const workPath = `/works/${encodeURIComponent(workId)}`;
  if (editing) {
    return (
      <div className="memo" data-testid="memo-editing">
        {byline}
        <form action={editMemoAction} className="composer-box memo-edit">
          <input type="hidden" name="workId" value={workId} />
          <input type="hidden" name="memoId" value={memo.id} />
          <MemoTextarea name="body" rows={2} required maxLength={MAX_MEMO_LENGTH} defaultValue={memo.body} aria-label="Edit memo" autoFocus />
          <div className="ev-foot">
            <button type="submit" className="btn tiny">
              Save
            </button>
            <button type="submit" className="btn tiny" formAction={deleteMemoAction} formNoValidate>
              Delete
            </button>
            <a className="btn text tiny" href={`${workPath}#memo-${memo.id}`}>
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
        <a className="btn text tiny" href={`${workPath}?edit=${encodeURIComponent(memo.id)}#memo-${memo.id}`}>
          Edit
        </a>
      </div>
    </div>
  );
}

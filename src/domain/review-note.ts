/**
 * 내부 검토 결정에 붙는 글 (Focus 시안 · 결정 18, 계약 §5). Studio 가 소유한다. 순수 규칙만 있다.
 *
 * Request changes 는 두 칸이 모두 있어야 남는다. 받는 사람(작성자 · 다음 세션)이 "무엇을 고치면 끝나나" 를 알아야 하기 때문이다.
 *   reason    무엇이 왜 문제인가
 *   doneWhen  무엇이 되면 수정이 끝난 것인가 (수정 기준)
 * Approve in Studio 는 reason 칸 하나를 선택 메모로 쓴다(비워도 된다). doneWhen 은 남기지 않는다.
 *
 * 글 규칙은 메모와 같은 방식이다(줄바꿈은 받고, 앞뒤 공백은 떼고, 줄바꿈 밖의 제어 문자는 받지 않는다).
 */
import { CONTROL_BUT_NEWLINE } from "./memo";
import type { ReviewVerdict } from "./model";

export const MAX_REVIEW_NOTE_LENGTH = 2000;

export type ReviewNoteProblem = "reason_missing" | "done_when_missing" | "too_long" | "control_char";

type Checked = { readonly ok: true; readonly text: string | null } | { readonly ok: false; readonly problem: "too_long" | "control_char" };

/** 칸 하나. 비었으면 null */
function checkField(raw: string | null | undefined): Checked {
  const text = (raw ?? "").replace(/\r\n?/g, "\n").trim();
  if (text === "") return { ok: true, text: null };
  if (CONTROL_BUT_NEWLINE.test(text)) return { ok: false, problem: "control_char" };
  if ([...text].length > MAX_REVIEW_NOTE_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, text };
}

export interface ReviewNote {
  readonly reason: string | null;
  readonly doneWhen: string | null;
}

/**
 * 결정과 두 칸을 받아 저장할 모양을 돌려준다. 걸리면 이유를 돌려준다(던지지 않는다).
 * 확인 순서: 글 모양(제어 문자 · 길이) → Request changes 의 reason → doneWhen.
 */
export function checkReviewNote(
  verdict: ReviewVerdict,
  raw: { readonly reason?: string | null; readonly doneWhen?: string | null },
): ({ readonly ok: true } & ReviewNote) | { readonly ok: false; readonly problem: ReviewNoteProblem } {
  const reason = checkField(raw.reason);
  if (!reason.ok) return reason;
  if (verdict === "internal_review_done") return { ok: true, reason: reason.text, doneWhen: null };
  const doneWhen = checkField(raw.doneWhen);
  if (!doneWhen.ok) return doneWhen;
  if (reason.text === null) return { ok: false, problem: "reason_missing" };
  if (doneWhen.text === null) return { ok: false, problem: "done_when_missing" };
  return { ok: true, reason: reason.text, doneWhen: doneWhen.text };
}

/** 저장소가 받아도 되는 칸인가 — null 이거나, 규칙을 통과하고 이미 맞춰진 비지 않은 글 */
export function isAcceptedReviewNoteField(value: unknown): value is string | null {
  if (value === null) return true;
  if (typeof value !== "string") return false;
  const checked = checkField(value);
  return checked.ok && checked.text === value;
}

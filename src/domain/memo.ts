/**
 * 메모 — 사람이 업무 Chat 에 남기는 판단의 이유 (feature-plan F8). Studio 가 소유한다(결정 4).
 * 순수 규칙만 있다. 저장소 · 화면을 모른다.
 *
 * - 작성자는 첫 버전에서 "나" 한 명이다(결정 15). 저장 구조에는 작성자 칸을 남겨 두고 MEMO_AUTHOR_ME 로 채운다.
 *   로그인이 붙으면 이 칸을 사람마다 다르게 채우면 된다.
 * - 고치면 editedAt 이 남고 화면에 "고침" 이 붙는다.
 * - 지우면 deletedAt 이 남고 본문은 비운다. 타임라인에는 "지워진 메모" 자리만 남는다. 지운 메모는 고칠 수 없다.
 * - 스레드(F9)는 다음 단위다. 답글이 어느 항목에 달렸는지는 그때 칸을 더한다 — 이 모양은 그것을 막지 않는다.
 *
 * 본문 규칙 (업무 제목 규칙 src/domain/work-title.ts 와 같은 방식). 줄바꿈은 받는다.
 *   줄바꿈 \r\n · \r 은 \n 하나로 맞추고, 앞뒤 공백 · 빈 줄은 떼고 받는다. 받지 않는 것은 셋이다.
 *   empty         떼고 나니 아무 글자도 없다
 *   too_long      MAX_MEMO_LENGTH 글자(코드 포인트)를 넘는다
 *   control_char  줄바꿈(\n) 밖의 보이지 않는 제어 문자가 들어 있다 — 탭 · NUL 같은 C0/C1 제어 문자, 줄 · 문단 구분자,
 *                 글자의 방향을 뒤집어 화면에 다른 글처럼 보이게 하는 방향 제어 문자(U+202A–U+202E, U+2066–U+2069).
 */

export const MAX_MEMO_LENGTH = 4000;

/** 첫 버전의 유일한 작성자 "나" (결정 15) */
export const MEMO_AUTHOR_ME = "me";

export interface Memo {
  readonly id: string;
  readonly workId: string;
  readonly author: string;
  /** 지운 메모면 빈 글이다 */
  readonly body: string;
  readonly createdAt: string;
  /** 마지막으로 고친 시각. 고친 적 없으면 null */
  readonly editedAt: string | null;
  /** 지운 시각. 지우지 않았으면 null */
  readonly deletedAt: string | null;
}

export type MemoBodyProblem = "empty" | "too_long" | "control_char";

const CONTROL_BUT_NEWLINE = /[\0-\x09\x0B-\x1F\x7F-\x9F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

export function checkMemoBody(raw: string): { readonly ok: true; readonly body: string } | { readonly ok: false; readonly problem: MemoBodyProblem } {
  const body = raw.replace(/\r\n?/g, "\n").trim();
  if (body === "") return { ok: false, problem: "empty" };
  if (CONTROL_BUT_NEWLINE.test(body)) return { ok: false, problem: "control_char" };
  if ([...body].length > MAX_MEMO_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, body };
}

/** 저장소가 받아도 되는 본문인가 — 규칙을 통과하고 이미 맞춰진(checkMemoBody 가 돌려준) 모양이어야 한다 */
export function isAcceptedMemoBody(body: unknown): body is string {
  if (typeof body !== "string") return false;
  const checked = checkMemoBody(body);
  return checked.ok && checked.body === body;
}

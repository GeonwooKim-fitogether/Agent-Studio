/**
 * 사람이 New Work 에 적는 업무 제목의 규칙 (feature-plan F5).
 *
 * 앞뒤 공백은 떼고 받는다. 받지 않는 것은 셋이다.
 *   empty         떼고 나니 아무 글자도 없다
 *   too_long      MAX_WORK_TITLE_LENGTH 글자(코드 포인트)를 넘는다. 목록 한 줄에 보이는 이름이지 설명문이 아니다
 *   control_char  보이지 않는 제어 문자가 들어 있다 — 줄바꿈 · 탭 · NUL 같은 C0/C1 제어 문자, 줄 · 문단 구분자,
 *                 그리고 글자의 방향을 뒤집어 화면에 다른 글처럼 보이게 하는 방향 제어 문자(U+202A–U+202E, U+2066–U+2069).
 *                 이모지를 잇는 결합자(ZWJ) 같은 다른 서식 문자는 막지 않는다.
 */

export const MAX_WORK_TITLE_LENGTH = 200;

export type WorkTitleProblem = "empty" | "too_long" | "control_char";

const CONTROL = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

export function checkWorkTitle(raw: string): { readonly ok: true; readonly title: string } | { readonly ok: false; readonly problem: WorkTitleProblem } {
  const title = raw.trim();
  if (title === "") return { ok: false, problem: "empty" };
  if (CONTROL.test(title)) return { ok: false, problem: "control_char" };
  if ([...title].length > MAX_WORK_TITLE_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, title };
}

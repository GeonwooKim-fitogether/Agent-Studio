/**
 * 업무의 목표 (Focus 시안 · 결정 18). 업무 화면의 대화 위에 고정되는 한두 문장이다. Studio 가 소유한다.
 * 순수 규칙만 있다. 저장소 · 화면을 모른다.
 *
 * New Work 는 목표를 반드시 받는다. Inbox 의 PR 로 만든 업무와 목표 칸이 생기기 전의 업무는 목표가 비어 있고(""),
 * 업무 화면에서 Set goal 로 적는다. 한 번 적은 목표는 Edit goal 로 고치되 비울 수는 없다.
 *
 * 글 규칙은 메모(src/domain/memo.ts)와 같은 방식이다. 줄바꿈 \r\n · \r 은 \n 하나로 맞추고 앞뒤 공백은 떼고 받는다.
 *   empty         떼고 나니 아무 글자도 없다
 *   too_long      MAX_WORK_GOAL_LENGTH 글자(코드 포인트)를 넘는다 — 목표는 설명서가 아니라 한두 문장이다
 *   control_char  줄바꿈(\n) 밖의 보이지 않는 제어 문자(탭 · NUL · 줄 구분자 · 방향 제어 문자)가 들어 있다
 */
import { CONTROL_BUT_NEWLINE } from "./memo";

export const MAX_WORK_GOAL_LENGTH = 500;

export type WorkGoalProblem = "empty" | "too_long" | "control_char";

export function checkWorkGoal(raw: string): { readonly ok: true; readonly goal: string } | { readonly ok: false; readonly problem: WorkGoalProblem } {
  const goal = raw.replace(/\r\n?/g, "\n").trim();
  if (goal === "") return { ok: false, problem: "empty" };
  if (CONTROL_BUT_NEWLINE.test(goal)) return { ok: false, problem: "control_char" };
  if ([...goal].length > MAX_WORK_GOAL_LENGTH) return { ok: false, problem: "too_long" };
  return { ok: true, goal };
}

/**
 * 저장소가 받아도 되는 목표인가 — 빈 목표("", 아직 적지 않음)이거나, 규칙을 통과하고 이미 맞춰진 모양이어야 한다.
 * 두 저장 구현(메모리 · PostgreSQL)이 같은 값에 같은 답을 내도록 이 함수 하나로 판정한다.
 */
export function isAcceptedWorkGoal(goal: unknown): goal is string {
  if (typeof goal !== "string") return false;
  if (goal === "") return true;
  const checked = checkWorkGoal(goal);
  return checked.ok && checked.goal === goal;
}

/**
 * 메모 — 사람이 업무 Chat 에 남기는 판단의 이유 (feature-plan F8). Studio 가 소유한다(결정 4).
 * 순수 규칙만 있다. 저장소 · 화면을 모른다.
 *
 * - 작성자는 첫 버전에서 "나" 한 명이다(결정 15). 저장 구조에는 작성자 칸을 남겨 두고 MEMO_AUTHOR_ME 로 채운다.
 *   로그인이 붙으면 이 칸을 사람마다 다르게 채우면 된다.
 * - 고치면 editedAt 이 남고 화면에 "고침" 이 붙는다.
 * - 지우면 deletedAt 이 남고 본문은 비운다. 타임라인에는 "지워진 메모" 자리만 남는다. 지운 메모는 고칠 수 없다.
 * - 답글(F9 스레드)도 메모다. 본문 규칙 · 고치기 · 지우기가 같고, thread 칸이 "어느 항목에 달렸는지" 를 가리킨다.
 *   최상위 메모는 thread 가 null 이다. 스레드는 한 단계만이다 — 답글의 대상은 최상위 항목(메모 또는 PR 카드의 커밋)뿐이고,
 *   답글에 단 답글은 같은 스레드에 들어간다(resolveThread). 저장소와 데이터베이스도 답글에 답글을 받지 않는다.
 *   PR 카드의 스레드는 **그 커밋의 카드**에 붙는다(계약 §3-2 "이 PR 의 이 커밋"). 새 커밋이 오면 새 카드가 새 스레드를 갖고,
 *   옛 스레드는 옛 카드에 남는다.
 *
 * 본문 규칙 (업무 제목 규칙 src/domain/work-title.ts 와 같은 방식). 줄바꿈은 받는다.
 *   줄바꿈 \r\n · \r 은 \n 하나로 맞추고, 앞뒤 공백 · 빈 줄은 떼고 받는다. 받지 않는 것은 셋이다.
 *   empty         떼고 나니 아무 글자도 없다
 *   too_long      MAX_MEMO_LENGTH 글자(코드 포인트)를 넘는다
 *   control_char  줄바꿈(\n) 밖의 보이지 않는 제어 문자가 들어 있다 — 탭 · NUL 같은 C0/C1 제어 문자, 줄 · 문단 구분자,
 *                 글자의 방향을 뒤집어 화면에 다른 글처럼 보이게 하는 방향 제어 문자(U+202A–U+202E, U+2066–U+2069).
 */

import { isValidPrRef } from "./model";

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
  /** 답글이면 달린 항목, 최상위 메모면 null (F9) */
  readonly thread: ThreadTarget | null;
}

/** 스레드가 달리는 최상위 항목 — 메모 하나, 또는 PR 카드 하나(= 그 PR 의 그 커밋) */
export type ThreadTarget =
  | { readonly kind: "memo"; readonly memoId: string }
  | { readonly kind: "card"; readonly repoId: number; readonly number: number; readonly commitSha: string };

const SHA = /^[0-9a-f]{7,64}$/;
const MEMO_ID = /^[a-z0-9]+$/;

/** 저장소가 받아도 되는 대상인가 — 메모 ID 는 영문 소문자 · 숫자, PR 은 범위 안, 커밋은 소문자 16진수 7~64자 */
export function isValidThreadTarget(t: unknown): t is ThreadTarget {
  if (typeof t !== "object" || t === null) return false;
  const v = t as Record<string, unknown>;
  if (v["kind"] === "memo") return typeof v["memoId"] === "string" && MEMO_ID.test(v["memoId"]);
  if (v["kind"] !== "card") return false;
  return isValidPrRef({ repoId: v["repoId"], number: v["number"] }) && typeof v["commitSha"] === "string" && SHA.test(v["commitSha"]);
}

/** 답글인가 (최상위 메모가 아닌가) */
export function isReply(memo: Memo): boolean {
  return memo.thread !== null;
}

export function sameThread(a: ThreadTarget, b: ThreadTarget): boolean {
  if (a.kind === "memo") return b.kind === "memo" && a.memoId === b.memoId;
  return b.kind === "card" && a.repoId === b.repoId && a.number === b.number && a.commitSha === b.commitSha;
}

/** 주소에 싣는 스레드 이름. memo:<메모 ID> 또는 card:<저장소 ID>:<PR 번호>:<커밋 SHA> */
export function threadKey(t: ThreadTarget): string {
  return t.kind === "memo" ? `memo:${t.memoId}` : `card:${t.repoId}:${t.number}:${t.commitSha}`;
}

/** threadKey 의 반대. 모양이 틀리면 null */
export function parseThreadKey(key: string): ThreadTarget | null {
  const parts = key.split(":");
  let t: ThreadTarget | null = null;
  if (parts[0] === "memo" && parts.length === 2) t = { kind: "memo", memoId: parts[1]! };
  if (parts[0] === "card" && parts.length === 4 && /^\d{1,16}$/.test(parts[1]!) && /^\d{1,10}$/.test(parts[2]!)) {
    t = { kind: "card", repoId: Number(parts[1]), number: Number(parts[2]), commitSha: parts[3]! };
  }
  return t !== null && isValidThreadTarget(t) ? t : null;
}

/**
 * 스레드는 한 단계만이다. 답글을 대상으로 고르면(답글에 답글) 그 답글이 달린 최상위 항목의 스레드가 된다.
 * memos 는 그 업무의 메모들이다. 대상 메모를 찾지 못하면 대상을 그대로 돌려준다(있는지는 부르는 쪽이 확인한다).
 */
export function resolveThread(target: ThreadTarget, memos: readonly Memo[]): ThreadTarget {
  if (target.kind !== "memo") return target;
  const memo = memos.find((m) => m.id === target.memoId);
  return memo?.thread ?? target;
}

export type MemoBodyProblem = "empty" | "too_long" | "control_char";

/** 줄바꿈(\n) 밖의 보이지 않는 제어 문자. 목표(work-goal.ts) · 검토 결정의 글(review-note.ts)도 같은 규칙을 쓴다 */
export const CONTROL_BUT_NEWLINE =/[\0-\x09\x0B-\x1F\x7F-\x9F\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

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

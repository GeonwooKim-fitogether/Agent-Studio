/**
 * Review 패널의 결정이 거절됐을 때(새 커밋 도착 · 빈 칸 등) 적어 둔 Reason · Done when 을 되살리는 짧은 쿠키 (결정 18, Q9).
 * 본문을 주소에 싣지 않기 위해서다. 10분 뒤 사라지고, 결정이 남으면 서버 액션이 지운다.
 */
export const REVIEW_DRAFT_COOKIE = "studio-review-draft";

export interface ReviewDraft {
  readonly key: string;
  readonly workId: string;
  readonly reason: string;
  readonly doneWhen: string;
}

/** 주소의 ?review= 값 — "<저장소 숫자 ID>:<PR 번호>". 값이 PR 모양이 아니면 null */
export function reviewKeyOf(ref: { readonly repoId: number; readonly number: number }): string | null {
  return Number.isSafeInteger(ref.repoId) && ref.repoId > 0 && Number.isSafeInteger(ref.number) && ref.number > 0 ? `${ref.repoId}:${ref.number}` : null;
}

export function parseReviewKey(value: unknown): { readonly repoId: number; readonly number: number } | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{1,16}):(\d{1,10})$/.exec(value);
  if (match === null) return null;
  return { repoId: Number(match[1]), number: Number(match[2]) };
}

export function readReviewDraft(raw: string | undefined): ReviewDraft | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof parsed !== "object" || parsed === null) return null;
    const v = parsed as Record<string, unknown>;
    if (typeof v["key"] !== "string" || typeof v["workId"] !== "string" || typeof v["reason"] !== "string" || typeof v["doneWhen"] !== "string") return null;
    return { key: v["key"], workId: v["workId"], reason: v["reason"], doneWhen: v["doneWhen"] };
  } catch {
    return null;
  }
}

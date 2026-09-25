/**
 * 신선도 규칙 — PR 에 새 커밋이 올라오면, 그 전 커밋을 근거로 만든 기록은 "이전 버전" 이 된다 (계약 §6).
 *
 * 판정은 기록을 지우지 않는다. 기록은 남되 현재 판단으로 읽히지 않게 표시만 바꾼다.
 */

/** "current" 는 PR 의 최신 커밋에 대한 기록, "outdated" 는 이전 커밋에 대한 기록(이전 버전)이다. */
export type Freshness = "current" | "outdated";

/** 커밋에 고정된 기록(미리보기 기록, 내부 검토 결정)이 PR 의 최신 커밋을 근거로 하는지 판정한다. 커밋은 SHA 로만 같다. */
export function freshnessOf(record: { readonly commitSha: string }, latestHeadSha: string): Freshness {
  return record.commitSha === latestHeadSha ? "current" : "outdated";
}

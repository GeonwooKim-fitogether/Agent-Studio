/**
 * Review 버튼(feature-plan F2)이 부르는 규칙 — 결정은 저장된 최신 커밋에 대해, 병합 · 닫힌 PR 은 거절,
 * 같은 커밋에 다시 누르면 마지막 결정이 보이고, 새 커밋이 오면 앞선 결정은 "이전 커밋" 이 된다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { getWorkDetail } from "../../src/application/queries";
import { isReviewVerdict, recordReviewDecision, reviewBlockOf, visibleReviews } from "../../src/application/review";
import { syncAll } from "../../src/application/sync";
import { prKey, type ReviewVerdict } from "../../src/domain/model";
import { setup } from "./helpers";

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };
const NEW_HEAD = "abcdefabcdefabcdefabcdefabcdefabcdefabcd";

async function shownReviews(deps: Parameters<typeof getWorkDetail>[0]) {
  const card = (await getWorkDetail(deps, "a1b2c3"))?.prs.find((p) => p.key === prKey(payments12));
  return visibleReviews(card?.studio.reviews ?? []).map((r) => [r.verdict, r.freshness, r.commitSha]);
}

describe("Review 버튼의 규칙", () => {
  it("결정은 저장된 PR 스냅샷의 최신 커밋에 대해 남는다 — 요청에 다른 SHA 가 섞여 와도 쓰지 않는다", async () => {
    const { deps, readerCalls } = setup();
    await syncAll(deps);
    const calls = readerCalls.length;
    const forged = { ...payments12, workId: "a1b2c3", verdict: "internal_review_done" as const, commitSha: "0".repeat(40) };
    const decision = await recordReviewDecision(deps, forged);
    expect(decision.commitSha).toBe(DEMO_SHA.payments12Head);
    expect(readerCalls.length).toBe(calls); // GitHub 쪽으로 아무것도 묻거나 보내지 않았다
  });

  it("병합되거나 닫힌 PR 에는 결정을 남기지 않고, 아무것도 저장하지 않는다", async () => {
    const { data, deps } = setup();
    // 닫힌 PR 을 만들려고 payments#12 를 닫힌 상태로 바꾼다 (#15 는 원래 병합됨)
    data.pullRequests = data.pullRequests.map((p) => (p.repoId === DEMO_REPO.payments && p.number === 12 ? { ...p, state: "closed" } : p));
    await syncAll(deps);
    const before = (await deps.store.listReviewDecisions()).length;
    for (const number of [12, 15]) {
      await expect(
        recordReviewDecision(deps, { repoId: DEMO_REPO.payments, number, workId: "a1b2c3", verdict: "internal_review_done" }),
      ).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(await deps.store.listReviewDecisions()).toHaveLength(before);
    expect(reviewBlockOf({ state: "merged" })).toBe("merged");
    expect(reviewBlockOf({ state: "closed" })).toBe("closed");
    expect(reviewBlockOf({ state: "open" })).toBeNull();
  });

  it("형식이 틀린 업무 ID · 결정 값 · PR 값은 저장소에 닿기 전에 거절한다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const base = { ...payments12, workId: "a1b2c3", verdict: "internal_review_done" as ReviewVerdict };
    await expect(recordReviewDecision(deps, { ...base, workId: "../a1b2c3" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(recordReviewDecision(deps, { ...base, verdict: "approved" as ReviewVerdict })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(recordReviewDecision(deps, { ...base, number: 2 ** 31 })).rejects.toMatchObject({ code: "invalid_input" });
    expect(isReviewVerdict("internal_review_done")).toBe(true);
    expect(isReviewVerdict("changes_requested")).toBe(true);
    expect(isReviewVerdict("approved")).toBe(false);
    expect(isReviewVerdict(null)).toBe(false);
  });

  it("같은 커밋에 다시 누르면 기록은 쌓이지만 카드에는 그 커밋의 마지막 결정만 보이고, 이전 커밋의 결정은 이전 커밋으로 남는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const target = { ...payments12, workId: "a1b2c3" };
    await recordReviewDecision(deps, { ...target, verdict: "internal_review_done" });
    await recordReviewDecision(deps, { ...target, verdict: "changes_requested" });

    expect(await shownReviews(deps)).toEqual([
      ["changes_requested", "outdated", DEMO_SHA.payments12Reviewed], // 시연 데이터의 이전 커밋 결정
      ["changes_requested", "current", DEMO_SHA.payments12Head],
    ]);
    const stored = (await deps.store.listReviewDecisions()).filter((r) => r.repoId === DEMO_REPO.payments && r.number === 12);
    expect(stored).toHaveLength(3); // 지우지 않는다
  });

  it("누른 뒤 PR 에 새 커밋이 오면, 방금 남긴 결정은 이전 커밋에 대한 결정으로 보이고 새 커밋에는 결정이 없다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    await recordReviewDecision(deps, { ...payments12, workId: "a1b2c3", verdict: "internal_review_done" });

    data.pullRequests = data.pullRequests.map((p) => (p.repoId === DEMO_REPO.payments && p.number === 12 ? { ...p, headSha: NEW_HEAD } : p));
    await syncAll(deps);

    expect(await shownReviews(deps)).toEqual([
      ["changes_requested", "outdated", DEMO_SHA.payments12Reviewed],
      ["internal_review_done", "outdated", DEMO_SHA.payments12Head],
    ]);
    // 새 커밋에 다시 누르면 새 커밋의 결정이 생긴다
    await recordReviewDecision(deps, { ...payments12, workId: "a1b2c3", verdict: "internal_review_done" });
    expect((await shownReviews(deps)).at(-1)).toEqual(["internal_review_done", "current", NEW_HEAD]);
  });
});

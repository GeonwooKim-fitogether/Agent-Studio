/**
 * 업무 상태가 실제로 바뀌는 자리 (feature-plan F3) — Sync 가 끝날 때, 사람이 연결 · 해제 · Review · Mark as Done · 상태 변경을 한 뒤.
 * 시연 데이터(fixture)로 유스케이스를 돌리고, 저장소에 남은 상태와 이력을 본다.
 *
 * 시연 데이터의 처음 모습:
 *   로그인 화면 만들기(a1b2c3, 진행 중)   payments#12 열림 · 검사 실패, payments#15 병합됨
 *   관리자 로그인 보안 점검(d0e1f2, 진행 중) admin-console#12 열림 · 검사 통과 · 최신 커밋에 내부 검토 완료
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO } from "../../src/adapters/github/fixture/demo-scenario";
import { createWorkFromPr, linkPrToWork, unlinkPr } from "../../src/application/inbox-actions";
import { getWorkDetail } from "../../src/application/queries";
import { recordReviewDecision } from "../../src/application/review";
import { syncAll } from "../../src/application/sync";
import { refreshWorkStatuses, setWorkStatusByPerson } from "../../src/application/work-status";
import type { PrSnapshot } from "../../src/domain/model";
import { setup } from "./helpers";

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };
const docs12 = { repoId: DEMO_REPO.docsSite, number: 12 };

async function statusOf(deps: ReturnType<typeof setup>["deps"], workId: string) {
  return (await deps.store.getWork(workId))?.status;
}
async function historyOf(deps: ReturnType<typeof setup>["deps"], workId: string) {
  return (await deps.store.listStatusChanges())
    .filter((c) => c.workId === workId)
    .map((c) => `${c.cause.kind === "rule" ? c.cause.rule : c.cause.action}:${c.from}->${c.to}`);
}
function changePr(data: ReturnType<typeof setup>["data"], ref: { repoId: number; number: number }, fields: Partial<PrSnapshot>) {
  data.pullRequests = data.pullRequests.map((p) => (p.repoId === ref.repoId && p.number === ref.number ? { ...p, ...fields } : p));
}

describe("Sync 가 끝날 때 다시 판정한다", () => {
  it("첫 동기화는 시연 업무의 상태를 바꾸지 않는다 (이미 규칙과 맞다)", async () => {
    const { deps } = setup();
    const result = await syncAll(deps);
    expect(result.statusChanges).toBe(0);
    expect(await deps.store.listStatusChanges()).toEqual([]);
  });

  it("GitHub 에서 남은 PR 이 병합되면 다음 Sync 에 완료 후보(R4)가 되고, 같은 입력의 Sync 를 다시 해도 이력이 늘지 않는다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    changePr(data, payments12, { state: "merged" });
    expect((await syncAll(deps)).statusChanges).toBe(1);
    expect(await statusOf(deps, "a1b2c3")).toBe("done_candidate");
    expect(await historyOf(deps, "a1b2c3")).toEqual(["R4:in_progress->done_candidate"]);

    await syncAll(deps);
    await syncAll(deps);
    expect(await historyOf(deps, "a1b2c3")).toHaveLength(1);
    expect(await statusOf(deps, "a1b2c3")).toBe("done_candidate"); // 자동으로 완료하지 않는다
  });

  it("검사가 통과로 바뀌면 검토 필요(R2), 그 커밋에 새 커밋이 오면 진행 중(R2)", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    changePr(data, payments12, { checks: "passing" });
    await syncAll(deps);
    expect(await statusOf(deps, "a1b2c3")).toBe("needs_review");
    changePr(data, payments12, { headSha: "e".repeat(40), checks: "pending" });
    await syncAll(deps);
    expect(await historyOf(deps, "a1b2c3")).toEqual(["R2:in_progress->needs_review", "R2:needs_review->in_progress"]);
  });

  it("동시에 두 번 판정해도 이력이 한 번만 쌓인다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    changePr(data, payments12, { state: "merged" });
    await Promise.all([syncAll(deps), refreshWorkStatuses(deps), refreshWorkStatuses(deps)]);
    expect(await historyOf(deps, "a1b2c3")).toEqual(["R4:in_progress->done_candidate"]);
  });
});

describe("사람이 무언가를 한 뒤 그 자리에서 다시 판정한다", () => {
  it("New Work: 검사가 없는 PR 로 업무를 만들면 R1 다음 R2 로 검토 필요", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const work = await createWorkFromPr(deps, docs12);
    expect(await statusOf(deps, work.id)).toBe("needs_review");
    expect(await historyOf(deps, work.id)).toEqual(["R1:draft->in_progress", "R2:in_progress->needs_review"]);
  });

  it("Link to Work: 초안인 업무에 검사 진행 중인 PR 을 붙이면 R1 로 진행 중", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await linkPrToWork(deps, { repoId: DEMO_REPO.coachWeb, number: 12, workId: "b4c5d6" });
    expect(await historyOf(deps, "b4c5d6")).toEqual(["R1:draft->in_progress"]);
  });

  it("Approve 하면 진행 중(R3b), 같은 커밋에 Request Changes 로 바꿔도 진행 중이라 이력이 늘지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const work = await createWorkFromPr(deps, docs12);
    await recordReviewDecision(deps, { ...docs12, workId: work.id, verdict: "internal_review_done" });
    expect(await statusOf(deps, work.id)).toBe("in_progress");
    expect((await historyOf(deps, work.id)).at(-1)).toBe("R3b:needs_review->in_progress");
    await recordReviewDecision(deps, { ...docs12, workId: work.id, verdict: "changes_requested" });
    expect(await historyOf(deps, work.id)).toHaveLength(3);
  });

  it("Unlink: 열린 PR 을 떼면 남은 병합된 PR 로 완료 후보(R4) — 초안으로 되돌아가지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });
    expect(await statusOf(deps, "a1b2c3")).toBe("done_candidate");
  });

  it("Mark as Done 은 완료 후보일 때만 완료로 바꾸고, 다시 누르면 아무 일도 하지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await expect(setWorkStatusByPerson(deps, { workId: "a1b2c3", status: "done", action: "mark_done" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });
    await setWorkStatusByPerson(deps, { workId: "a1b2c3", status: "done", action: "mark_done" });
    await setWorkStatusByPerson(deps, { workId: "a1b2c3", status: "done", action: "mark_done" });
    expect(await statusOf(deps, "a1b2c3")).toBe("done");
    expect(await historyOf(deps, "a1b2c3")).toEqual(["R4:in_progress->done_candidate", "mark_done:done_candidate->done"]);
  });

  it("완료 뒤 다시 PR 을 연결하면 R5 로 진행 중", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });
    await setWorkStatusByPerson(deps, { workId: "a1b2c3", status: "done", action: "mark_done" });
    await linkPrToWork(deps, { ...payments12, workId: "a1b2c3" });
    expect(await statusOf(deps, "a1b2c3")).toBe("in_progress");
    expect((await historyOf(deps, "a1b2c3")).at(-1)).toBe("R5:done->in_progress");
  });

  it("R6: 사람이 고른 상태는 PR 이 그대로인 동안 Sync 가 덮지 않고, 새 커밋이 오면 규칙이 다시 판단한다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    await setWorkStatusByPerson(deps, { workId: "a1b2c3", status: "needs_review", action: "set_status" });
    await syncAll(deps);
    await syncAll(deps);
    expect(await statusOf(deps, "a1b2c3")).toBe("needs_review");
    expect((await getWorkDetail(deps, "a1b2c3"))?.statusPinned).toBe(true);

    changePr(data, payments12, { headSha: "f".repeat(40), checks: "pending" });
    await syncAll(deps);
    expect(await statusOf(deps, "a1b2c3")).toBe("in_progress");
    expect(await historyOf(deps, "a1b2c3")).toEqual(["set_status:in_progress->needs_review", "R2:needs_review->in_progress"]);
    expect((await getWorkDetail(deps, "a1b2c3"))?.statusPinned).toBe(false);
  });

  it("사람은 완료 후보를 직접 고르지 못하고, 없는 업무 · 틀린 ID 는 거절한다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await expect(setWorkStatusByPerson(deps, { workId: "a1b2c3", status: "done_candidate", action: "set_status" })).rejects.toMatchObject({
      code: "invalid_input",
    });
    await expect(setWorkStatusByPerson(deps, { workId: "zz9999", status: "draft", action: "set_status" })).rejects.toMatchObject({ code: "not_found" });
    await expect(setWorkStatusByPerson(deps, { workId: "Bad-ID", status: "draft", action: "set_status" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("업무 화면의 이력 한 줄에는 근거 PR 이 저장소의 현재 이름으로 붙는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const work = await createWorkFromPr(deps, docs12);
    const detail = await getWorkDetail(deps, work.id);
    expect(detail?.latestChange).toMatchObject({
      from: "in_progress",
      to: "needs_review",
      cause: { kind: "rule", rule: "R2", evidence: [{ repoName: "demo-org/docs-site", number: 12 }] },
    });
  });
});

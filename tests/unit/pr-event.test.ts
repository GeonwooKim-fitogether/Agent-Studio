/**
 * PR 이벤트 (docs/product/feature-plan.md F7). 비교 규칙(src/domain/pr-event.ts)과, Sync · 연결 · 연결 해제가 그 규칙으로 이벤트를 남기는지.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA } from "../../src/adapters/github/fixture/demo-scenario";
import { createWorkFromPr, linkPrToWork, unlinkPr } from "../../src/application/inbox-actions";
import { syncAll } from "../../src/application/sync";
import type { PrSnapshot } from "../../src/domain/model";
import { eventOwner, linkedEvent, prChangeEvents, unlinkedEvent } from "../../src/domain/pr-event";
import { setup } from "./helpers";

const at = "2026-09-28T01:00:00.000Z";
const before: PrSnapshot = {
  repoId: 1,
  number: 7,
  title: "t",
  body: "",
  branch: "b",
  headRepoId: 1,
  headSha: "a".repeat(40),
  url: "u",
  author: "x",
  state: "open",
  checks: "passing",
  review: "none",
  updatedAt: "2026-09-27T00:00:00.000Z",
};
const after = (fields: Partial<PrSnapshot>): PrSnapshot => ({ ...before, updatedAt: "2026-09-28T00:00:00.000Z", ...fields });
const kinds = (next: PrSnapshot, prev: PrSnapshot | undefined = before) => prChangeEvents(prev, next, "w1", at).map((e) => e.kind);

describe("비교 규칙 — 앞 모습과 새 모습에서 바뀐 것만 이벤트가 된다", () => {
  it("처음 읽는 PR(앞 모습 없음)은 아무것도 남기지 않는다 — 그전의 변화를 모른다", () => {
    expect(prChangeEvents(undefined, before, "w1", at)).toEqual([]);
  });

  it("아무것도 바뀌지 않았으면 아무것도 남기지 않는다 (제목 · 본문 · 갱신 시각만 바뀌어도 같다)", () => {
    expect(kinds(before)).toEqual([]);
    expect(kinds(after({ title: "새 제목", body: "새 본문", review: "approved" }))).toEqual([]);
  });

  it("새 커밋: 검사가 아직 진행 중이면 새 커밋만, 결과가 이미 나와 있으면 새 커밋과 그 검사 결과", () => {
    expect(kinds(after({ headSha: "b".repeat(40), checks: "pending" }))).toEqual(["new_commit"]);
    expect(kinds(after({ headSha: "b".repeat(40), checks: "none" }))).toEqual(["new_commit"]);
    const events = prChangeEvents(before, after({ headSha: "b".repeat(40), checks: "failing" }), "w1", at);
    expect(events).toMatchObject([
      { kind: "new_commit", commitSha: "b".repeat(40), previousSha: "a".repeat(40), workId: "w1", at },
      { kind: "checks", commitSha: "b".repeat(40), checks: "failing" },
    ]);
  });

  it("같은 커밋의 검사 결과가 바뀌면 검사 이벤트 하나 (다시 돌린 검사가 진행 중으로 바뀐 것도)", () => {
    expect(prChangeEvents(before, after({ checks: "failing" }), "w1", at)).toMatchObject([{ kind: "checks", checks: "failing", commitSha: "a".repeat(40) }]);
    expect(kinds(after({ checks: "pending" }))).toEqual(["checks"]);
  });

  it("상태: 병합됨 · 닫힘 · 다시 열림. 한 번에 여러 가지가 바뀌면 새 커밋 → 검사 → 상태 순서다", () => {
    expect(kinds(after({ state: "merged" }))).toEqual(["merged"]);
    expect(kinds(after({ state: "closed" }))).toEqual(["closed"]);
    expect(kinds(after({ state: "open" }), { ...before, state: "closed" })).toEqual(["reopened"]);
    expect(kinds(after({ headSha: "c".repeat(40), checks: "passing", state: "merged" }))).toEqual(["new_commit", "checks", "merged"]);
  });

  it("ID 는 변화의 내용에서 만든다 — 같은 변화는 같은 ID, 다른 변화(다른 갱신 시각 · 다른 업무)는 다른 ID", () => {
    const one = prChangeEvents(before, after({ state: "closed" }), "w1", at);
    const again = prChangeEvents(before, after({ state: "closed" }), "w1", "2026-09-28T09:00:00.000Z");
    expect(again.map((e) => e.id)).toEqual(one.map((e) => e.id)); // 읽은 시각이 달라도 같은 변화다
    expect(prChangeEvents(before, after({ state: "closed", updatedAt: "2026-09-29T00:00:00.000Z" }), "w1", at)[0]?.id).not.toBe(one[0]?.id);
    expect(prChangeEvents(before, after({ state: "closed" }), "w2", at)[0]?.id).not.toBe(one[0]?.id);
  });

  it("주인: 연결 · 연결 해제는 Studio, 나머지는 GitHub (계약 §5)", () => {
    expect(eventOwner("linked")).toBe("studio");
    expect(eventOwner("unlinked")).toBe("studio");
    for (const k of ["new_commit", "checks", "merged", "closed", "reopened"] as const) expect(eventOwner(k)).toBe("github");
  });

  it("연결됨 · 연결 해제 이벤트는 그 순간의 커밋과 누가 연결했는지를 갖고, ID 가 연결 · 해제 한 번마다 정해진다", () => {
    const link = { repoId: 1, number: 7, workId: "w1", origin: "user" as const, linkedAt: at };
    expect(linkedEvent(link, "a".repeat(40)).id).toBe(linkedEvent(link, "b".repeat(40)).id); // 연결 한 번에 ID 하나
    expect(linkedEvent({ ...link, linkedAt: "2026-09-29T00:00:00.000Z" }, "a".repeat(40)).id).not.toBe(linkedEvent(link, "a".repeat(40)).id);
    expect(linkedEvent(link, "a".repeat(40))).toMatchObject({ kind: "linked", origin: "user", commitSha: "a".repeat(40), at });
    expect(unlinkedEvent({ repoId: 1, number: 7, workId: "w1" }, "a".repeat(40), at)).toMatchObject({ kind: "unlinked", workId: "w1", at });
  });
});

describe("Sync 가 이벤트를 남긴다 — 연결된 PR 만, 같은 변화는 한 번만", () => {
  const payments12 = { repoId: DEMO_REPO.payments, number: 12 };
  /** 결제 서비스 업무(a1b2c3)에는 #12 와 #15(병합됨)가 붙는다. 여기서는 #12 의 이벤트만 본다 */
  const eventsOf12 = async (deps: ReturnType<typeof setup>["deps"]) =>
    (await deps.store.listPrEvents("a1b2c3")).filter((e) => e.number === 12);

  it("첫 Sync 는 변화를 남기지 않고, 표식으로 새로 연결된 PR 에만 '연결됨' 을 그 순간의 커밋으로 남긴다", async () => {
    const { deps } = setup();
    const result = await syncAll(deps);
    const events = await eventsOf12(deps);
    expect(events).toEqual([
      expect.objectContaining({ kind: "linked", origin: "marker", repoId: DEMO_REPO.payments, number: 12, commitSha: DEMO_SHA.payments12Head }),
    ]);
    const all = (await deps.store.listWorks()).map((w) => w.id);
    const linkedCount = (await Promise.all(all.map((id) => deps.store.listPrEvents(id)))).flat().filter((e) => e.kind === "linked").length;
    expect(linkedCount).toBe(result.autoLinked);
  });

  it("같은 데이터로 다시 Sync 하면 아무것도 더 남지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const first = await deps.store.listPrEvents("a1b2c3");
    await syncAll(deps);
    await syncAll(deps);
    expect(await deps.store.listPrEvents("a1b2c3")).toEqual(first);
  });

  it("연결된 PR 에 새 커밋이 오면 새 커밋 · 검사 이벤트가 한 번 남고, 다시 Sync 해도 늘지 않는다", async () => {
    const { deps, data } = setup();
    await syncAll(deps);
    const pr = data.pullRequests.find((p) => p.repoId === payments12.repoId && p.number === payments12.number)!;
    Object.assign(pr, { headSha: "e".repeat(40), checks: "passing", updatedAt: "2026-09-26T00:00:00.000Z" });
    await syncAll(deps);
    await syncAll(deps);
    const events = await eventsOf12(deps);
    expect(events.map((e) => e.kind)).toEqual(["linked", "new_commit", "checks"]);
    expect(events[1]).toMatchObject({ commitSha: "e".repeat(40), previousSha: DEMO_SHA.payments12Head });
  });

  it("두 Sync 가 겹쳐 같은 변화를 읽어도 한 번만 남는다", async () => {
    const { deps, data } = setup();
    await syncAll(deps);
    const pr = data.pullRequests.find((p) => p.repoId === payments12.repoId && p.number === payments12.number)!;
    Object.assign(pr, { state: "merged", updatedAt: "2026-09-26T00:00:00.000Z" });
    await Promise.all([syncAll(deps), syncAll(deps), syncAll(deps)]);
    expect((await eventsOf12(deps)).map((e) => e.kind)).toEqual(["linked", "merged"]);
  });

  it("연결되지 않은 PR 의 변화는 남기지 않는다 (어느 업무의 이야기도 아니다)", async () => {
    const { deps, data } = setup();
    await syncAll(deps);
    const inboxPr = data.pullRequests.find((p) => p.repoId === DEMO_REPO.coachWeb && p.number === 12)!;
    Object.assign(inboxPr, { headSha: "f".repeat(40), updatedAt: "2026-09-26T00:00:00.000Z" });
    await syncAll(deps);
    const works = (await deps.store.listWorks()).map((w) => w.id);
    const events = (await Promise.all(works.map((id) => deps.store.listPrEvents(id)))).flat();
    expect(events.filter((e) => e.repoId === DEMO_REPO.coachWeb && e.number === 12)).toEqual([]);
  });

  it("Unlink 하면 그 업무에 '연결을 풀었다' 가 남고, 그 뒤의 변화는 그 업무에 남지 않는다", async () => {
    const { deps, data } = setup();
    await syncAll(deps);
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });
    const pr = data.pullRequests.find((p) => p.repoId === payments12.repoId && p.number === payments12.number)!;
    Object.assign(pr, { headSha: "e".repeat(40), updatedAt: "2026-09-26T00:00:00.000Z" });
    await syncAll(deps);
    expect((await eventsOf12(deps)).map((e) => e.kind)).toEqual(["linked", "unlinked"]);
    expect((await eventsOf12(deps))[1]).toMatchObject({ commitSha: DEMO_SHA.payments12Head });
  });

  it("사람의 연결(Link to Work · PR 로 New Work)은 '연결됨 · Linked manually' 로 남는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await linkPrToWork(deps, { repoId: DEMO_REPO.coachWeb, number: 12, workId: "b4c5d6" });
    await linkPrToWork(deps, { repoId: DEMO_REPO.coachWeb, number: 12, workId: "b4c5d6" }); // 두 번 눌러도 한 번
    expect(await deps.store.listPrEvents("b4c5d6")).toMatchObject([{ kind: "linked", origin: "user", repoId: DEMO_REPO.coachWeb, number: 12 }]);

    const work = await createWorkFromPr(deps, { repoId: DEMO_REPO.docsSite, number: 12 });
    expect(await deps.store.listPrEvents(work.id)).toMatchObject([{ kind: "linked", origin: "user", repoId: DEMO_REPO.docsSite, at: work.createdAt }]);
  });
});

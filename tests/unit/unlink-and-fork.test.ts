/**
 * 두 번째 단위의 새 규칙 — Unlink(결정 9)와 복제본 PR(결정 10). docs/plan/02-persistence-and-unlink.md §3 의 4 · 5.
 */
import { describe, expect, it } from "vitest";
import { DEMO_FORK_REPO, DEMO_REPO } from "../../src/adapters/github/fixture/demo-scenario";
import { linkPrToWork, unlinkPr } from "../../src/application/inbox-actions";
import { getInbox, getWorkDetail } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import { prKey } from "../../src/domain/model";
import { setup } from "./helpers";

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };

async function inboxItem(deps: Parameters<typeof getInbox>[0], ref: { repoId: number; number: number }) {
  return (await getInbox(deps)).groups.flatMap((g) => g.items).find((i) => i.pr.key === prKey(ref));
}

describe("Unlink — 사람이 연결을 풀면 표식으로 다시 붙지 않는다 (결정 9)", () => {
  it("Unlink 하면 PR 이 업무에서 사라지고, Inbox 에 '사람이 연결을 풀었다' 이유와 원래 업무 이름과 함께 나타난다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    expect((await getWorkDetail(deps, "a1b2c3"))?.prs.map((p) => p.key)).toContain(prKey(payments12));

    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });

    expect((await getWorkDetail(deps, "a1b2c3"))?.prs.map((p) => p.key)).not.toContain(prKey(payments12));
    expect(await inboxItem(deps, payments12)).toMatchObject({
      reason: "unlinked_by_user",
      unlinkedFromWorkTitle: "로그인 화면 만들기",
      markedWorkIds: ["a1b2c3"],
    });
  });

  it("표식이 그대로 있어도 다음 Sync 에서 자동으로 다시 붙지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });

    const result = await syncAll(deps);
    await syncAll(deps);

    expect(result.autoLinked).toBe(0);
    expect(await deps.store.getLink(payments12)).toBeUndefined();
    expect((await inboxItem(deps, payments12))?.reason).toBe("unlinked_by_user");
  });

  it("Inbox 에서 사람이 다시 연결하면 정상으로 연결되고, 해제 기록이 사라져 동기화를 거쳐도 유지된다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });

    await linkPrToWork(deps, { ...payments12, workId: "a1b2c3" });
    await syncAll(deps);

    expect(await deps.store.getLink(payments12)).toMatchObject({ workId: "a1b2c3", origin: "user" });
    expect(await deps.store.listUnlinks()).toEqual([]);
    expect(await inboxItem(deps, payments12)).toBeUndefined();
  });

  it("이미 풀린 연결을 다시 풀거나, 다른 업무 이름으로 풀려 하면 not_linked 로 거절한다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await expect(unlinkPr(deps, { ...payments12, workId: "d0e1f2" })).rejects.toMatchObject({ code: "not_linked" });
    await unlinkPr(deps, { ...payments12, workId: "a1b2c3" });
    await expect(unlinkPr(deps, { ...payments12, workId: "a1b2c3" })).rejects.toMatchObject({ code: "not_linked" });
  });
});

describe("복제본에서 온 PR — 표식이 있어도 Inbox (결정 10)", () => {
  it("시연 데이터의 복제본 PR(payments#18)은 같은 프로젝트 업무의 표식이 있어도 Inbox 에 이유와 함께 있다", async () => {
    const { data, deps } = setup();
    const fork = data.pullRequests.find((p) => p.repoId === DEMO_REPO.payments && p.number === 18);
    expect(fork?.headRepoId).toBe(DEMO_FORK_REPO);
    expect(fork?.body).toContain("studio-work-a1b2c3");

    await syncAll(deps);

    expect(await deps.store.getLink({ repoId: DEMO_REPO.payments, number: 18 })).toBeUndefined();
    expect(await inboxItem(deps, { repoId: DEMO_REPO.payments, number: 18 })).toMatchObject({
      reason: "fork_head",
      markedWorkIds: ["a1b2c3"],
    });
  });

  it("브랜치가 어느 저장소에 있는지 모르는 PR(삭제된 복제본)도 표식이 있어도 Inbox 로 간다", async () => {
    const { data, deps } = setup();
    data.pullRequests = data.pullRequests.map((p) =>
      p.repoId === DEMO_REPO.adminConsole && p.number === 12 ? { ...p, headRepoId: null } : p,
    );
    await syncAll(deps);

    expect(await deps.store.getLink({ repoId: DEMO_REPO.adminConsole, number: 12 })).toBeUndefined();
    expect((await inboxItem(deps, { repoId: DEMO_REPO.adminConsole, number: 12 }))?.reason).toBe("unknown_head");
  });

  it("복제본 PR 도 사람이 Inbox 에서 확인해 연결하면 연결된다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await linkPrToWork(deps, { repoId: DEMO_REPO.payments, number: 18, workId: "a1b2c3" });
    expect(await deps.store.getLink({ repoId: DEMO_REPO.payments, number: 18 })).toMatchObject({ origin: "user" });
  });
});

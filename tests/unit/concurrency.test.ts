/** 동시에 들어오는 요청 — 동기화 두 번, 같은 PR 로 New Work 두 번. */
import { describe, expect, it } from "vitest";
import { DEMO_REPO } from "../../src/adapters/github/fixture/demo-scenario";
import { createWorkFromPr } from "../../src/application/inbox-actions";
import { syncAll } from "../../src/application/sync";
import { setup } from "./helpers";

describe("동시 요청", () => {
  it("동기화가 동시에 두 번 돌아도 중간에 멈추지 않고, 연결은 PR 마다 하나씩만 생긴다", async () => {
    const { deps } = setup();

    const results = await Promise.all([syncAll(deps), syncAll(deps)]); // 어느 쪽도 던지지 않아야 한다

    expect(results.reduce((n, r) => n + r.autoLinked, 0)).toBe(3);
    expect(await deps.store.listLinks()).toHaveLength(3);
    expect(await deps.store.listSnapshots()).toHaveLength(9); // 두 동기화 모두 끝까지 받아 적었다 (fixture PR 9건)
  });

  it("같은 PR 로 New Work 를 동시에 두 번 눌러도 업무는 하나만 생기고, 연결 없는 빈 업무가 남지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const target = { repoId: DEMO_REPO.docsSite, number: 12 };
    const before = await deps.store.listWorks();

    const results = await Promise.allSettled([createWorkFromPr(deps, target), createWorkFromPr(deps, target)]);

    expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
    const rejected = results.find((r) => r.status === "rejected");
    expect(rejected?.status === "rejected" && rejected.reason).toMatchObject({ code: "already_linked" });
    const works = await deps.store.listWorks();
    expect(works).toHaveLength(before.length + 1);
    const links = await deps.store.listLinks();
    for (const work of works.filter((w) => w.projectId === "docs")) {
      expect(links.some((l) => l.workId === work.id), `${work.id} 에 연결된 PR 이 있어야 한다`).toBe(true);
    }
  });
});

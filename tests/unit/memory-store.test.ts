/** 메모리 저장소 — 복사본만 주고받는지, 업무 만들기와 연결이 한 번에 되는지. */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { createMemoryStore } from "../../src/adapters/store/memory/memory-store";
import { getWorkspace } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import type { PrLink, PrSnapshot, Work } from "../../src/domain/model";
import { setup } from "./helpers";

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };

describe("메모리 저장소는 복사본만 주고받는다", () => {
  it("돌려받은 스냅샷을 밖에서 고쳐도 저장된 GitHub 상태와 Workspace 카드는 그대로다", async () => {
    const { deps } = setup();
    await syncAll(deps);

    const got = (await deps.store.getSnapshot(payments12)) as { state: string } | undefined;
    if (got === undefined) throw new Error("스냅샷이 없다");
    got.state = "merged"; // 바깥에서 고친다
    const listed = (await deps.store.listSnapshots()) as { state: string }[];
    for (const s of listed) s.state = "closed";

    expect((await deps.store.getSnapshot(payments12))?.state).toBe("open");
    const card = (await getWorkspace(deps)).projects
      .flatMap((p) => p.works.flatMap((w) => w.prs))
      .find((c) => c.repoId === DEMO_REPO.payments && c.number === 12);
    expect(card?.github.state).toBe("open");
  });

  it("업무 · 연결 · 프로젝트 · 저장소 · 검토 결정 · 미리보기도 돌려받은 값을 고쳐 저장된 값이 바뀌지 않는다", async () => {
    const { deps } = setup({
      seed: {
        ...demoStudioSeed(),
        previews: [{ id: "pv", repoId: DEMO_REPO.adminConsole, number: 12, commitSha: "a".repeat(40), startedAt: "2026-09-24T00:00:00.000Z" }],
      },
    });
    await syncAll(deps);
    const store = deps.store;
    const snapshotOf = async () =>
      structuredClone({
        works: await store.listWorks(),
        work: await store.getWork("a1b2c3"),
        links: await store.listLinks(),
        link: await store.getLink(payments12),
        projects: await store.listProjects(),
        repositories: await store.listRepositories(),
        reviews: await store.listReviewDecisions(),
        previews: await store.listPreviewRecords(),
      });
    const before = await snapshotOf();

    const mutate = (values: unknown[]) => {
      for (const v of values) (v as Record<string, unknown>)["id"] = "고침";
    };
    mutate(await store.listWorks());
    mutate([await store.getWork("a1b2c3")]);
    mutate(await store.listLinks());
    mutate([await store.getLink(payments12)]);
    mutate(await store.listProjects());
    mutate(await store.listRepositories());
    mutate(await store.listReviewDecisions());
    mutate(await store.listPreviewRecords());

    expect(await snapshotOf()).toEqual(before);
  });

  it("저장한 뒤 원래 객체를 고쳐도 저장된 값은 바뀌지 않는다", async () => {
    const store = createMemoryStore();
    const snapshot = {
      repoId: 1,
      number: 1,
      title: "t",
      body: "",
      branch: "b",
      headSha: "c".repeat(40),
      url: "u",
      author: "a",
      state: "open",
      checks: "none",
      review: "none",
      updatedAt: "2026-09-24T00:00:00.000Z",
    } satisfies PrSnapshot;
    const mutable = { ...snapshot } as { state: string };
    await store.saveSnapshot(mutable as PrSnapshot);
    mutable.state = "merged";
    expect((await store.getSnapshot({ repoId: 1, number: 1 }))?.state).toBe("open");
  });
});

describe("업무 만들기와 연결은 하나의 연산이다", () => {
  const work: Work = { id: "w1", projectId: "p", title: "업무", status: "draft", createdAt: "2026-09-25T00:00:00.000Z" };
  const link: PrLink = { repoId: 1, number: 1, workId: "w1", origin: "user", linkedAt: "2026-09-25T00:00:00.000Z" };

  it("PR 이 이미 연결돼 있으면 업무도 만들지 않는다", async () => {
    const store = createMemoryStore({ links: [{ ...link, workId: "other" }] });
    await expect(store.createWorkWithLink(work, link)).rejects.toMatchObject({ code: "already_linked" });
    expect(await store.listWorks()).toEqual([]);
    expect((await store.getLink(link))?.workId).toBe("other");
  });

  it("같은 ID 의 업무가 있으면 연결도 만들지 않는다", async () => {
    const store = createMemoryStore({ works: [work] });
    await expect(store.createWorkWithLink(work, link)).rejects.toMatchObject({ code: "invalid_input" });
    expect(await store.listLinks()).toEqual([]);
  });

  it("성공하면 업무와 연결이 함께 생긴다", async () => {
    const store = createMemoryStore();
    await store.createWorkWithLink(work, link);
    expect(await store.getWork("w1")).toEqual(work);
    expect(await store.getLink(link)).toEqual(link);
  });
});

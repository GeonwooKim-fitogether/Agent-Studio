/**
 * 저장 계약 시험 묶음 — 저장소 종류와 무관하게 StudioStore 가 지켜야 할 약속.
 * 메모리(store-contract.memory.test.ts)와 PostgreSQL(store-contract.postgres.test.ts)이 같은 묶음을 돈다.
 *
 * 복사본 규칙, 한 PR 에 연결 하나, 업무 생성과 연결의 원자성, 연결 해제(Unlink)와 그 기록이 여기 있다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { createWorkFromPr, linkPrToWork, unlinkPr } from "../../src/application/inbox-actions";
import { getPrNotice, getWorkspace } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import type { PrLink, PrSnapshot, Work } from "../../src/domain/model";
import type { Memo } from "../../src/domain/memo";
import type { PrEvent } from "../../src/domain/pr-event";
import type { StatusChange } from "../../src/domain/work-status";
import type { StudioSeed, StudioStore } from "../../src/ports/studio-store";
import { setup } from "./helpers";

/** 처음 상태를 심은 빈 저장소를 새로 만든다. */
export type StoreFactory = (seed: StudioSeed) => Promise<StudioStore>;

const payments12 = { repoId: DEMO_REPO.payments, number: 12 };
const project = { id: "p", name: "시험 프로젝트", repoIds: [1] };
const work: Work = { id: "w1", projectId: "p", title: "업무", status: "draft", createdAt: "2026-09-25T00:00:00.000Z" };
const other: Work = { id: "w2", projectId: "p", title: "다른 업무", status: "draft", createdAt: "2026-09-25T00:00:01.000Z" };
const userLink = (workId: string): PrLink => ({ repoId: 1, number: 1, workId, origin: "user", linkedAt: "2026-09-25T00:00:00.000Z" });
const markerLink = (workId: string): PrLink => ({
  repoId: 1,
  number: 1,
  workId,
  origin: "marker",
  markerFoundIn: ["body"],
  linkedAt: "2026-09-25T00:00:00.000Z",
});
const snapshot: PrSnapshot = {
  repoId: 1,
  number: 1,
  title: "t",
  body: "",
  branch: "b",
  headRepoId: null,
  headSha: "c".repeat(40),
  url: "u",
  author: "a",
  state: "open",
  checks: "none",
  review: "none",
  updatedAt: "2026-09-24T00:00:00.000Z",
};

export function describeStoreContract(kind: string, make: StoreFactory): void {
  describe(`저장 계약 (${kind})`, () => {
    describe("복사본만 주고받는다", () => {
      it("돌려받은 스냅샷을 밖에서 고쳐도 저장된 GitHub 상태와 Workspace 카드는 그대로다", async () => {
        const { deps } = setup({ store: await make(demoStudioSeed()) });
        await syncAll(deps);

        const got = (await deps.store.getSnapshot(payments12)) as { state: string } | undefined;
        if (got === undefined) throw new Error("스냅샷이 없다");
        got.state = "merged";
        for (const s of (await deps.store.listSnapshots()) as { state: string }[]) s.state = "closed";

        expect((await deps.store.getSnapshot(payments12))?.state).toBe("open");
        const card = (await getWorkspace(deps)).projects
          .flatMap((p) => p.works.flatMap((w) => w.prs))
          .find((c) => c.repoId === DEMO_REPO.payments && c.number === 12);
        expect(card?.github.state).toBe("open");
      });

      it("업무 · 연결 · 프로젝트 · 저장소 · 검토 결정 · 미리보기 · 해제 기록도 돌려받은 값을 고쳐 저장된 값이 바뀌지 않는다", async () => {
        const store = await make({
          ...demoStudioSeed(),
          previews: [{ id: "pv", repoId: DEMO_REPO.adminConsole, number: 12, commitSha: "a".repeat(40), startedAt: "2026-09-24T00:00:00.000Z" }],
        });
        const { deps } = setup({ store });
        await syncAll(deps);
        await store.unlink({ repoId: DEMO_REPO.payments, number: 15, workId: "a1b2c3" }, "2026-09-25T00:00:00.000Z");
        const everything = async () =>
          structuredClone({
            works: await store.listWorks(),
            work: await store.getWork("a1b2c3"),
            links: await store.listLinks(),
            link: await store.getLink(payments12),
            projects: await store.listProjects(),
            repositories: await store.listRepositories(),
            reviews: await store.listReviewDecisions(),
            previews: await store.listPreviewRecords(),
            unlinks: await store.listUnlinks(),
          });
        const before = await everything();

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
        mutate(await store.listUnlinks());

        expect(await everything()).toEqual(before);
      });

      it("저장한 뒤 원래 객체를 고쳐도 저장된 값은 바뀌지 않고, 저장한 그대로 돌아온다 (브랜치 저장소를 모르는 null 포함)", async () => {
        const store = await make({ projects: [project] });
        const mutable = { ...snapshot } as { state: string };
        await store.saveSnapshot(mutable as PrSnapshot);
        mutable.state = "merged";
        expect(await store.getSnapshot({ repoId: 1, number: 1 })).toEqual(snapshot);
        await store.saveSnapshot({ ...snapshot, headRepoId: 1, title: "바뀐 제목" }); // 같은 PR 을 다시 받아 적으면 덮어쓴다
        expect(await store.listSnapshots()).toEqual([{ ...snapshot, headRepoId: 1, title: "바뀐 제목" }]);
      });
    });

    describe("한 PR 에 연결은 하나", () => {
      it("이미 연결된 PR 에 다시 연결하면 거절하고 처음 연결이 남는다", async () => {
        const store = await make({ projects: [project], works: [work, other] });
        await store.addLink(userLink("w1"));
        await expect(store.addLink(userLink("w2"))).rejects.toMatchObject({ code: "already_linked" });
        expect(await store.listLinks()).toEqual([userLink("w1")]);
      });

      it("같은 PR 에 동시에 두 연결이 들어오면 하나만 남는다", async () => {
        const store = await make({ projects: [project], works: [work, other] });
        const results = await Promise.allSettled([store.addLink(userLink("w1")), store.addLink(userLink("w2"))]);
        expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
        expect(await store.listLinks()).toHaveLength(1);
      });

      it("표식으로 연결하면 표식을 찾은 자리까지 저장된다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await store.addLink(markerLink("w1"));
        expect(await store.getLink({ repoId: 1, number: 1 })).toEqual(markerLink("w1"));
      });
    });

    describe("업무 만들기와 연결은 하나의 연산이다", () => {
      it("PR 이 이미 연결돼 있으면 업무도 만들지 않는다", async () => {
        const store = await make({ projects: [project], works: [other], links: [userLink("w2")] });
        await expect(store.createWorkWithLink(work, userLink("w1"))).rejects.toMatchObject({ code: "already_linked" });
        expect((await store.listWorks()).map((w) => w.id)).toEqual(["w2"]);
        expect((await store.getLink(userLink("w1")))?.workId).toBe("w2");
      });

      it("같은 ID 의 업무가 있으면 연결도 만들지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await expect(store.createWorkWithLink(work, userLink("w1"))).rejects.toMatchObject({ code: "invalid_input" });
        expect(await store.listLinks()).toEqual([]);
      });

      it("같은 PR 로 동시에 두 업무를 만들면 하나만 생기고 빈 업무가 남지 않는다", async () => {
        const store = await make({ projects: [project] });
        const results = await Promise.allSettled([
          store.createWorkWithLink(work, userLink("w1")),
          store.createWorkWithLink(other, userLink("w2")),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
        const works = await store.listWorks();
        expect(works).toHaveLength(1);
        expect((await store.getLink(userLink("w1")))?.workId).toBe(works[0]?.id);
      });

      it("성공하면 업무와 연결이 함께 생긴다", async () => {
        const store = await make({ projects: [project] });
        await store.createWorkWithLink(work, userLink("w1"));
        expect(await store.getWork("w1")).toEqual(work);
        expect(await store.getLink(userLink("w1"))).toEqual(userLink("w1"));
      });
    });

    describe("빈 업무 만들기 (New Work, feature-plan F5)", () => {
      it("PR 없이 업무 하나가 생기고, 저장한 그대로 돌아온다. 연결은 생기지 않는다", async () => {
        const store = await make({ projects: [project] });
        await store.createWork(work);
        expect(await store.getWork("w1")).toEqual(work);
        expect(await store.listLinks()).toEqual([]);
      });

      it("업무 ID 형식 → invalid_input, 없는 프로젝트 → not_found, 같은 ID → invalid_input 이고 아무것도 쓰지 않는다", async () => {
        const store = await make({ projects: [project], works: [other] });
        await expect(store.createWork({ ...work, id: "W-1" })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(store.createWork({ ...work, id: "W-1", projectId: "noproject" })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(store.createWork({ ...work, projectId: "noproject" })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.createWork({ ...work, id: "w2", title: "덮어쓰기" })).rejects.toMatchObject({ code: "invalid_input" });
        expect(await store.listWorks()).toEqual([other]);
      });

      it("같은 ID 로 동시에 두 번 만들면 하나만 생긴다", async () => {
        const store = await make({ projects: [project] });
        const results = await Promise.allSettled([store.createWork(work), store.createWork({ ...work, title: "둘째" })]);
        expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
        expect(await store.listWorks()).toHaveLength(1);
      });
    });

    describe("오류 코드는 저장소 종류와 무관하게 같다", () => {
      it("같은 ID 의 업무가 있고 PR 도 이미 연결돼 있으면 already_linked (이미 연결됨을 먼저 본다)", async () => {
        const store = await make({ projects: [project], works: [work], links: [userLink("w1")] });
        await expect(store.createWorkWithLink(work, userLink("w1"))).rejects.toMatchObject({ code: "already_linked" });
      });

      it("없는 업무로 연결하면 not_found 이고 아무것도 쓰지 않는다", async () => {
        const store = await make({ projects: [project] });
        await expect(store.addLink(userLink("nowork"))).rejects.toMatchObject({ code: "not_found" });
        await expect(store.addLink(markerLink("nowork"))).rejects.toMatchObject({ code: "not_found" });
        expect(await store.listLinks()).toEqual([]);
      });

      it("업무 ID 형식이 틀리면 invalid_input, 없는 프로젝트면 not_found 이고 아무것도 쓰지 않는다", async () => {
        const store = await make({ projects: [project] });
        const bad = { ...work, id: "W-1" };
        await expect(store.createWorkWithLink(bad, userLink("W-1"))).rejects.toMatchObject({ code: "invalid_input" });
        const orphan = { ...work, projectId: "noproject" };
        await expect(store.createWorkWithLink(orphan, userLink("w1"))).rejects.toMatchObject({ code: "not_found" });
        expect(await store.listWorks()).toEqual([]);
        expect(await store.listLinks()).toEqual([]);
      });

      it("없는 업무에 내부 검토 결정을 남기면 not_found", async () => {
        const store = await make({ projects: [project] });
        await expect(
          store.addReviewDecision({ id: "r", workId: "nowork", repoId: 1, number: 1, commitSha: "c".repeat(40), verdict: "internal_review_done", decidedAt: "2026-09-25T00:00:00.000Z" }),
        ).rejects.toMatchObject({ code: "not_found" });
      });

      it("PR 번호가 32비트 범위를 넘거나 0 이하면 쓰기는 invalid_input, 읽기는 없음(undefined)", async () => {
        const store = await make({ projects: [project], works: [work] });
        const huge = { repoId: 1, number: 3_000_000_000 };
        await expect(store.saveSnapshot({ ...snapshot, ...huge })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(store.addLink({ ...userLink("w1"), ...huge })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(store.unlink({ ...huge, workId: "w1" }, "2026-09-25T00:00:00.000Z")).rejects.toMatchObject({ code: "invalid_input" });
        await expect(store.saveSnapshot({ ...snapshot, number: 0 })).rejects.toMatchObject({ code: "invalid_input" });
        expect(await store.getSnapshot(huge)).toBeUndefined();
        expect(await store.getLink(huge)).toBeUndefined();
        // 경계 바로 안쪽은 받아들인다
        await store.saveSnapshot({ ...snapshot, number: 2_147_483_647 });
        expect((await store.getSnapshot({ repoId: 1, number: 2_147_483_647 }))?.number).toBe(2_147_483_647);
      });

      it("유스케이스도 범위 밖의 PR 번호를 저장소에 닿기 전에 invalid_input 으로 거절한다", async () => {
        const { deps } = setup({ store: await make(demoStudioSeed()) });
        await syncAll(deps);
        const huge = { repoId: DEMO_REPO.coachWeb, number: 3_000_000_000 };
        await expect(linkPrToWork(deps, { ...huge, workId: "b4c5d6" })).rejects.toMatchObject({ code: "invalid_input" });
        await expect(createWorkFromPr(deps, huge)).rejects.toMatchObject({ code: "invalid_input" });
        await expect(unlinkPr(deps, { ...huge, workId: "b4c5d6" })).rejects.toMatchObject({ code: "invalid_input" });
        expect(await getPrNotice(deps, huge)).toBeUndefined();
      });

      it("글 속의 NUL 문자는 대체 문자로 바뀌어 받아 적힌다", async () => {
        const store = await make({ projects: [project] });
        await store.saveSnapshot({ ...snapshot, title: "a\u0000b", body: "본문\u0000", branch: "b\u0000", author: "x\u0000" });
        expect(await store.getSnapshot({ repoId: 1, number: 1 })).toMatchObject({
          title: "a\uFFFDb",
          body: "본문\uFFFD",
          branch: "b\uFFFD",
          author: "x\uFFFD",
        });
      });
    });

    describe("업무 상태와 상태 이력 (feature-plan F3)", () => {
      const ruleChange = (id: string, from: Work["status"], to: Work["status"], at = "2026-09-28T00:00:00.000Z"): StatusChange => ({
        id,
        workId: "w1",
        from,
        to,
        cause: { kind: "rule", rule: "R1", evidence: [{ repoId: 1, number: 1, commitSha: "c".repeat(40) }] },
        changedAt: at,
      });
      const personChange: StatusChange = {
        id: "sc-p",
        workId: "w1",
        from: "done_candidate",
        to: "done",
        cause: { kind: "person", action: "mark_done" },
        changedAt: "2026-09-28T00:00:02.000Z",
      };

      it("상태 · 기준점 · 이력이 함께 쓰이고, 이력은 쌓인 순서대로 그대로 돌아온다 (같은 시각이어도)", async () => {
        const store = await make({ projects: [project], works: [work] });
        const pin = { "1#1": "open:" + "c".repeat(40) };
        const ok = await store.updateWorkStatus({
          workId: "w1",
          expected: "draft",
          status: "done_candidate",
          pin: null,
          changes: [ruleChange("sc-1", "draft", "in_progress"), { ...ruleChange("sc-2", "in_progress", "done_candidate"), cause: { kind: "rule", rule: "R4", evidence: [] } }],
        });
        expect(ok).toBe(true);
        expect(await store.updateWorkStatus({ workId: "w1", expected: "done_candidate", status: "done", pin, changes: [personChange] })).toBe(true);
        expect((await store.getWork("w1"))?.status).toBe("done");
        expect(await store.listStatusPins()).toEqual({ w1: pin });
        expect((await store.listStatusChanges()).map((c) => c.id)).toEqual(["sc-1", "sc-2", "sc-p"]);
        expect((await store.listStatusChanges())[2]).toEqual(personChange);
        expect((await store.listStatusChanges())[0]).toEqual(ruleChange("sc-1", "draft", "in_progress"));

        // 기준점을 놓으면(null) 목록에서 빠진다
        await store.updateWorkStatus({ workId: "w1", expected: "done", status: "done", pin: null, changes: [] });
        expect(await store.listStatusPins()).toEqual({});
      });

      it("지금 상태가 expected 와 다르면 false 이고 아무것도 쓰지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        const stale = await store.updateWorkStatus({
          workId: "w1",
          expected: "needs_review",
          status: "in_progress",
          pin: { x: "y" },
          changes: [ruleChange("sc-1", "needs_review", "in_progress")],
        });
        expect(stale).toBe(false);
        expect((await store.getWork("w1"))?.status).toBe("draft");
        expect(await store.listStatusChanges()).toEqual([]);
        expect(await store.listStatusPins()).toEqual({});
      });

      it("같은 판정이 동시에 두 번 들어와도 한 번만 쓰이고 이력이 한 줄이다", async () => {
        const store = await make({ projects: [project], works: [work] });
        const update = (id: string) =>
          store.updateWorkStatus({ workId: "w1", expected: "draft", status: "in_progress", pin: null, changes: [ruleChange(id, "draft", "in_progress")] });
        const results = await Promise.all([update("sc-a"), update("sc-b")]);
        expect(results.sort()).toEqual([false, true]);
        expect(await store.listStatusChanges()).toHaveLength(1);
      });

      it("없는 업무면 not_found, 목록 밖의 상태 값이면 invalid_input 이고 아무것도 쓰지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await expect(store.updateWorkStatus({ workId: "nowork", expected: "draft", status: "done", pin: null, changes: [] })).rejects.toMatchObject({
          code: "not_found",
        });
        await expect(
          store.updateWorkStatus({ workId: "w1", expected: "draft", status: "finished" as Work["status"], pin: null, changes: [] }),
        ).rejects.toMatchObject({ code: "invalid_input" });
        expect((await store.getWork("w1"))?.status).toBe("draft");
        expect(await store.listStatusChanges()).toEqual([]);
      });

      it("완료 후보(done_candidate)로 처음 심은 업무도 그대로 돌아온다", async () => {
        const store = await make({ projects: [project], works: [{ ...work, status: "done_candidate" }] });
        expect((await store.getWork("w1"))?.status).toBe("done_candidate");
        expect(await store.getWork("w1")).toEqual({ ...work, status: "done_candidate" }); // 기준점은 업무 값에 섞이지 않는다
      });

      it("돌려받은 이력과 기준점을 고쳐도 저장된 값은 바뀌지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await store.updateWorkStatus({ workId: "w1", expected: "draft", status: "draft", pin: { a: "b" }, changes: [ruleChange("sc-1", "draft", "draft")] });
        const pins = await store.listStatusPins();
        (pins as Record<string, Record<string, string>>)["w1"]!["a"] = "고침";
        const changes = await store.listStatusChanges();
        (changes[0] as { id: string }).id = "고침";
        expect(await store.listStatusPins()).toEqual({ w1: { a: "b" } });
        expect((await store.listStatusChanges())[0]?.id).toBe("sc-1");
      });
    });

    describe("연결 해제 (Unlink)", () => {
      it("연결을 풀면 연결이 사라지고, 누가 어느 업무에서 풀었는지 기록이 남는다", async () => {
        const store = await make({ projects: [project], works: [work], links: [markerLink("w1")] });
        await store.unlink({ repoId: 1, number: 1, workId: "w1" }, "2026-09-25T01:00:00.000Z");
        expect(await store.getLink({ repoId: 1, number: 1 })).toBeUndefined();
        expect(await store.listUnlinks()).toEqual([{ repoId: 1, number: 1, workId: "w1", unlinkedAt: "2026-09-25T01:00:00.000Z" }]);
      });

      it("이미 풀린 연결을 다시 풀거나, 다른 업무 이름으로 풀려 하면 거절하고 아무것도 바꾸지 않는다", async () => {
        const store = await make({ projects: [project], works: [work, other], links: [userLink("w1")] });
        await expect(store.unlink({ repoId: 1, number: 1, workId: "w2" }, "2026-09-25T01:00:00.000Z")).rejects.toMatchObject({
          code: "not_linked",
        });
        expect(await store.getLink({ repoId: 1, number: 1 })).toEqual(userLink("w1"));
        expect(await store.listUnlinks()).toEqual([]);

        await store.unlink({ repoId: 1, number: 1, workId: "w1" }, "2026-09-25T01:00:00.000Z");
        await expect(store.unlink({ repoId: 1, number: 1, workId: "w1" }, "2026-09-25T02:00:00.000Z")).rejects.toMatchObject({
          code: "not_linked",
        });
        expect((await store.listUnlinks())[0]?.unlinkedAt).toBe("2026-09-25T01:00:00.000Z");
      });

      it("동시에 두 번 풀면 한 번만 풀린다", async () => {
        const store = await make({ projects: [project], works: [work], links: [userLink("w1")] });
        const ref = { repoId: 1, number: 1, workId: "w1" };
        const results = await Promise.allSettled([
          store.unlink(ref, "2026-09-25T01:00:00.000Z"),
          store.unlink(ref, "2026-09-25T01:00:00.000Z"),
        ]);
        expect(results.map((r) => r.status).sort()).toEqual(["fulfilled", "rejected"]);
        expect(await store.listUnlinks()).toHaveLength(1);
      });

      it("사람이 푼 PR 에는 표식의 연결을 쓰지 않는다", async () => {
        const store = await make({ projects: [project], works: [work], links: [userLink("w1")] });
        await store.unlink({ repoId: 1, number: 1, workId: "w1" }, "2026-09-25T01:00:00.000Z");
        await expect(store.addLink(markerLink("w1"))).rejects.toMatchObject({ code: "unlinked_by_user" });
        expect(await store.listLinks()).toEqual([]);
        expect(await store.listUnlinks()).toHaveLength(1);
      });

      it("사람이 다시 연결하면(Link to Work 든 New Work 든) 해제 기록이 사라진다", async () => {
        const store = await make({ projects: [project], works: [work, other], links: [userLink("w1")] });
        await store.unlink({ repoId: 1, number: 1, workId: "w1" }, "2026-09-25T01:00:00.000Z");
        await store.addLink(userLink("w2"));
        expect(await store.listUnlinks()).toEqual([]);

        await store.unlink({ repoId: 1, number: 1, workId: "w2" }, "2026-09-25T02:00:00.000Z");
        const fresh: Work = { ...work, id: "w3", title: "새 업무" };
        await store.createWorkWithLink(fresh, userLink("w3"));
        expect(await store.listUnlinks()).toEqual([]);
        expect((await store.getLink({ repoId: 1, number: 1 }))?.workId).toBe("w3");
      });
    });

    describe("PR 이벤트 (feature-plan F7)", () => {
      const sha = (c: string) => c.repeat(40);
      const events: PrEvent[] = [
        { id: "e1", repoId: 1, number: 1, workId: "w1", kind: "linked", origin: "marker", commitSha: sha("a"), at: "2026-09-28T00:00:00.000Z" },
        { id: "e2", repoId: 1, number: 1, workId: "w1", kind: "new_commit", previousSha: sha("a"), commitSha: sha("b"), at: "2026-09-28T00:00:00.000Z" },
        { id: "e3", repoId: 1, number: 1, workId: "w1", kind: "checks", checks: "failing", commitSha: sha("b"), at: "2026-09-28T00:00:00.000Z" },
        { id: "e4", repoId: 1, number: 1, workId: "w1", kind: "merged", commitSha: sha("b"), at: "2026-09-28T00:00:01.000Z" },
        { id: "e5", repoId: 1, number: 1, workId: "w2", kind: "unlinked", commitSha: sha("b"), at: "2026-09-28T00:00:02.000Z" },
      ];

      it("쌓은 그대로(종류마다 다른 칸 포함) 업무별로, 쌓인 순서대로 돌아온다 (같은 시각이어도)", async () => {
        const store = await make({ projects: [project], works: [work, other] });
        await store.addPrEvents(events.slice(0, 2));
        await store.addPrEvents(events.slice(2));
        expect(await store.listPrEvents("w1")).toEqual(events.slice(0, 4));
        expect(await store.listPrEvents("w2")).toEqual([events[4]]);
        expect(await store.listPrEvents("nope")).toEqual([]);
      });

      it("같은 ID 는 한 번만 남는다 — 같은 묶음 안에서도, 동시에 들어와도", async () => {
        const store = await make({ projects: [project], works: [work] });
        await store.addPrEvents([events[0]!, events[0]!]);
        await Promise.all([store.addPrEvents(events.slice(0, 2)), store.addPrEvents(events.slice(0, 2)), store.addPrEvents([events[1]!])]);
        expect((await store.listPrEvents("w1")).map((e) => e.id)).toEqual(["e1", "e2"]);
      });

      it("범위 밖 PR · 목록 밖 종류 → invalid_input, 없는 업무 → not_found 이고 묶음 전체를 쓰지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await expect(store.addPrEvents([events[0]!, { ...events[1]!, number: 0 }])).rejects.toMatchObject({ code: "invalid_input" });
        await expect(store.addPrEvents([events[0]!, { ...events[3]!, kind: "exploded" } as unknown as PrEvent])).rejects.toMatchObject({
          code: "invalid_input",
        });
        await expect(store.addPrEvents([events[0]!, { ...events[3]!, workId: "ghost" }])).rejects.toMatchObject({ code: "not_found" });
        expect(await store.listPrEvents("w1")).toEqual([]);
      });

      it("돌려받은 이벤트를 고쳐도 저장된 값은 바뀌지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await store.addPrEvents([events[0]!]);
        const got = (await store.listPrEvents("w1")) as { commitSha: string }[];
        got[0]!.commitSha = "x";
        expect(await store.listPrEvents("w1")).toEqual([events[0]]);
      });

      it("처음 상태로 심은 이벤트도 그대로 돌아온다", async () => {
        const store = await make({ projects: [project], works: [work], events: [events[0]!] });
        expect(await store.listPrEvents("w1")).toEqual([events[0]]);
      });
    });

    describe("메모 (feature-plan F8)", () => {
      const memo = (id: string, workId = "w1", createdAt = "2026-09-28T00:00:00.000Z"): Memo => ({
        id,
        workId,
        author: "me",
        body: `메모 ${id}\n둘째 줄`,
        createdAt,
        editedAt: null,
        deletedAt: null,
      });

      it("쓴 그대로(줄바꿈 · 작성자 포함) 업무별로, 쌓인 순서대로 돌아온다 (같은 시각이어도)", async () => {
        const store = await make({ projects: [project], works: [work, other] });
        await store.addMemo(memo("m2"));
        await store.addMemo(memo("m1"));
        await store.addMemo(memo("m3", "w2"));
        expect(await store.listMemos("w1")).toEqual([memo("m2"), memo("m1")]);
        expect(await store.listMemos("w2")).toEqual([memo("m3", "w2")]);
        expect(await store.listMemos("nope")).toEqual([]);
      });

      it("고치면 본문과 고친 시각이 바뀌고 자리는 그대로다. 지우면 본문이 비고 지운 시각이 남으며, 다시 지워도 처음 시각이 남는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await store.addMemo(memo("m1"));
        await store.addMemo(memo("m2"));
        await store.editMemo({ workId: "w1", id: "m1", body: "고친 본문", editedAt: "2026-09-28T01:00:00.000Z" });
        expect((await store.listMemos("w1")).map((m) => [m.id, m.body, m.editedAt])).toEqual([
          ["m1", "고친 본문", "2026-09-28T01:00:00.000Z"],
          ["m2", "메모 m2\n둘째 줄", null],
        ]);
        await store.deleteMemo({ workId: "w1", id: "m1", deletedAt: "2026-09-28T02:00:00.000Z" });
        await store.deleteMemo({ workId: "w1", id: "m1", deletedAt: "2026-09-28T03:00:00.000Z" });
        expect((await store.listMemos("w1"))[0]).toEqual({ ...memo("m1"), body: "", editedAt: "2026-09-28T01:00:00.000Z", deletedAt: "2026-09-28T02:00:00.000Z" });
      });

      it("규칙 밖 본문 · 빈 작성자 · 처음부터 고침/지움 → invalid_input, 없는 업무 → not_found, 같은 ID → invalid_input 이고 아무것도 쓰지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        for (const bad of [{ body: "" }, { body: " 앞 공백" }, { body: "탭\t가운데" }, { body: "가".repeat(4001) }, { author: "" }, { editedAt: "2026-09-28T00:00:00.000Z" }]) {
          await expect(store.addMemo({ ...memo("m1"), ...bad })).rejects.toMatchObject({ code: "invalid_input" });
        }
        await expect(store.addMemo(memo("m1", "ghost"))).rejects.toMatchObject({ code: "not_found" });
        expect(await store.listMemos("w1")).toEqual([]);
        await store.addMemo(memo("m1"));
        await expect(store.addMemo({ ...memo("m1"), body: "다른 본문" })).rejects.toMatchObject({ code: "invalid_input" });
        expect(await store.listMemos("w1")).toEqual([memo("m1")]);
      });

      it("없는 메모 · 다른 업무의 메모는 not_found, 지운 메모 고치기와 규칙 밖 본문은 invalid_input 이고 아무것도 바꾸지 않는다", async () => {
        const store = await make({ projects: [project], works: [work, other] });
        await store.addMemo(memo("m1"));
        const at = "2026-09-28T01:00:00.000Z";
        await expect(store.editMemo({ workId: "w2", id: "m1", body: "남의 것", editedAt: at })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.deleteMemo({ workId: "w2", id: "m1", deletedAt: at })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.editMemo({ workId: "w1", id: "nope", body: "x", editedAt: at })).rejects.toMatchObject({ code: "not_found" });
        await expect(store.editMemo({ workId: "w1", id: "m1", body: "", editedAt: at })).rejects.toMatchObject({ code: "invalid_input" });
        expect(await store.listMemos("w1")).toEqual([memo("m1")]);
        await store.deleteMemo({ workId: "w1", id: "m1", deletedAt: at });
        await expect(store.editMemo({ workId: "w1", id: "m1", body: "되살리기", editedAt: at })).rejects.toMatchObject({ code: "invalid_input" });
        expect((await store.listMemos("w1"))[0]).toMatchObject({ body: "", editedAt: null, deletedAt: at });
      });

      it("동시에 고치고 지우면 지운 쪽이 이기거나 고친 뒤 지워진다 — 어느 쪽이든 지운 메모에 본문이 남지 않는다", async () => {
        const store = await make({ projects: [project], works: [work] });
        await store.addMemo(memo("m1"));
        await Promise.allSettled([
          store.editMemo({ workId: "w1", id: "m1", body: "고친 본문", editedAt: "2026-09-28T01:00:00.000Z" }),
          store.deleteMemo({ workId: "w1", id: "m1", deletedAt: "2026-09-28T01:00:00.000Z" }),
        ]);
        expect((await store.listMemos("w1"))[0]).toMatchObject({ body: "", deletedAt: "2026-09-28T01:00:00.000Z" });
      });

      it("돌려받은 메모를 고쳐도 저장된 값은 바뀌지 않고, 처음 상태로 심은 메모도 그대로 돌아온다", async () => {
        const store = await make({ projects: [project], works: [work], memos: [memo("m0")] });
        const got = (await store.listMemos("w1")) as { body: string }[];
        got[0]!.body = "x";
        expect(await store.listMemos("w1")).toEqual([memo("m0")]);
      });
    });
  });
}

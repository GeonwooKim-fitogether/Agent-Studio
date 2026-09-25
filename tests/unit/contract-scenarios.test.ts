/**
 * 계약의 확인 시나리오 5개 (docs/plan/00-domain-contract.md §8, docs/plan/01-pr-collection.md §4).
 * 테스트 이름의 `scenario-N` 이 통과 기준의 번호와 같다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_REPO, DEMO_SHA, demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { createWorkFromPr, linkPrToWork } from "../../src/application/inbox-actions";
import { getInbox, getWorkDetail, getWorkspace, type PrCardView } from "../../src/application/queries";
import { recordReviewDecision } from "../../src/application/review";
import { syncAll } from "../../src/application/sync";
import { prKey } from "../../src/domain/model";
import { setup } from "./helpers";

const ref = (repoId: number, number: number) => ({ repoId, number });

async function workspaceCards(deps: Parameters<typeof getWorkspace>[0]) {
  const view = await getWorkspace(deps);
  return view.projects.flatMap(({ project, works }) =>
    works.flatMap(({ work, prs }) => prs.map((pr) => ({ project, work, pr }))),
  );
}

async function inboxCards(deps: Parameters<typeof getInbox>[0]) {
  const view = await getInbox(deps);
  return view.groups.flatMap(({ project, items }) => items.map((item) => ({ project, ...item })));
}

describe("scenario-1 저장소 5개의 같은 브랜치 이름 PR", () => {
  it("scenario-1: 저장소 5개에 같은 이름의 브랜치로 PR 이 하나씩 있어도 서로 섞이지 않고 각자의 프로젝트에 보인다", async () => {
    const { data, deps } = setup();
    const sameBranch = data.pullRequests.filter((p) => p.branch === "feat/login-page" && p.number === 12);
    expect(new Set(sameBranch.map((p) => p.repoId)).size).toBe(5); // 전제: 다섯 저장소, 같은 브랜치, 같은 번호

    await syncAll(deps);
    const shown = [...(await workspaceCards(deps)), ...(await inboxCards(deps))];

    for (const pr of sameBranch) {
      const places = shown.filter((s) => s.pr.key === prKey(pr));
      expect(places, `${pr.repoId}#12 는 정확히 한 곳에 보여야 한다`).toHaveLength(1);
      expect(places[0]?.project.repoIds).toContain(pr.repoId);
    }
    // 어느 카드도 자기 프로젝트 밖 저장소의 PR 을 담지 않는다
    for (const s of shown) expect(s.project.repoIds).toContain(s.pr.repoId);
    // 표식으로 붙은 두 PR 은 각자의 프로젝트 업무에만 있다
    const payments = shown.filter((s) => s.pr.key === prKey(ref(DEMO_REPO.payments, 12)));
    expect(payments.map((s) => "work" in s && s.work.id)).toEqual(["a1b2c3"]);
    const admin = shown.filter((s) => s.pr.key === prKey(ref(DEMO_REPO.adminConsole, 12)));
    expect(admin.map((s) => "work" in s && s.work.id)).toEqual(["d0e1f2"]);
  });

  it("scenario-1: 저장소 이름이 바뀌어도 숫자 ID 가 같으면 같은 PR 로 취급한다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    await linkPrToWork(deps, { ...ref(DEMO_REPO.coachWeb, 12), workId: "b4c5d6" });
    const before = (await deps.store.listSnapshots()).length;

    // GitHub 에서 저장소 이름을 바꿨다 (숫자 ID 는 그대로)
    data.repositories = data.repositories.map((r) =>
      r.id === DEMO_REPO.coachWeb ? { ...r, fullName: "demo-org/coach-portal" } : r,
    );
    await syncAll(deps);

    expect(await deps.store.listSnapshots()).toHaveLength(before); // 새 PR 로 늘어나지 않는다
    const detail = await getWorkDetail(deps, "b4c5d6");
    expect(detail?.prs.map((p) => [p.key, p.repoName])).toEqual([
      [prKey(ref(DEMO_REPO.coachWeb, 12)), "demo-org/coach-portal"],
    ]);
    expect((await inboxCards(deps)).map((c) => c.pr.key)).not.toContain(prKey(ref(DEMO_REPO.coachWeb, 12)));
  });

  it("scenario-1: 이름이 같아도 숫자 ID 가 다른 저장소의 PR 은 다른 PR 이다", async () => {
    const { data, deps } = setup();
    const impostor = { id: 799999, fullName: "demo-org/payments" }; // 같은 이름, 다른 저장소
    data.repositories.push(impostor);
    const original = data.pullRequests.find((p) => p.repoId === DEMO_REPO.payments && p.number === 12);
    if (original === undefined) throw new Error("fixture 에 payments#12 가 없다");
    data.pullRequests.push({ ...original, repoId: impostor.id }); // 같은 번호 · 같은 브랜치 · 같은 표식

    await syncAll(deps);

    const payments = await getWorkDetail(deps, "a1b2c3");
    expect(payments?.prs.map((p) => p.repoId)).not.toContain(impostor.id);
    const inbox = await inboxCards(deps);
    const impostorItem = inbox.find((c) => c.pr.repoId === impostor.id);
    expect(impostorItem?.reason).toBe("other_project"); // 표식이 다른 프로젝트(원래 payments)의 업무를 가리킨다
  });
});

describe("scenario-2 표식이 확실하지 않은 PR 은 Inbox 로", () => {
  it("scenario-2: 업무 표식이 없는 외부 PR 은 어떤 업무에도 자동으로 붙지 않고 Inbox 에 나타난다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const key = prKey(ref(DEMO_REPO.coachWeb, 12));

    expect(await deps.store.getLink(ref(DEMO_REPO.coachWeb, 12))).toBeUndefined();
    expect((await workspaceCards(deps)).map((c) => c.pr.key)).not.toContain(key);
    const item = (await inboxCards(deps)).find((c) => c.pr.key === key);
    expect(item?.reason).toBe("no_marker");
    expect(item?.project.id).toBe("coach");
  });

  it("scenario-2: 없는 업무, 다른 프로젝트의 업무, 서로 다른 업무를 가리키는 표식 둘은 모두 Inbox 로 간다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const reasons = new Map((await inboxCards(deps)).map((c) => [c.pr.key, c.reason]));

    expect(reasons.get(prKey(ref(DEMO_REPO.playerApp, 9)))).toBe("unknown_work");
    expect(reasons.get(prKey(ref(DEMO_REPO.playerApp, 12)))).toBe("other_project");
    expect(reasons.get(prKey(ref(DEMO_REPO.docsSite, 12)))).toBe("multiple_markers");
    for (const r of [ref(DEMO_REPO.playerApp, 9), ref(DEMO_REPO.playerApp, 12), ref(DEMO_REPO.docsSite, 12)]) {
      expect(await deps.store.getLink(r)).toBeUndefined();
    }
  });

  it("scenario-2 (대조): 같은 프로젝트 업무의 표식이 정확히 하나면 본문이든 브랜치 이름이든 자동으로 연결된다", async () => {
    const { deps } = setup();
    const result = await syncAll(deps);

    expect(await deps.store.getLink(ref(DEMO_REPO.payments, 12))).toMatchObject({ workId: "a1b2c3", origin: "marker" }); // 본문
    expect(await deps.store.getLink(ref(DEMO_REPO.payments, 15))).toMatchObject({ workId: "a1b2c3", origin: "marker" }); // 브랜치 이름
    expect(await deps.store.getLink(ref(DEMO_REPO.adminConsole, 12))).toMatchObject({ workId: "d0e1f2", origin: "marker" });
    expect(result.autoLinked).toBe(3);
  });
});

describe("scenario-3 Inbox 에서 사람이 연결", () => {
  it("scenario-3: Inbox 의 PR 을 기존 업무에 연결하면 업무 화면과 Workspace 에 PR 카드가 나타나고 Inbox 에서 사라진다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const key = prKey(ref(DEMO_REPO.coachWeb, 12));
    const inboxBefore = (await getInbox(deps)).total;

    await linkPrToWork(deps, { ...ref(DEMO_REPO.coachWeb, 12), workId: "b4c5d6" });

    expect((await getWorkDetail(deps, "b4c5d6"))?.prs.map((p) => p.key)).toEqual([key]);
    const inWorkspace = (await workspaceCards(deps)).filter((c) => c.pr.key === key);
    expect(inWorkspace.map((c) => c.work.id)).toEqual(["b4c5d6"]);
    expect(inWorkspace[0]?.pr.studio.linkOrigin).toBe("user");
    expect((await inboxCards(deps)).map((c) => c.pr.key)).not.toContain(key);
    expect((await getInbox(deps)).total).toBe(inboxBefore - 1);
    expect((await getWorkspace(deps)).inboxCount).toBe(inboxBefore - 1);
  });

  it("scenario-3: New Work 로 PR 에서 새 업무를 만들어도 업무 화면과 Workspace 에 나타나고 Inbox 에서 사라진다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const key = prKey(ref(DEMO_REPO.docsSite, 12));

    const work = await createWorkFromPr(deps, ref(DEMO_REPO.docsSite, 12));

    expect(work).toMatchObject({ projectId: "docs", title: "로그인 안내 문서", status: "draft" });
    const detail = await getWorkDetail(deps, work.id);
    expect(detail?.marker).toBe(`studio-work-${work.id}`);
    expect(detail?.prs.map((p) => p.key)).toEqual([key]);
    expect((await workspaceCards(deps)).filter((c) => c.pr.key === key).map((c) => c.work.id)).toEqual([work.id]);
    expect((await inboxCards(deps)).map((c) => c.pr.key)).not.toContain(key);
  });

  it("scenario-3: 사람이 연결한 PR 은 다시 동기화해도 연결이 유지된다 (본문의 표식이 다른 곳을 가리켜도)", async () => {
    const { deps } = setup();
    await syncAll(deps);
    // player-app#12 의 본문은 다른 프로젝트 업무의 표식을 담고 있다. 사람은 같은 프로젝트의 업무에 연결했다.
    await linkPrToWork(deps, { ...ref(DEMO_REPO.playerApp, 12), workId: "c7d8e9" });

    await syncAll(deps);
    await syncAll(deps);

    expect(await deps.store.getLink(ref(DEMO_REPO.playerApp, 12))).toMatchObject({ workId: "c7d8e9", origin: "user" });
    expect((await getWorkDetail(deps, "c7d8e9"))?.prs.map((p) => p.key)).toEqual([prKey(ref(DEMO_REPO.playerApp, 12))]);
  });

  it("scenario-3: 다른 프로젝트의 업무나 이미 연결된 PR 에는 연결하지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);

    await expect(linkPrToWork(deps, { ...ref(DEMO_REPO.playerApp, 12), workId: "a1b2c3" })).rejects.toMatchObject({
      code: "project_mismatch",
    });
    await expect(linkPrToWork(deps, { ...ref(DEMO_REPO.payments, 12), workId: "a1b2c3" })).rejects.toMatchObject({
      code: "already_linked",
    });
    await expect(createWorkFromPr(deps, ref(DEMO_REPO.payments, 12))).rejects.toMatchObject({ code: "already_linked" });
    expect((await inboxCards(deps)).map((c) => c.pr.key)).toContain(prKey(ref(DEMO_REPO.playerApp, 12)));
  });
});

describe("scenario-4 새 커밋이 오면 커밋에 고정된 기록은 이전 버전", () => {
  it("scenario-4: PR 에 새 커밋이 올라오면 이전 커밋의 미리보기 기록과 내부 검토 결정이 이전 버전으로 판정되고, 기록은 지워지지 않는다", async () => {
    const seed = demoStudioSeed();
    const { data, deps } = setup({
      seed: {
        ...seed,
        previews: [
          { id: "pv-1", repoId: DEMO_REPO.adminConsole, number: 12, commitSha: DEMO_SHA.admin12Head, startedAt: "2026-09-24T11:00:00.000Z" },
        ],
      },
    });
    await syncAll(deps);
    await recordReviewDecision(deps, { ...ref(DEMO_REPO.adminConsole, 12), workId: "d0e1f2", verdict: "changes_requested" });

    const card = async (): Promise<PrCardView | undefined> =>
      (await getWorkDetail(deps, "d0e1f2"))?.prs.find((p) => p.key === prKey(ref(DEMO_REPO.adminConsole, 12)));

    const before = await card();
    expect(before?.studio.reviews.map((r) => r.freshness)).toEqual(["current", "current"]);
    expect(before?.studio.previews.map((p) => p.freshness)).toEqual(["current"]);

    // 새 커밋이 올라왔다
    data.pullRequests = data.pullRequests.map((p) =>
      p.repoId === DEMO_REPO.adminConsole && p.number === 12 ? { ...p, headSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd" } : p,
    );
    await syncAll(deps);

    const after = await card();
    expect(after?.headSha).toBe("abcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(after?.studio.reviews).toHaveLength(2); // 지워지지 않는다
    expect(after?.studio.reviews.map((r) => [r.freshness, r.commitSha])).toEqual([
      ["outdated", DEMO_SHA.admin12Head],
      ["outdated", DEMO_SHA.admin12Head],
    ]);
    expect(after?.studio.previews.map((p) => [p.freshness, p.commitSha])).toEqual([["outdated", DEMO_SHA.admin12Head]]);
    expect(await deps.store.listReviewDecisions()).toHaveLength((seed.reviews ?? []).length + 1);
  });

  it("scenario-4: 시연 데이터의 결제 서비스 업무에는 이전 커밋에 대한 내부 검토 결정이 이전 버전으로 보인다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const card = (await getWorkDetail(deps, "a1b2c3"))?.prs.find((p) => p.key === prKey(ref(DEMO_REPO.payments, 12)));
    expect(card?.headSha).toBe(DEMO_SHA.payments12Head);
    expect(card?.studio.reviews.map((r) => [r.verdict, r.freshness, r.commitSha])).toEqual([
      ["changes_requested", "outdated", DEMO_SHA.payments12Reviewed],
    ]);
  });
});

describe("scenario-5 내부 검토 완료는 GitHub 상태를 바꾸지 않는다", () => {
  it("scenario-5: 내부 검토 완료를 남겨도 GitHub 의 PR 상태는 바뀌지 않고, 두 상태는 서로 다른 필드로 따로 보인다", async () => {
    const { deps, readerCalls } = setup();
    await syncAll(deps);
    const target = ref(DEMO_REPO.payments, 12);
    const snapshotBefore = await deps.store.getSnapshot(target);
    const callsBefore = readerCalls.length;

    const decision = await recordReviewDecision(deps, { ...target, workId: "a1b2c3", verdict: "internal_review_done" });

    expect(decision.commitSha).toBe(DEMO_SHA.payments12Head); // 어느 커밋에 대한 결정인지 함께 남는다
    expect(readerCalls.length).toBe(callsBefore); // GitHub 쪽으로 아무 요청도 만들지 않았다
    expect(await deps.store.getSnapshot(target)).toEqual(snapshotBefore); // 받아 적은 GitHub 상태는 그대로다

    await syncAll(deps); // GitHub 를 다시 읽어도 PR 상태는 그대로 Open 이다
    const card = (await getWorkDetail(deps, "a1b2c3"))?.prs.find((p) => p.key === prKey(target));
    expect(card?.github).toEqual({ state: "open", checks: "failing", review: "changes_requested" });
    expect(card?.studio.reviews.at(-1)).toMatchObject({ verdict: "internal_review_done", freshness: "current" });
    // 두 상태는 서로의 필드를 갖지 않는다 — 화면은 이 두 묶음을 다른 줄에 그린다
    expect(Object.keys(card?.github ?? {})).not.toContain("verdict");
    expect(Object.keys(card?.studio ?? {})).not.toContain("state");
  });

  it("scenario-5: 연결되지 않은 PR 이나 다른 업무의 PR 에는 내부 검토 결정을 남기지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    await expect(
      recordReviewDecision(deps, { ...ref(DEMO_REPO.coachWeb, 12), workId: "b4c5d6", verdict: "internal_review_done" }),
    ).rejects.toMatchObject({ code: "not_linked" });
    await expect(
      recordReviewDecision(deps, { ...ref(DEMO_REPO.payments, 12), workId: "d0e1f2", verdict: "internal_review_done" }),
    ).rejects.toMatchObject({ code: "not_linked" });
  });
});

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
import { prKey, type PrSnapshot } from "../../src/domain/model";
import type { GitHubReader } from "../../src/ports/github-reader";
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
    data.pullRequests.push({ ...original, repoId: impostor.id, headRepoId: impostor.id }); // 같은 번호 · 같은 브랜치 · 같은 표식

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

    expect(await deps.store.getLink(ref(DEMO_REPO.payments, 12))).toMatchObject({
      workId: "a1b2c3",
      origin: "marker",
      markerFoundIn: ["body"],
    });
    expect(await deps.store.getLink(ref(DEMO_REPO.payments, 15))).toMatchObject({
      workId: "a1b2c3",
      origin: "marker",
      markerFoundIn: ["branch"],
    });
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

  it("scenario-3: 다른 프로젝트의 업무나, 이미 다른 업무에 연결된 PR 에는 연결하지 않는다", async () => {
    const { deps } = setup();
    await syncAll(deps);

    await expect(linkPrToWork(deps, { ...ref(DEMO_REPO.playerApp, 12), workId: "a1b2c3" })).rejects.toMatchObject({
      code: "project_mismatch",
    });
    expect((await inboxCards(deps)).map((c) => c.pr.key)).toContain(prKey(ref(DEMO_REPO.playerApp, 12)));

    // player-app#9 를 사람이 c7d8e9 에 연결한 뒤, 같은 프로젝트의 다른 업무로 다시 연결하려 하면 거절한다
    await linkPrToWork(deps, { ...ref(DEMO_REPO.playerApp, 9), workId: "c7d8e9" });
    const other = await createWorkFromPr(deps, ref(DEMO_REPO.playerApp, 12)); // 같은 프로젝트(선수 앱)의 두 번째 업무
    await expect(linkPrToWork(deps, { ...ref(DEMO_REPO.playerApp, 9), workId: other.id })).rejects.toMatchObject({
      code: "already_linked",
    });
    await expect(createWorkFromPr(deps, ref(DEMO_REPO.payments, 12))).rejects.toMatchObject({ code: "already_linked" });
    expect(await deps.store.getLink(ref(DEMO_REPO.playerApp, 9))).toMatchObject({ workId: "c7d8e9" });
  });

  it("scenario-3: 같은 업무로 다시 연결하면(이중 클릭) 아무 일 없이 성공하고 연결은 하나로 남는다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const target = { ...ref(DEMO_REPO.coachWeb, 12), workId: "b4c5d6" };

    await linkPrToWork(deps, target);
    await expect(linkPrToWork(deps, target)).resolves.toBeUndefined(); // 차례로 두 번
    const fresh = { ...ref(DEMO_REPO.playerApp, 9), workId: "c7d8e9" };
    await expect(Promise.all([linkPrToWork(deps, fresh), linkPrToWork(deps, fresh)])).resolves.toEqual([undefined, undefined]); // 동시에 두 번

    const links = await deps.store.listLinks();
    expect(links.filter((l) => l.repoId === DEMO_REPO.coachWeb)).toHaveLength(1);
    expect(links.filter((l) => l.repoId === DEMO_REPO.playerApp && l.number === 9)).toHaveLength(1);
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
    // 저장소 내부 객체가 아니라 깊은 복사본을 떠 둔다 — 제자리 변경도 잡기 위해서다
    const snapshotsBefore = structuredClone(await deps.store.listSnapshots());
    const callsBefore = readerCalls.length;

    const decision = await recordReviewDecision(deps, { ...target, workId: "a1b2c3", verdict: "internal_review_done" });

    // 재동기화하기 전에 확인한다. 재동기화는 fixture 의 값으로 스냅샷을 덮어써 변화를 가려 버린다.
    expect(decision.commitSha).toBe(DEMO_SHA.payments12Head); // 어느 커밋에 대한 결정인지 함께 남는다
    expect(readerCalls.length).toBe(callsBefore); // GitHub 쪽으로 아무 요청도 만들지 않았다
    expect(await deps.store.listSnapshots()).toEqual(snapshotsBefore); // 받아 적은 GitHub 상태는 하나도 바뀌지 않았다
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

describe("추정 근거로는 연결하지 않는다 (계약 §4)", () => {
  it("같은 프로젝트에 제목이 똑같은 업무가 있어도, 표식이 없는 PR 은 Inbox 로 간다", async () => {
    const { data, deps } = setup();
    // 코치 대시보드의 업무 제목과 글자 하나까지 같은 제목, 표식 없음
    data.pullRequests = [
      ...data.pullRequests,
      demoPr({ repoId: DEMO_REPO.coachWeb, number: 20, title: "코치 로그인 개편", body: "제목만 같다", branch: "feat/coach-login" }),
    ];
    await syncAll(deps);

    expect(await deps.store.getLink(ref(DEMO_REPO.coachWeb, 20))).toBeUndefined();
    expect((await inboxCards(deps)).find((c) => c.pr.key === prKey(ref(DEMO_REPO.coachWeb, 20)))?.reason).toBe("no_marker");
  });

  it("New Work 가 PR 제목을 업무 제목으로 복사해도, 같은 제목의 다른 PR 은 그 업무에 붙지 않는다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    const work = await createWorkFromPr(deps, ref(DEMO_REPO.docsSite, 12)); // 업무 제목 = "로그인 안내 문서"
    data.pullRequests = [
      ...data.pullRequests,
      demoPr({ repoId: DEMO_REPO.docsSite, number: 13, title: "로그인 안내 문서", body: "", branch: "docs/login-guide-2" }),
    ];

    await syncAll(deps);

    expect(work.title).toBe("로그인 안내 문서");
    expect(await deps.store.getLink(ref(DEMO_REPO.docsSite, 13))).toBeUndefined();
    expect((await inboxCards(deps)).map((c) => c.pr.key)).toContain(prKey(ref(DEMO_REPO.docsSite, 13)));
  });

  it("PR 제목에만 들어 있는 표식은 보지 않는다 (표식을 찾는 자리는 본문과 브랜치 이름뿐)", async () => {
    const { data, deps } = setup();
    data.pullRequests = [
      ...data.pullRequests,
      demoPr({ repoId: DEMO_REPO.coachWeb, number: 21, title: "studio-work-b4c5d6 로그인", body: "", branch: "feat/x" }),
    ];
    await syncAll(deps);

    expect(await deps.store.getLink(ref(DEMO_REPO.coachWeb, 21))).toBeUndefined();
    expect((await inboxCards(deps)).find((c) => c.pr.key === prKey(ref(DEMO_REPO.coachWeb, 21)))?.reason).toBe("no_marker");
  });

  it("studio-work-b4c5d6x 는 업무 b4c5d6 의 표식이 아니다", async () => {
    const { data, deps } = setup();
    data.pullRequests = [
      ...data.pullRequests,
      demoPr({ repoId: DEMO_REPO.coachWeb, number: 22, title: "비슷한 표식", body: "studio-work-b4c5d6x", branch: "feat/y" }),
    ];
    await syncAll(deps);

    expect(await deps.store.getLink(ref(DEMO_REPO.coachWeb, 22))).toBeUndefined();
    const item = (await inboxCards(deps)).find((c) => c.pr.key === prKey(ref(DEMO_REPO.coachWeb, 22)));
    expect(item).toMatchObject({ reason: "unknown_work", markedWorkIds: ["b4c5d6x"] });
  });
});

describe("시간이 지나며 바뀌는 것", () => {
  it("표식이 가리키는 업무가 나중에 생기면, 다음 동기화에서 그 업무에 연결된다", async () => {
    const { data, deps } = setup(); // 도우미의 새 ID 는 n00001 부터 차례로 나온다
    data.pullRequests = [
      ...data.pullRequests,
      demoPr({ repoId: DEMO_REPO.docsSite, number: 30, title: "안내 문서 보강", body: "studio-work-n00001", branch: "docs/more" }),
    ];
    await syncAll(deps);
    expect((await inboxCards(deps)).find((c) => c.pr.key === prKey(ref(DEMO_REPO.docsSite, 30)))?.reason).toBe("unknown_work");

    const work = await createWorkFromPr(deps, ref(DEMO_REPO.docsSite, 12));
    expect(work.id).toBe("n00001");
    await syncAll(deps);

    expect(await deps.store.getLink(ref(DEMO_REPO.docsSite, 30))).toMatchObject({
      workId: "n00001",
      origin: "marker",
      markerFoundIn: ["body"],
    });
  });

  it("표식으로 연결된 PR 의 표식이 나중에 지워지거나 다른 업무로 바뀌어도, 연결은 처음 업무에 남는다", async () => {
    const { data, deps } = setup();
    data.pullRequests = [
      ...data.pullRequests,
      demoPr({ repoId: DEMO_REPO.payments, number: 40, title: "결제 취소", body: "", branch: "feat/cancel" }),
    ];
    await syncAll(deps);
    const second = await createWorkFromPr(deps, ref(DEMO_REPO.payments, 40)); // 같은 프로젝트의 두 번째 업무
    const setBody = (body: string) => {
      data.pullRequests = data.pullRequests.map((p) =>
        p.repoId === DEMO_REPO.payments && p.number === 12 ? { ...p, body } : p,
      );
    };

    setBody("표식을 지웠다");
    await syncAll(deps);
    expect(await deps.store.getLink(ref(DEMO_REPO.payments, 12))).toMatchObject({ workId: "a1b2c3", origin: "marker" });

    setBody(`studio-work-${second.id}`);
    await syncAll(deps);
    expect(await deps.store.getLink(ref(DEMO_REPO.payments, 12))).toMatchObject({ workId: "a1b2c3", origin: "marker" });
  });

  it("신선도는 SHA 전체로 비교한다 — 앞 7자만 같은 새 커밋이 오면 이전 버전이다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    const sameShort = `${DEMO_SHA.admin12Head.slice(0, 7)}${"0".repeat(33)}`;
    expect(sameShort.slice(0, 7)).toBe(DEMO_SHA.admin12Head.slice(0, 7));
    expect(sameShort).not.toBe(DEMO_SHA.admin12Head);
    data.pullRequests = data.pullRequests.map((p) =>
      p.repoId === DEMO_REPO.adminConsole && p.number === 12 ? { ...p, headSha: sameShort } : p,
    );

    await syncAll(deps);

    const card = (await getWorkDetail(deps, "d0e1f2"))?.prs[0];
    expect(card?.studio.reviews.map((r) => r.freshness)).toEqual(["outdated"]);
  });
});

describe("기록과 후보가 섞이지 않는다", () => {
  it("번호가 같은 서로 다른 저장소 PR 의 내부 검토 결정과 미리보기 기록은 섞이지 않는다", async () => {
    // 한 프로젝트에 저장소 둘, 두 저장소 모두 PR #12, 둘 다 같은 업무 m1 에 표식으로 연결된다
    const repoA = 810001;
    const repoB = 810002;
    const { deps } = setup({
      data: {
        repositories: [
          { id: repoA, fullName: "demo-org/app-a" },
          { id: repoB, fullName: "demo-org/app-b" },
        ],
        pullRequests: [
          demoPr({ repoId: repoA, number: 12, title: "A", body: "studio-work-m1", branch: "feat/login-page", headSha: "a".repeat(40) }),
          demoPr({ repoId: repoB, number: 12, title: "B", body: "studio-work-m1", branch: "feat/login-page", headSha: "b".repeat(40) }),
        ],
      },
      seed: {
        projects: [{ id: "multi", name: "두 저장소 프로젝트", repoIds: [repoA, repoB] }],
        works: [{ id: "m1", projectId: "multi", title: "로그인", status: "draft", createdAt: "2026-09-20T00:00:00.000Z" }],
        reviews: [
          { id: "r-a", workId: "m1", repoId: repoA, number: 12, commitSha: "a".repeat(40), verdict: "internal_review_done", decidedAt: "2026-09-24T00:00:00.000Z" },
        ],
        previews: [{ id: "p-a", repoId: repoA, number: 12, commitSha: "a".repeat(40), startedAt: "2026-09-24T00:00:00.000Z" }],
      },
    });
    await syncAll(deps);

    const cards = (await getWorkDetail(deps, "m1"))?.prs ?? [];
    const a = cards.find((c) => c.repoId === repoA);
    const b = cards.find((c) => c.repoId === repoB);
    expect(cards).toHaveLength(2);
    expect(a?.studio.reviews.map((r) => r.id)).toEqual(["r-a"]);
    expect(a?.studio.previews.map((p) => p.id)).toEqual(["p-a"]);
    expect(b?.studio.reviews).toEqual([]);
    expect(b?.studio.previews).toEqual([]);
  });

  it("Inbox 에서 연결할 수 있는 업무 후보는 그 PR 의 프로젝트 업무뿐이다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const inbox = await getInbox(deps);

    for (const group of inbox.groups) {
      for (const work of group.candidates) expect(work.projectId).toBe(group.project.id);
    }
    const candidatesOf = (projectId: string) =>
      inbox.groups.find((g) => g.project.id === projectId)?.candidates.map((w) => w.id);
    expect(candidatesOf("coach")).toEqual(["b4c5d6"]);
    expect(candidatesOf("player")).toEqual(["c7d8e9"]);
    expect(candidatesOf("docs")).toEqual([]);
  });

  it("다른 프로젝트의 표식이면 Inbox 사유에 그 프로젝트 이름이 실린다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const item = (await inboxCards(deps)).find((c) => c.pr.key === prKey(ref(DEMO_REPO.playerApp, 12)));
    expect(item).toMatchObject({ reason: "other_project", markedProjectName: "결제 서비스" });
  });
});

describe("동기화가 믿지 않는 응답", () => {
  it("요청한 저장소와 저장소 ID 가 다른 스냅샷은 받아 적지도 연결하지도 않고, 버린 목록에 남긴다", async () => {
    const { deps } = setup();
    const inner = deps.reader;
    // 결제 서비스 저장소를 물었는데 코치 저장소의 PR 을 섞어 돌려주는 잘못된 리더
    const reader: GitHubReader = {
      ...inner,
      listRepositories: () => inner.listRepositories(),
      listPullRequests: async (repository) => {
        const prs = await inner.listPullRequests(repository);
        return repository.id !== DEMO_REPO.payments
          ? prs
          : [...prs, demoPr({ repoId: DEMO_REPO.coachWeb, number: 77, title: "섞여 온 PR", body: "studio-work-a1b2c3", branch: "x" })];
      },
    };

    const result = await syncAll({ ...deps, reader });

    expect(result.discarded).toEqual([{ requestedRepoId: DEMO_REPO.payments, repoId: DEMO_REPO.coachWeb, number: 77 }]);
    expect(await deps.store.getSnapshot(ref(DEMO_REPO.coachWeb, 77))).toBeUndefined();
    expect(await deps.store.getLink(ref(DEMO_REPO.coachWeb, 77))).toBeUndefined();
    expect((await getWorkDetail(deps, "a1b2c3"))?.prs.map((p) => p.key)).not.toContain(prKey(ref(DEMO_REPO.coachWeb, 77)));
  });
});

/** 시험용 PR 스냅샷. 필요한 칸만 받고 나머지는 평범한 값으로 채운다. */
function demoPr(fields: Pick<PrSnapshot, "repoId" | "number" | "title" | "body" | "branch"> & Partial<PrSnapshot>): PrSnapshot {
  return {
    headRepoId: fields.repoId, // 따로 적지 않으면 그 저장소 자신의 브랜치
    headSha: "e".repeat(40),
    url: `https://github.com/demo-org/x/pull/${fields.number}`,
    author: "tester",
    state: "open",
    checks: "none",
    review: "none",
    updatedAt: "2026-09-24T00:00:00.000Z",
    ...fields,
  };
}

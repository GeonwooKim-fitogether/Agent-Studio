/**
 * New Work (feature-plan F5) — 빈 업무(Draft)를 만들고 표식을 준다. 통과 기준: 그 표식을 넣은 PR 이 다음 Sync 에서 그 업무에
 * 자동으로 붙고, 표식이 없는 PR 은 Inbox 로 간다. 고정 데이터로는 PR 을 새로 만들 수 없으므로, 시험이 고정 데이터 리더에
 * 새 PR 을 더해 "GitHub 에 PR 이 새로 올라왔다" 를 흉내 낸다.
 */
import { describe, expect, it } from "vitest";
import { DEMO_FORK_REPO, DEMO_REPO } from "../../src/adapters/github/fixture/demo-scenario";
import { createEmptyWork } from "../../src/application/new-work";
import { getInbox, getWorkDetail, getWorkspace } from "../../src/application/queries";
import { syncAll } from "../../src/application/sync";
import type { PrSnapshot } from "../../src/domain/model";
import { checkWorkTitle, MAX_WORK_TITLE_LENGTH } from "../../src/domain/work-title";
import { setup } from "./helpers";

function newPr(fields: Partial<PrSnapshot> & Pick<PrSnapshot, "repoId" | "number">): PrSnapshot {
  return {
    title: "새 PR",
    body: "",
    branch: `feat/new-${fields.number}`,
    headRepoId: fields.repoId,
    headSha: "f".repeat(40),
    url: `https://github.com/demo-org/x/pull/${fields.number}`,
    author: "claude-cloud",
    state: "open",
    checks: "pending",
    review: "none",
    updatedAt: "2026-09-25T01:00:00.000Z",
    ...fields,
  };
}

describe("업무 제목의 규칙", () => {
  it("앞뒤 공백을 떼고 받는다. 한국어 · 이모지(결합자 포함)는 받는다", () => {
    expect(checkWorkTitle("  관리자 목록 검색 필터 \n")).toEqual({ ok: true, title: "관리자 목록 검색 필터" });
    expect(checkWorkTitle("팀 👩‍💻 온보딩")).toEqual({ ok: true, title: "팀 👩‍💻 온보딩" });
  });

  it("비었거나 공백뿐이면 empty", () => {
    expect(checkWorkTitle("")).toEqual({ ok: false, problem: "empty" });
    expect(checkWorkTitle(" \t\n ")).toEqual({ ok: false, problem: "empty" });
  });

  it(`${MAX_WORK_TITLE_LENGTH}글자(코드 포인트)까지 받고, 넘으면 too_long`, () => {
    expect(checkWorkTitle("가".repeat(MAX_WORK_TITLE_LENGTH)).ok).toBe(true);
    expect(checkWorkTitle("😀".repeat(MAX_WORK_TITLE_LENGTH)).ok).toBe(true); // 글자 수로 센다(UTF-16 단위가 아니다)
    expect(checkWorkTitle("가".repeat(MAX_WORK_TITLE_LENGTH + 1))).toEqual({ ok: false, problem: "too_long" });
  });

  it("안쪽의 줄바꿈 · 탭 · NUL · 줄 구분자 · 방향 제어 문자는 control_char", () => {
    for (const bad of ["로그인\n화면", "로그인\t화면", "a\u0000b", "a\u007fb", "a\u2028b", "a\u202Eb", "a\u2066b"]) {
      expect(checkWorkTitle(bad)).toEqual({ ok: false, problem: "control_char" });
    }
  });
});

describe("빈 업무 만들기", () => {
  it("존재하는 프로젝트에 Draft 업무를 만들고, 기존 발급 방식의 ID 와 그 표식을 돌려준다. PR 은 붙지 않는다", async () => {
    const { deps, readerCalls } = setup();
    await syncAll(deps);
    const calls = readerCalls.length;
    const result = await createEmptyWork(deps, { projectId: "coach", title: "  코치 목록 검색 필터 " });
    expect(result).toEqual({
      ok: true,
      work: { id: "n00001", projectId: "coach", title: "코치 목록 검색 필터", status: "draft", createdAt: "2026-09-25T00:00:00.000Z" },
      marker: "studio-work-n00001",
    });
    const detail = await getWorkDetail(deps, "n00001");
    expect(detail?.marker).toBe("studio-work-n00001");
    expect(detail?.prs).toEqual([]);
    expect(readerCalls.length).toBe(calls); // GitHub 에는 묻지도 보내지도 않는다
  });

  it("제목이 규칙에 맞지 않거나 프로젝트가 없으면 아무것도 만들지 않고 이유를 돌려준다", async () => {
    const { deps } = setup();
    await syncAll(deps);
    const before = (await deps.store.listWorks()).length;
    expect(await createEmptyWork(deps, { projectId: "coach", title: "   " })).toEqual({ ok: false, problem: "empty" });
    expect(await createEmptyWork(deps, { projectId: "coach", title: "a\nb" })).toEqual({ ok: false, problem: "control_char" });
    expect(await createEmptyWork(deps, { projectId: "coach", title: "x".repeat(201) })).toEqual({ ok: false, problem: "too_long" });
    expect(await createEmptyWork(deps, { projectId: "nope", title: "업무" })).toEqual({ ok: false, problem: "no_project" });
    expect(await createEmptyWork(deps, { projectId: "", title: "업무" })).toEqual({ ok: false, problem: "no_project" });
    expect((await deps.store.listWorks()).length).toBe(before);
  });

  it("이미 쓰인 ID 가 나오면 다음 ID 를 쓴다 (Inbox 의 New Work 와 같은 발급)", async () => {
    const { deps } = setup();
    const ids = ["a1b2c3", "BAD-ID", "z9"];
    const issuing = { ...deps, newId: () => ids.shift() ?? "never" };
    const result = await createEmptyWork(issuing, { projectId: "coach", title: "업무" });
    expect(result.ok && result.work.id).toBe("z9");
  });
});

describe("표식을 넣은 PR 은 다음 Sync 에서 그 업무에 붙는다 (통과 기준)", () => {
  it("본문이나 브랜치 이름에 표식이 든 PR 은 자동 연결되고(업무는 R1 로 진행 중), 표식이 없는 PR 은 Inbox 에 남는다", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    const result = await createEmptyWork(deps, { projectId: "coach", title: "코치 목록 검색 필터" });
    if (!result.ok) throw new Error("업무를 만들지 못했다");
    const { work, marker } = result;
    const inboxBefore = (await getWorkspace(deps)).inboxCount;

    // GitHub 에 PR 셋이 새로 올라왔다: 본문에 표식, 브랜치 이름에 표식, 표식 없음
    data.pullRequests.push(
      newPr({ repoId: DEMO_REPO.coachWeb, number: 40, body: `작업 지시: ${marker} 를 따른다.` }),
      newPr({ repoId: DEMO_REPO.coachWeb, number: 41, branch: `claude/${marker}-filter` }),
      newPr({ repoId: DEMO_REPO.coachWeb, number: 42, body: "표식 없이 올린 PR" }),
    );
    await syncAll(deps);

    const detail = await getWorkDetail(deps, work.id);
    expect(detail?.prs.map((p) => [p.number, p.studio.linkOrigin, p.studio.markerFoundIn])).toEqual([
      [40, "marker", ["body"]],
      [41, "marker", ["branch"]],
    ]);
    expect(detail?.work.status).toBe("in_progress");
    expect(detail?.latestChange?.cause).toMatchObject({ kind: "rule", rule: "R1" });

    const inbox = await getInbox(deps);
    const coach = inbox.groups.find((g) => g.project.id === "coach");
    expect(coach?.items.map((i) => [i.pr.number, i.reason])).toContainEqual([42, "no_marker"]);
    expect(inbox.total).toBe(inboxBefore + 1);
  });

  it("다른 프로젝트 저장소의 PR 이나 복제본의 PR 에 그 표식이 있으면 붙지 않고 Inbox 로 간다 (계약 §4, 결정 10)", async () => {
    const { data, deps } = setup();
    await syncAll(deps);
    const result = await createEmptyWork(deps, { projectId: "coach", title: "코치 목록 검색 필터" });
    if (!result.ok) throw new Error("업무를 만들지 못했다");
    data.pullRequests.push(
      newPr({ repoId: DEMO_REPO.playerApp, number: 50, body: result.marker }),
      newPr({ repoId: DEMO_REPO.coachWeb, number: 51, body: result.marker, headRepoId: DEMO_FORK_REPO }),
    );
    await syncAll(deps);
    expect((await getWorkDetail(deps, result.work.id))?.prs).toEqual([]);
    const reasons = (await getInbox(deps)).groups.flatMap((g) => g.items).filter((i) => i.pr.number >= 50);
    expect(reasons.map((i) => [i.pr.number, i.reason])).toEqual([
      [51, "fork_head"],
      [50, "other_project"],
    ]);
  });
});

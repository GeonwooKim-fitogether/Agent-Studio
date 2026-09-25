/** 도메인 규칙 하나하나 — 표식 판정, 자동 연결 판정, 신선도, PR 식별. */
import { describe, expect, it } from "vitest";
import { decideLink } from "../../src/domain/auto-link";
import { freshnessOf } from "../../src/domain/freshness";
import { prKey, samePr, type Work } from "../../src/domain/model";
import { findMarkedWorkIds, isValidWorkId, markerFor } from "../../src/domain/work-marker";

describe("업무 표식", () => {
  it("표식 형식은 studio-work-<업무 ID> 이고, 업무 ID 는 영문 소문자와 숫자뿐이다", () => {
    expect(markerFor("8f2a1c")).toBe("studio-work-8f2a1c");
    expect(isValidWorkId("8f2a1c")).toBe(true);
    for (const bad of ["", "8F2A1C", "8f2a:1c", "8f-2a", "8f 2a"]) expect(isValidWorkId(bad)).toBe(false);
  });

  it("본문과 브랜치 이름에서 표식을 찾는다 — 하이픈 · 슬래시 · 공백 · 줄바꿈에서 끊긴다", () => {
    expect(findMarkedWorkIds("업무 표식: studio-work-a1b2c3\n본문")).toEqual(["a1b2c3"]);
    expect(findMarkedWorkIds("feat/studio-work-a1b2c3-login")).toEqual(["a1b2c3"]);
    expect(findMarkedWorkIds("studio-work-a1b2c3")).toEqual(["a1b2c3"]);
    expect(findMarkedWorkIds("(studio-work-a1b2c3).")).toEqual(["a1b2c3"]);
  });

  it("같은 표식이 본문과 브랜치 이름에 둘 다 있으면 하나로 센다", () => {
    expect(findMarkedWorkIds("studio-work-a1 과 studio-work-a1", "fix/studio-work-a1")).toEqual(["a1"]);
  });

  it("다른 낱말의 일부이거나 형식이 다른 것은 표식으로 보지 않는다", () => {
    expect(findMarkedWorkIds("xstudio-work-a1b2c3")).toEqual([]);
    expect(findMarkedWorkIds("studio-work-a1b2c3D")).toEqual([]);
    expect(findMarkedWorkIds("Studio-Work-a1b2c3")).toEqual([]);
    expect(findMarkedWorkIds("studio:work-a1b2c3")).toEqual([]); // 계약 초안의 옛 형식
    expect(findMarkedWorkIds("studio-work-")).toEqual([]);
  });

  it.each([
    ["studio-work-abc123_v2", "뒤에 밑줄"],
    ["_studio-work-abc123", "앞에 밑줄"],
    ["studio-work-abc123é", "뒤에 유니코드 글자 (é 한 글자)"],
    ["studio-work-abc123e\u0301", "뒤에 결합 부호 (e + ´)"],
    ["studio-work-abc123\u0301", "업무 ID 바로 뒤에 결합 부호"],
    ["studio-work-abc123에서", "뒤에 띄어 쓰지 않은 한국어 조사"],
    ["한글studio-work-abc123", "앞에 한국어 글자"],
    ["studio-work-abc123٣", "뒤에 다른 문자권의 숫자"],
    ["studio-work-abc123x", "뒤에 영문자 — abc123 이 아니라 abc123x 한 덩어리"],
  ])("단어 문자에 붙은 것은 abc123 의 표식이 아니다: %s (%s)", (text) => {
    expect(findMarkedWorkIds(text)).not.toContain("abc123");
  });

  it.each([
    ["studio-work-abc123-v2", "하이픈"],
    ["feat/studio-work-abc123", "슬래시"],
    ["업무 studio-work-abc123 에서", "공백"],
    ["studio-work-abc123.", "마침표"],
    ["(studio-work-abc123)", "괄호"],
    ["첫 줄\nstudio-work-abc123\n다음 줄", "줄바꿈"],
    ["studio-work-abc123", "글의 처음과 끝"],
  ])("경계에서 끊긴 것은 abc123 의 표식이다: %s (%s)", (text) => {
    expect(findMarkedWorkIds(text)).toEqual(["abc123"]);
  });
});

describe("자동 연결 판정", () => {
  const works: Work[] = [
    { id: "aaa111", projectId: "p1", title: "업무 A", status: "draft", createdAt: "2026-09-01T00:00:00Z" },
    { id: "bbb222", projectId: "p1", title: "업무 B", status: "draft", createdAt: "2026-09-01T00:00:00Z" },
    { id: "ccc333", projectId: "p2", title: "다른 프로젝트 업무", status: "draft", createdAt: "2026-09-01T00:00:00Z" },
  ];
  const own = { repoId: 1, headRepoId: 1 }; // 브랜치가 그 저장소 자신에 있는 PR
  const fresh = { unlinkedByUser: false };
  const decide = (body: string, branch = "feat/x") => decideLink({ ...own, body, branch }, "p1", works, fresh);

  it("같은 프로젝트 업무의 표식이 정확히 하나면 자동 연결한다", () => {
    expect(decide("studio-work-aaa111")).toEqual({ kind: "auto", workId: "aaa111", foundIn: ["body"] });
    expect(decide("", "feat/studio-work-bbb222")).toEqual({ kind: "auto", workId: "bbb222", foundIn: ["branch"] });
    expect(decide("studio-work-aaa111", "feat/studio-work-aaa111")).toEqual({
      kind: "auto",
      workId: "aaa111",
      foundIn: ["body", "branch"],
    });
  });

  it("그 밖의 모든 경우는 이유와 함께 Inbox 로 보낸다", () => {
    expect(decide("로그인 화면을 고쳤다")).toMatchObject({ kind: "inbox", reason: "no_marker" });
    expect(decide("studio-work-zzz999")).toMatchObject({ kind: "inbox", reason: "unknown_work" });
    expect(decide("studio-work-ccc333")).toMatchObject({ kind: "inbox", reason: "other_project" });
    expect(decide("studio-work-aaa111", "feat/studio-work-bbb222")).toMatchObject({
      kind: "inbox",
      reason: "multiple_markers",
      markedWorkIds: ["aaa111", "bbb222"],
    });
  });

  it("제목이 업무 제목과 같아도 표식이 없으면 붙이지 않는다 (추정 근거를 쓰지 않는다)", () => {
    // 실제 PR 스냅샷처럼 제목이 들어 있는 값을 그대로 넘긴다. 규칙이 제목을 보기 시작하면 이 시험이 깨진다.
    const pr = { ...own, title: "업무 A", body: "업무 A", branch: "업무-A" };
    expect(decideLink(pr, "p1", works, fresh)).toMatchObject({ kind: "inbox", reason: "no_marker" });
  });

  it("제목에만 든 표식은 보지 않는다", () => {
    const pr = { ...own, title: "studio-work-aaa111 로그인", body: "", branch: "feat/x" };
    expect(decideLink(pr, "p1", works, fresh)).toMatchObject({ kind: "inbox", reason: "no_marker" });
  });

  it("복제본(fork)의 브랜치에서 온 PR 은 같은 프로젝트 업무의 표식이 있어도 Inbox 로 간다 (결정 10)", () => {
    const pr = { repoId: 1, headRepoId: 2, body: "studio-work-aaa111", branch: "feat/studio-work-aaa111" };
    expect(decideLink(pr, "p1", works, fresh)).toEqual({ kind: "inbox", reason: "fork_head", markedWorkIds: ["aaa111"] });
  });

  it("브랜치가 어느 저장소에 있는지 알 수 없으면(삭제된 복제본) 복제본으로 보고 Inbox 로 간다 (결정 10)", () => {
    const pr = { repoId: 1, headRepoId: null, body: "studio-work-aaa111", branch: "feat/x" };
    expect(decideLink(pr, "p1", works, fresh)).toMatchObject({ kind: "inbox", reason: "unknown_head" });
  });

  it("사람이 연결을 푼 PR 은 표식이 있어도 Inbox 로 간다 (결정 9)", () => {
    const pr = { ...own, body: "studio-work-aaa111", branch: "feat/x" };
    expect(decideLink(pr, "p1", works, { unlinkedByUser: true })).toEqual({
      kind: "inbox",
      reason: "unlinked_by_user",
      markedWorkIds: ["aaa111"],
    });
    expect(decideLink(pr, "p1", works, fresh)).toMatchObject({ kind: "auto", workId: "aaa111" }); // 대조: 기록이 없으면 자동
  });

  it("studio-work-aaa111x 는 aaa111 에 붙지 않는다", () => {
    expect(decide("studio-work-aaa111x")).toMatchObject({ kind: "inbox", reason: "unknown_work", markedWorkIds: ["aaa111x"] });
  });
});

describe("신선도와 식별", () => {
  it("커밋 SHA 가 PR 의 최신 커밋과 같으면 current, 다르면 outdated", () => {
    expect(freshnessOf({ commitSha: "abc" }, "abc")).toBe("current");
    expect(freshnessOf({ commitSha: "abc" }, "def")).toBe("outdated");
  });

  it("SHA 는 전체로 비교한다 — 앞 7자만 같으면 다른 커밋이다", () => {
    const head = "3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d";
    const lookalike = "3c4d5e6000000000000000000000000000000000";
    expect(lookalike.slice(0, 7)).toBe(head.slice(0, 7));
    expect(freshnessOf({ commitSha: lookalike }, head)).toBe("outdated");
    expect(freshnessOf({ commitSha: head }, head)).toBe("current");
  });

  it("PR 은 (저장소 숫자 ID, 번호) 로만 같다", () => {
    expect(prKey({ repoId: 1, number: 12 })).not.toBe(prKey({ repoId: 2, number: 12 }));
    expect(samePr({ repoId: 1, number: 12 }, { repoId: 1, number: 12 })).toBe(true);
    expect(samePr({ repoId: 1, number: 12 }, { repoId: 2, number: 12 })).toBe(false);
  });
});

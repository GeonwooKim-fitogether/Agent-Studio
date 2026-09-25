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
});

describe("자동 연결 판정", () => {
  const works: Work[] = [
    { id: "aaa111", projectId: "p1", title: "업무 A", status: "draft", createdAt: "2026-09-01T00:00:00Z" },
    { id: "bbb222", projectId: "p1", title: "업무 B", status: "draft", createdAt: "2026-09-01T00:00:00Z" },
    { id: "ccc333", projectId: "p2", title: "다른 프로젝트 업무", status: "draft", createdAt: "2026-09-01T00:00:00Z" },
  ];
  const decide = (body: string, branch = "feat/x") => decideLink({ body, branch }, "p1", works);

  it("같은 프로젝트 업무의 표식이 정확히 하나면 자동 연결한다", () => {
    expect(decide("studio-work-aaa111")).toEqual({ kind: "auto", workId: "aaa111" });
    expect(decide("", "feat/studio-work-bbb222")).toEqual({ kind: "auto", workId: "bbb222" });
    expect(decide("studio-work-aaa111", "feat/studio-work-aaa111")).toEqual({ kind: "auto", workId: "aaa111" });
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
    expect(decideLink({ body: "업무 A", branch: "업무-A" }, "p1", works)).toMatchObject({ kind: "inbox", reason: "no_marker" });
  });
});

describe("신선도와 식별", () => {
  it("커밋 SHA 가 PR 의 최신 커밋과 같으면 current, 다르면 outdated", () => {
    expect(freshnessOf({ commitSha: "abc" }, "abc")).toBe("current");
    expect(freshnessOf({ commitSha: "abc" }, "def")).toBe("outdated");
  });

  it("PR 은 (저장소 숫자 ID, 번호) 로만 같다", () => {
    expect(prKey({ repoId: 1, number: 12 })).not.toBe(prKey({ repoId: 2, number: 12 }));
    expect(samePr({ repoId: 1, number: 12 }, { repoId: 1, number: 12 })).toBe(true);
    expect(samePr({ repoId: 1, number: 12 }, { repoId: 2, number: 12 })).toBe(false);
  });
});

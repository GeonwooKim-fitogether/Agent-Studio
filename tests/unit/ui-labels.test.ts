/** 화면 라벨 — GitHub 와 Studio 의 표기가 겹치지 않는지, 연결 표기 · 사유 · 한국 시간이 맞는지. */
import { describe, expect, it } from "vitest";
import {
  formatKst,
  GITHUB_REVIEW,
  inboxReasonText,
  linkLabel,
  NO_INTERNAL_REVIEW,
  STATE_LEGEND,
  VERDICT,
} from "../../src/app/components/labels";

describe("화면 라벨", () => {
  it("Studio 의 내부 검토 표기는 모두 Internal: 로 시작하고, GitHub 리뷰 표기와 하나도 겹치지 않는다", () => {
    const studio = [...Object.values(VERDICT), NO_INTERNAL_REVIEW];
    for (const label of studio) expect(label.startsWith("Internal:")).toBe(true);
    for (const label of Object.values(GITHUB_REVIEW)) expect(studio).not.toContain(label);
    expect(VERDICT.changes_requested).not.toBe(GITHUB_REVIEW.changes_requested);
  });

  it("범례는 GitHub 줄과 Studio 줄이 누구의 것인지, Studio 기록이 GitHub 에 반영되지 않는다는 것을 말한다", () => {
    expect(STATE_LEGEND).toContain("GitHub 줄은 GitHub 가 알려 준 상태");
    expect(STATE_LEGEND).toContain("GitHub 에 반영되지 않는다");
  });

  it("연결 표기: 사람이 연결하면 Linked manually, 표식이면 표식을 찾은 자리를 함께", () => {
    expect(linkLabel("user", [])).toBe("Linked manually");
    expect(linkLabel("marker", ["body"])).toBe("Linked by marker (body)");
    expect(linkLabel("marker", ["branch"])).toBe("Linked by marker (branch)");
    expect(linkLabel("marker", ["body", "branch"])).toBe("Linked by marker (body, branch)");
    expect(linkLabel(null, [])).toBe("Not linked");
  });

  it("다른 프로젝트의 표식이라는 사유에는 그 프로젝트 이름이 들어간다", () => {
    expect(inboxReasonText("other_project", ["a1b2c3"], "결제 서비스")).toBe(
      "표식 studio-work-a1b2c3 는 다른 프로젝트('결제 서비스')의 업무를 가리킨다.",
    );
  });

  it("마지막 동기화 시각은 한국 시간(KST)으로 보인다", () => {
    expect(formatKst("2026-09-25T05:19:08.000Z")).toBe("2026-09-25 14:19:08 KST");
    expect(formatKst("2026-09-25T20:00:00.000Z")).toBe("2026-09-26 05:00:00 KST"); // 날짜가 넘어간다
  });
});

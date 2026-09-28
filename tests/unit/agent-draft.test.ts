/**
 * Agent 초안의 칸 규칙과 유스케이스 (결정 20, src/domain/agent-draft.ts · src/application/agents.ts).
 * 저장만 되고 아무것도 실행하지 않는다 — 모델 칸이 없다는 것도 여기서 못 박는다.
 */
import { describe, expect, it } from "vitest";
import { demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { addAgent, saveAgent } from "../../src/application/agents";
import { checkAgentDraft, isAcceptedAgentDraft, MAX_AGENT_INSTRUCTIONS_LENGTH } from "../../src/domain/agent-draft";
import { setup } from "./helpers";

const base = { name: "Planner", summary: "", instructions: "", skills: [] as string[] };
const TAB = String.fromCharCode(9);
const LINE_SEPARATOR = String.fromCharCode(0x2028);
const BIDI = String.fromCharCode(0x202e);

describe("checkAgentDraft — 칸마다 받는 글", () => {
  it("앞뒤 공백을 떼고, 줄바꿈을 맞추고, Skill 을 정해진 순서로 받는다", () => {
    const got = checkAgentDraft({ name: "  Builder ", summary: " 소개 ", instructions: "\r\n한 줄\r둘째 줄\n", skills: ["code_review", "read_context", "code_review"] });
    expect(got).toEqual({ ok: true, fields: { name: "Builder", summary: "소개", instructions: "한 줄\n둘째 줄", skills: ["read_context", "code_review"] } });
  });

  it("소개 · 지시문 · Skill 은 비어도 된다. 이름만은 필요하다", () => {
    expect(checkAgentDraft(base).ok).toBe(true);
    expect(checkAgentDraft({ ...base, name: "   " })).toEqual({ ok: false, problems: { name: "empty" } });
  });

  it("길이: 이름 40 · 소개 120 · 지시문 4000 글자(코드 포인트)까지", () => {
    expect(checkAgentDraft({ ...base, name: "가".repeat(40) }).ok).toBe(true);
    expect(checkAgentDraft({ ...base, name: "😀".repeat(40) }).ok).toBe(true); // 코드 포인트로 센다
    expect(checkAgentDraft({ ...base, name: "가".repeat(41) })).toEqual({ ok: false, problems: { name: "too_long" } });
    expect(checkAgentDraft({ ...base, summary: "가".repeat(121) })).toEqual({ ok: false, problems: { summary: "too_long" } });
    expect(checkAgentDraft({ ...base, instructions: "가".repeat(MAX_AGENT_INSTRUCTIONS_LENGTH) }).ok).toBe(true);
    expect(checkAgentDraft({ ...base, instructions: "가".repeat(MAX_AGENT_INSTRUCTIONS_LENGTH + 1) })).toEqual({ ok: false, problems: { instructions: "too_long" } });
  });

  it("이름 · 소개는 한 줄이다(줄바꿈 · 탭 · 방향 제어 문자 없음). 지시문은 줄바꿈만 받는다", () => {
    expect(checkAgentDraft({ ...base, name: "A\nB" })).toEqual({ ok: false, problems: { name: "control_char" } });
    expect(checkAgentDraft({ ...base, summary: `소개${BIDI}` })).toEqual({ ok: false, problems: { summary: "control_char" } });
    expect(checkAgentDraft({ ...base, instructions: `가${TAB}나` })).toEqual({ ok: false, problems: { instructions: "control_char" } });
    expect(checkAgentDraft({ ...base, instructions: `가${LINE_SEPARATOR}나` })).toEqual({ ok: false, problems: { instructions: "control_char" } });
  });

  it("정의되지 않은 Skill 은 받지 않는다 — 새 Skill 을 정의하는 기능은 없다", () => {
    expect(checkAgentDraft({ ...base, skills: ["deploy"] })).toEqual({ ok: false, problems: { skills: "unknown_skill" } });
  });

  it("여러 칸이 걸리면 칸마다 이유를 함께 준다", () => {
    expect(checkAgentDraft({ name: "", summary: "가".repeat(121), instructions: "", skills: ["x"] })).toEqual({
      ok: false,
      problems: { name: "empty", summary: "too_long", skills: "unknown_skill" },
    });
  });

  it("저장소는 맞춰진 모양만 받는다 — 앞뒤 공백 · 순서가 틀린 Skill · 모양 밖의 ID 는 거절", () => {
    const ok = { id: "builder", name: "Builder", summary: "", instructions: "", skills: ["read_context", "code_review"] as const };
    expect(isAcceptedAgentDraft(ok)).toBe(true);
    expect(isAcceptedAgentDraft({ ...ok, name: " Builder" })).toBe(false);
    expect(isAcceptedAgentDraft({ ...ok, skills: ["code_review", "read_context"] })).toBe(false);
    expect(isAcceptedAgentDraft({ ...ok, id: "Builder" })).toBe(false);
    expect(isAcceptedAgentDraft({ ...ok, id: "" })).toBe(false);
  });
});

describe("Add Agent · Save draft (유스케이스)", () => {
  it("Add Agent 는 이름만 받아 빈 초안을 만들고, Save draft 가 네 칸을 고친다. 만든 시각은 그대로다", async () => {
    let clock = new Date("2026-09-28T00:00:00.000Z");
    const { deps } = setup({ seed: demoStudioSeed() });
    const d = { ...deps, now: () => clock, newId: () => "abc123" };
    const added = await addAgent(d, { name: " Tester " });
    expect(added).toMatchObject({ ok: true, agent: { id: "abc123", name: "Tester", summary: "", instructions: "", skills: [] } });
    clock = new Date("2026-09-28T01:00:00.000Z");
    const saved = await saveAgent(d, { id: "abc123", name: "Tester", summary: "시험을 돌린다.", instructions: "시험을 먼저 쓴다.", skills: ["code_review"] });
    expect(saved).toMatchObject({ ok: true, agent: { summary: "시험을 돌린다.", skills: ["code_review"], createdAt: "2026-09-28T00:00:00.000Z", updatedAt: "2026-09-28T01:00:00.000Z" } });
    expect((await d.store.listAgentDrafts()).map((a) => a.name)).toEqual(["Planner", "Builder", "Reviewer", "Tester"]);
    expect(Object.keys((await d.store.getAgentDraft("abc123"))!)).not.toContain("model"); // 모델 칸은 저장하지 않는다
  });

  it("규칙에 걸리면 아무것도 쓰지 않고 칸마다의 이유를 돌려준다. 없는 초안이면 missing", async () => {
    const { deps } = setup({ seed: demoStudioSeed() });
    expect(await addAgent(deps, { name: "" })).toEqual({ ok: false, problems: { name: "empty" } });
    expect(await saveAgent(deps, { id: "planner", name: "", summary: "", instructions: "", skills: [] })).toEqual({ ok: false, problems: { name: "empty" } });
    expect((await deps.store.getAgentDraft("planner"))?.name).toBe("Planner");
    expect(await saveAgent(deps, { id: "nobody", name: "X", summary: "", instructions: "", skills: [] })).toEqual({ ok: false, missing: true });
    expect(await deps.store.listAgentDrafts()).toHaveLength(3);
  });
});

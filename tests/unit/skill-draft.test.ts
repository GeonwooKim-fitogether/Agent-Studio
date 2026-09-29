/**
 * Skill 의 칸 규칙과 유스케이스 (결정 21, src/domain/skill-draft.ts · src/application/skills.ts).
 * 기본 Skill 둘은 고정 · 읽기 전용이고, 사용자 Skill 은 초안으로 저장된다. Used by 는 저장하지 않고 Agent 초안에서 거꾸로 계산한다.
 * Agent 초안이 고를 수 있는 Skill 은 "기본 Skill + 존재하는 사용자 Skill" 이다.
 */
import { describe, expect, it } from "vitest";
import { demoStudioSeed } from "../../src/adapters/github/fixture/demo-scenario";
import { saveAgent } from "../../src/application/agents";
import { addSkill, saveSkill } from "../../src/application/skills";
import { checkAgentDraft, isAcceptedAgentDraft } from "../../src/domain/agent-draft";
import {
  allSkills,
  BUILT_IN_SKILLS,
  checkSkillDraft,
  isAcceptedSkillDraft,
  newSkillName,
  type SkillDraft,
  skillIdOrder,
  usedBy,
} from "../../src/domain/skill-draft";
import { setup } from "./helpers";

const base = { name: "Release notes", summary: "", instructions: "" };
const TAB = String.fromCharCode(9);
const skill = (id: string, name: string, createdAt: string): SkillDraft => ({ id, name, summary: "", instructions: "", createdAt, updatedAt: createdAt });

describe("기본 Skill", () => {
  it("둘이고 이름 · 소개 · 지시문이 시안 문구다", () => {
    expect(BUILT_IN_SKILLS.map((s) => [s.id, s.name, s.summary])).toEqual([
      ["read_context", "Read context", "목표 · 대화 · PR 을 먼저 읽는다."],
      ["code_review", "Code review", "최신 커밋을 읽고 빠진 것을 적는다."],
    ]);
    expect(BUILT_IN_SKILLS[0]!.instructions.split("\n")).toHaveLength(3);
  });
});

describe("checkSkillDraft — 칸마다 받는 글 (Agent 초안과 같은 방식)", () => {
  it("앞뒤 공백을 떼고 줄바꿈을 맞춘다. 소개 · 지시문은 비어도 된다", () => {
    expect(checkSkillDraft({ name: "  Release notes ", summary: " 소개 ", instructions: "\r\n한 줄\r둘째 줄\n" })).toEqual({
      ok: true,
      fields: { name: "Release notes", summary: "소개", instructions: "한 줄\n둘째 줄" },
    });
    expect(checkSkillDraft({ ...base, name: "   " })).toEqual({ ok: false, problems: { name: "empty" } });
  });

  it("길이 · 제어 문자: 이름 40 · 소개 120 · 지시문 4000, 한 줄 칸에 줄바꿈 없음, 지시문은 줄바꿈만", () => {
    expect(checkSkillDraft({ ...base, name: "가".repeat(40) }).ok).toBe(true);
    expect(checkSkillDraft({ ...base, name: "가".repeat(41) })).toEqual({ ok: false, problems: { name: "too_long" } });
    expect(checkSkillDraft({ ...base, summary: "가".repeat(121) })).toEqual({ ok: false, problems: { summary: "too_long" } });
    expect(checkSkillDraft({ ...base, instructions: "가".repeat(4001) })).toEqual({ ok: false, problems: { instructions: "too_long" } });
    expect(checkSkillDraft({ ...base, name: "A\nB" })).toEqual({ ok: false, problems: { name: "control_char" } });
    expect(checkSkillDraft({ ...base, instructions: `가${TAB}나` })).toEqual({ ok: false, problems: { instructions: "control_char" } });
  });

  it("기본 Skill 이나 다른 초안과 같은 이름(대소문자 · 앞뒤 공백 무시)은 duplicate", () => {
    expect(checkSkillDraft({ ...base, name: " read CONTEXT " })).toEqual({ ok: false, problems: { name: "duplicate" } });
    expect(checkSkillDraft({ ...base, name: "release NOTES" }, [{ name: "Release notes" }])).toEqual({ ok: false, problems: { name: "duplicate" } });
    expect(checkSkillDraft({ ...base, name: "Release notes 2" }, [{ name: "Release notes" }]).ok).toBe(true);
  });

  it("저장소는 맞춰진 모양만 받는다 — 앞뒤 공백 · 모양 밖의 ID(대문자 · 밑줄 · 기본 Skill id) 는 거절", () => {
    const ok = { id: "release-notes", ...base };
    expect(isAcceptedSkillDraft(ok)).toBe(true);
    expect(isAcceptedSkillDraft({ ...ok, name: " Release notes" })).toBe(false);
    expect(isAcceptedSkillDraft({ ...ok, id: "Release" })).toBe(false);
    expect(isAcceptedSkillDraft({ ...ok, id: "read_context" })).toBe(false);
    expect(isAcceptedSkillDraft({ ...ok, id: "-x" })).toBe(false);
  });
});

describe("순서 · 허용 목록 · Used by", () => {
  const later = skill("bbb", "Later", "2026-09-29T02:00:00.000Z");
  const earlier = skill("zzz", "Earlier", "2026-09-29T01:00:00.000Z");

  it("목록 순서는 기본 Skill 먼저, 그다음 사용자 Skill 을 만든 순서(같은 시각이면 ID 순)", () => {
    expect(allSkills([later, earlier]).map((k) => [k.id, k.builtIn])).toEqual([
      ["read_context", true],
      ["code_review", true],
      ["zzz", false],
      ["bbb", false],
    ]);
    expect(skillIdOrder([skill("b", "B", "2026-09-29T00:00:00.000Z"), skill("a", "A", "2026-09-29T00:00:00.000Z")])).toEqual(["read_context", "code_review", "a", "b"]);
  });

  it("Agent 초안의 허용 목록은 기본 Skill + 존재하는 사용자 Skill 이고, 저장 순서도 같은 규칙이다", () => {
    const agent = { name: "Planner", summary: "", instructions: "" };
    expect(checkAgentDraft({ ...agent, skills: ["bbb"] })).toEqual({ ok: false, problems: { skills: "unknown_skill" } }); // 없는 Skill
    expect(checkAgentDraft({ ...agent, skills: ["bbb", "code_review", "zzz", "read_context"] }, [later, earlier])).toEqual({
      ok: true,
      fields: { ...agent, skills: ["read_context", "code_review", "zzz", "bbb"] },
    });
    expect(isAcceptedAgentDraft({ id: "p", ...agent, skills: ["zzz", "bbb"] }, [later, earlier])).toBe(true);
    expect(isAcceptedAgentDraft({ id: "p", ...agent, skills: ["bbb", "zzz"] }, [later, earlier])).toBe(false); // 순서가 틀렸다
    expect(isAcceptedAgentDraft({ id: "p", ...agent, skills: ["zzz"] }, [])).toBe(false);
  });

  it("Used by 는 Agent 초안의 skills 에서 거꾸로 계산한다 (Agent 목록 순서 그대로)", () => {
    const agents = demoStudioSeed().agents!;
    expect(usedBy("read_context", agents).map((a) => a.name)).toEqual(["Planner", "Builder", "Reviewer"]);
    expect(usedBy("code_review", agents).map((a) => a.name)).toEqual(["Reviewer"]);
    expect(usedBy("release-notes", agents)).toEqual([]);
  });

  it("New Skill 의 이름은 새 Skill, 겹치면 새 Skill 2 · 3 …", () => {
    expect(newSkillName([])).toBe("새 Skill");
    expect(newSkillName([{ name: "새 skill" }])).toBe("새 Skill 2");
    expect(newSkillName([{ name: "새 Skill" }, { name: "새 Skill 2" }])).toBe("새 Skill 3");
  });
});

describe("New Skill · Save draft (유스케이스)", () => {
  it("New Skill 은 이름 없이 새 Skill 을 만들고, Save draft 가 세 칸을 고친다. 그 Skill 을 Agent 가 고르면 Used by 에 나온다", async () => {
    let clock = new Date("2026-09-29T00:00:00.000Z");
    const { deps } = setup({ seed: demoStudioSeed() });
    const d = { ...deps, now: () => clock };
    const first = await addSkill(d);
    const second = await addSkill(d);
    expect([first.name, second.name]).toEqual(["새 Skill", "새 Skill 2"]);
    clock = new Date("2026-09-29T01:00:00.000Z");
    const saved = await saveSkill(d, { id: first.id, name: " Changelog ", summary: "변경을 적는다.", instructions: "첫 줄\n둘째 줄" });
    expect(saved).toMatchObject({ ok: true, skill: { name: "Changelog", summary: "변경을 적는다.", createdAt: "2026-09-29T00:00:00.000Z", updatedAt: "2026-09-29T01:00:00.000Z" } });
    expect((await d.store.listSkillDrafts()).map((k) => k.name)).toEqual(["Release notes", "Changelog", "새 Skill 2"]);

    const planner = (await d.store.getAgentDraft("planner"))!;
    expect(await saveAgent(d, { ...planner, skills: [first.id, "read_context"] })).toMatchObject({ ok: true, agent: { skills: ["read_context", first.id] } });
    expect(usedBy(first.id, await d.store.listAgentDrafts()).map((a) => a.id)).toEqual(["planner"]);
  });

  it("같은 이름 · 빈 이름은 칸의 이유로 돌려주고 아무것도 쓰지 않는다. 기본 Skill · 없는 초안은 missing", async () => {
    const { deps } = setup({ seed: demoStudioSeed() });
    const k = await addSkill(deps);
    expect(await saveSkill(deps, { id: k.id, name: "RELEASE NOTES", summary: "", instructions: "" })).toEqual({ ok: false, problems: { name: "duplicate" } });
    expect(await saveSkill(deps, { id: k.id, name: "Code review", summary: "", instructions: "" })).toEqual({ ok: false, problems: { name: "duplicate" } });
    expect(await saveSkill(deps, { id: k.id, name: "", summary: "", instructions: "" })).toEqual({ ok: false, problems: { name: "empty" } });
    expect((await deps.store.getSkillDraft(k.id))?.name).toBe("새 Skill");
    expect(await saveSkill(deps, { id: "release-notes", name: "Release notes", summary: "고침", instructions: "" })).toMatchObject({ ok: true }); // 자기 이름은 겹침이 아니다
    expect(await saveSkill(deps, { id: "read_context", name: "Read context", summary: "고침", instructions: "" })).toEqual({ ok: false, missing: true });
    expect(await saveSkill(deps, { id: "nobody", name: "X", summary: "", instructions: "" })).toEqual({ ok: false, missing: true });
  });
});

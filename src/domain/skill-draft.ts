/**
 * Skill (결정 21 — Agents 화면의 Skills 탭, Demo). 여러 Agent 가 함께 쓰는 지시문 묶음이다. 순수 규칙만 있다.
 *
 * Skill 은 두 가지다.
 *   기본 Skill   코드에 고정된 둘(Read context · Code review). 읽기 전용이고 저장소에 없다
 *   사용자 Skill 사람이 Skills 탭에서 만들고 고치는 초안. Studio 가 저장한다(skill_draft 표). 지우는 기능은 없다
 * 초안은 **저장만 되고 아무것도 실행하지 않는다.** 실행이 연결되면 지시문이 Agent 의 지시문 뒤에 이어 붙을 글이다(3단계, 결정 5 · 7).
 *
 * "어느 Agent 가 쓰나"(Used by)는 따로 저장하지 않는다. Agent 초안의 skills 에서 거꾸로 계산한다(usedBy).
 *
 * 칸마다 받는 글은 Agent 초안과 같다 (앞뒤 공백은 떼고, 줄바꿈 \r\n · \r 은 \n 하나로 맞춘다):
 *   name          1 ~ MAX_SKILL_NAME_LENGTH 글자, 한 줄. 기본 Skill · 다른 초안과 같은 이름은 받지 않는다(대소문자 · 앞뒤 공백 무시)
 *   summary       0 ~ MAX_SKILL_SUMMARY_LENGTH 글자, 한 줄. 사람용 소개
 *   instructions  0 ~ MAX_SKILL_INSTRUCTIONS_LENGTH 글자. 줄바꿈은 받는다. AI 용 지시문
 * 받지 않는 이유는 칸마다 하나다: empty(이름이 빔) · too_long · control_char · duplicate(같은 이름).
 */
import type { AgentDraft } from "./agent-draft";
import { CONTROL_BUT_NEWLINE } from "./memo";

export const MAX_SKILL_NAME_LENGTH = 40;
export const MAX_SKILL_SUMMARY_LENGTH = 120;
export const MAX_SKILL_INSTRUCTIONS_LENGTH = 4000;

export interface BuiltInSkill {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly instructions: string;
}

/**
 * 기본 Skill 둘 — 코드에 고정돼 있고 고칠 수 없다. id 는 Agent 초안에 저장되는 값이다(밑줄이 있어 사용자 Skill 의 id 와 겹치지 않는다).
 * 이름은 화면에 보이는 이름이다(버튼 · 기능 이름은 영어, 결정 2).
 */
export const BUILT_IN_SKILLS: readonly BuiltInSkill[] = [
  {
    id: "read_context",
    name: "Read context",
    summary: "목표 · 대화 · PR 을 먼저 읽는다.",
    instructions:
      "작업 전에 업무의 목표와 최근 대화를 읽는다.\n연결된 PR 의 제목 · 최신 커밋 · 마지막 Studio 결정을 확인한다.\n읽은 것을 세 줄로 요약한 뒤 시작한다.",
  },
  {
    id: "code_review",
    name: "Code review",
    summary: "최신 커밋을 읽고 빠진 것을 적는다.",
    instructions: "사람이 판단할 최신 커밋의 변경만 읽는다.\n목표와 수정 기준에 비추어 빠진 것 · 위험한 것을 목록으로 적는다.\n고칠 코드를 직접 쓰지 않는다.",
  },
];

export function isBuiltInSkillId(id: unknown): boolean {
  return typeof id === "string" && BUILT_IN_SKILLS.some((s) => s.id === id);
}

export interface SkillDraft {
  /** 영문 소문자 · 숫자 · 하이픈. 시연 초안은 release-notes, 새 초안은 Studio 가 발급한 ID */
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly instructions: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 사람이 적을 수 있는 칸 */
export type SkillDraftFields = Pick<SkillDraft, "name" | "summary" | "instructions">;
export type SkillDraftField = "name" | "summary" | "instructions";
export type SkillDraftProblem = "empty" | "too_long" | "control_char" | "duplicate";
export type SkillDraftProblems = Partial<Record<SkillDraftField, SkillDraftProblem>>;

/** 화면이 한 줄로 그리는 Skill — 기본이든 사용자 것이든 같은 모양 */
export interface SkillView extends BuiltInSkill {
  readonly builtIn: boolean;
}

const SKILL_ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CONTROL_IN_LINE = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

/** 사용자 Skill 의 ID 모양. 기본 Skill 의 id(밑줄)는 여기에 맞지 않는다 */
export function isValidSkillId(id: unknown): id is string {
  return typeof id === "string" && SKILL_ID.test(id);
}

const normalize = (raw: string) => raw.replace(/\r\n?/g, "\n").trim();
const length = (text: string) => [...text].length;
const nameKey = (name: string) => normalize(name).toLowerCase();

/** 두 이름이 같은가 — 대소문자와 앞뒤 공백은 보지 않는다 */
export function sameSkillName(a: string, b: string): boolean {
  return nameKey(a) === nameKey(b);
}

function lineProblem(text: string, max: number, required: boolean): SkillDraftProblem | null {
  if (required && text === "") return "empty";
  if (CONTROL_IN_LINE.test(text)) return "control_char";
  if (length(text) > max) return "too_long";
  return null;
}

type Checked = { readonly ok: true; readonly fields: SkillDraftFields } | { readonly ok: false; readonly problems: SkillDraftProblems };

/** 칸 모양만 본다(이름이 겹치는지는 보지 않는다) */
function checkFields(input: { readonly name: string; readonly summary: string; readonly instructions: string }, others: readonly Pick<SkillDraft, "name">[] | null): Checked {
  const name = normalize(input.name);
  const summary = normalize(input.summary);
  const instructions = normalize(input.instructions);
  const problems: SkillDraftProblems = {};
  const nameProblem = lineProblem(name, MAX_SKILL_NAME_LENGTH, true);
  if (nameProblem !== null) problems.name = nameProblem;
  else if (others !== null && [...BUILT_IN_SKILLS, ...others].some((s) => sameSkillName(s.name, name))) problems.name = "duplicate";
  const summaryProblem = lineProblem(summary, MAX_SKILL_SUMMARY_LENGTH, false);
  if (summaryProblem !== null) problems.summary = summaryProblem;
  if (CONTROL_BUT_NEWLINE.test(instructions)) problems.instructions = "control_char";
  else if (length(instructions) > MAX_SKILL_INSTRUCTIONS_LENGTH) problems.instructions = "too_long";
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  return { ok: true, fields: { name, summary, instructions } };
}

/**
 * 사람이 적은 칸을 규칙에 맞춘다. others 는 이 초안을 뺀 다른 사용자 Skill 초안이다(이름이 겹치는지 본다 — 기본 Skill 은 늘 본다).
 * 통과하면 맞춘 값을, 걸리면 칸마다의 이유를 돌려준다.
 */
export function checkSkillDraft(
  input: { readonly name: string; readonly summary: string; readonly instructions: string },
  others: readonly Pick<SkillDraft, "name">[] = [],
): Checked {
  return checkFields(input, others);
}

/**
 * 저장소가 받아도 되는 초안의 모양인가 — ID 모양이 맞고, 칸이 이미 규칙대로 맞춰진 모양이어야 한다(checkSkillDraft 를 한 번 거친 값).
 * 이름이 겹치는지는 여기서 보지 않는다(저장소가 duplicate_name 으로 따로 거절한다). 두 저장 구현이 같은 답을 내도록 이 함수 하나로 판정한다.
 */
export function isAcceptedSkillDraft(draft: Pick<SkillDraft, "id" | "name" | "summary" | "instructions">): boolean {
  if (!isValidSkillId(draft.id)) return false;
  if (typeof draft.name !== "string" || typeof draft.summary !== "string" || typeof draft.instructions !== "string") return false;
  const checked = checkFields(draft, null);
  if (!checked.ok) return false;
  const f = checked.fields;
  return f.name === draft.name && f.summary === draft.summary && f.instructions === draft.instructions;
}

/** 이 이름이 기본 Skill 이나 다른 초안(같은 ID 는 뺀다)과 겹치는가 — 저장소가 쓰기 전에 본다 */
export function isDuplicateSkillName(draft: Pick<SkillDraft, "id" | "name">, drafts: readonly Pick<SkillDraft, "id" | "name">[]): boolean {
  return [...BUILT_IN_SKILLS, ...drafts.filter((d) => d.id !== draft.id)].some((s) => sameSkillName(s.name, draft.name));
}

const byCreated = (a: Pick<SkillDraft, "id" | "createdAt">, b: Pick<SkillDraft, "id" | "createdAt">) =>
  a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);

/** 목록 · 저장의 순서 — 기본 Skill 먼저, 그다음 사용자 Skill 을 만든 순서(같은 시각이면 ID 순)로 */
export function allSkills(drafts: readonly SkillDraft[]): SkillView[] {
  return [
    ...BUILT_IN_SKILLS.map((s) => ({ ...s, builtIn: true })),
    ...[...drafts].sort(byCreated).map((d) => ({ id: d.id, name: d.name, summary: d.summary, instructions: d.instructions, builtIn: false })),
  ];
}

/** Agent 가 고를 수 있는 Skill 의 id, 저장 순서대로 (기본 Skill + 존재하는 사용자 Skill) */
export function skillIdOrder(drafts: readonly Pick<SkillDraft, "id" | "createdAt">[]): string[] {
  return [...BUILT_IN_SKILLS.map((s) => s.id), ...[...drafts].sort(byCreated).map((d) => d.id)];
}

/** 이 Skill 을 고른 Agent 초안 (Used by) — Agent 초안의 skills 에서 거꾸로 계산한다. Agent 목록의 순서 그대로다 */
export function usedBy<A extends Pick<AgentDraft, "skills">>(skillId: string, agents: readonly A[]): A[] {
  return agents.filter((a) => a.skills.includes(skillId));
}

/** New Skill 이 붙이는 이름 — "새 Skill", 이미 있으면 "새 Skill 2", "새 Skill 3" … (기본 Skill · 초안의 이름과 겹치지 않게) */
export function newSkillName(drafts: readonly Pick<SkillDraft, "name">[]): string {
  const taken = [...BUILT_IN_SKILLS, ...drafts];
  for (let n = 1; ; n++) {
    const name = n === 1 ? "새 Skill" : `새 Skill ${n}`;
    if (!taken.some((s) => sameSkillName(s.name, name))) return name;
  }
}

/**
 * Agent 초안 (결정 20 — Agents 화면은 Demo). 사람이 "이 업무를 맡길 Agent" 를 적어 두는 글이다. Studio 가 소유한다.
 * 순수 규칙만 있다. 저장소 · 화면을 모른다.
 *
 * 초안은 **저장만 되고 아무것도 실행하지 않는다.** 실행 · 모델 연결은 3단계의 일이다(결정 5 · 7). 그래서 모델 칸은 저장하지 않는다 —
 * 연결 · 확인된 모델이 없는데 모델 이름을 저장하면, 저장된 글이 실제로 쓸 수 없는 것을 가리키게 된다.
 *
 * 칸마다 받는 글 (앞뒤 공백은 떼고, 줄바꿈 \r\n · \r 은 \n 하나로 맞춘다):
 *   name          1 ~ MAX_AGENT_NAME_LENGTH 글자. 한 줄이다(줄바꿈 · 제어 문자 없음). 목록에 보이는 이름이다
 *   summary       0 ~ MAX_AGENT_SUMMARY_LENGTH 글자. 한 줄이다. 사람용 소개 — 목록에 보이고 AI 에게는 가지 않는다
 *   instructions  0 ~ MAX_AGENT_INSTRUCTIONS_LENGTH 글자. 줄바꿈은 받는다. AI 용 지시문 — 실행이 연결되면 이 글이 그대로 간다
 *   skills        고를 수 있는 Skill 의 id 만, 겹치지 않게 — 기본 Skill + 존재하는 사용자 Skill (결정 21).
 *                 저장할 때는 기본 Skill 먼저, 그다음 사용자 Skill 을 만든 순서로 맞춘다(skill-draft.ts 의 skillIdOrder)
 * 받지 않는 이유는 칸마다 하나다: empty(이름이 빔) · too_long · control_char · unknown_skill.
 */
import { CONTROL_BUT_NEWLINE } from "./memo";
import { type SkillDraft, skillIdOrder } from "./skill-draft";

export const MAX_AGENT_NAME_LENGTH = 40;
export const MAX_AGENT_SUMMARY_LENGTH = 120;
export const MAX_AGENT_INSTRUCTIONS_LENGTH = 4000;

/**
 * 고를 수 있는 Skill 은 기본 Skill 둘(read_context · code_review)과 Skills 탭에서 만든 사용자 Skill 이다(결정 21 — 결정 20 의 3번을 대체).
 * 목록과 순서는 skill-draft.ts 가 정한다. 여기서는 사용자 Skill 목록(id · 만든 시각)을 받아 허용 목록을 넓힌다.
 */
export type SkillChoice = Pick<SkillDraft, "id" | "createdAt">;

export interface AgentDraft {
  /** 영문 소문자 · 숫자. 시연 초안은 planner · builder · reviewer, 새 초안은 Studio 가 발급한 ID */
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly instructions: string;
  readonly skills: readonly string[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** 사람이 적을 수 있는 칸 */
export type AgentDraftFields = Pick<AgentDraft, "name" | "summary" | "instructions" | "skills">;

export type AgentDraftField = "name" | "summary" | "instructions" | "skills";
export type AgentDraftProblem = "empty" | "too_long" | "control_char" | "unknown_skill";

/** 칸마다 걸린 이유. 걸리지 않은 칸은 빠진다 */
export type AgentDraftProblems = Partial<Record<AgentDraftField, AgentDraftProblem>>;

const AGENT_ID = /^[a-z0-9]{1,40}$/;
/** 한 줄 칸(이름 · 소개)에 들어오면 안 되는 것 — 줄바꿈까지 포함한 제어 문자 */
const CONTROL_IN_LINE = /[\p{Cc}\u2028\u2029\u202A-\u202E\u2066-\u2069]/u;

export function isValidAgentId(id: unknown): id is string {
  return typeof id === "string" && AGENT_ID.test(id);
}

const normalize = (raw: string) => raw.replace(/\r\n?/g, "\n").trim();
const length = (text: string) => [...text].length;

function lineProblem(text: string, max: number, required: boolean): AgentDraftProblem | null {
  if (required && text === "") return "empty";
  if (CONTROL_IN_LINE.test(text)) return "control_char";
  if (length(text) > max) return "too_long";
  return null;
}

/**
 * 사람이 적은 칸을 규칙에 맞춘다. 통과하면 맞춘 값(앞뒤 공백을 뗀 글, 순서를 맞춘 Skill)을, 걸리면 칸마다의 이유를 돌려준다.
 * 화면은 걸린 칸 옆에 이유를 한 줄씩 보인다.
 */
export function checkAgentDraft(
  input: {
    readonly name: string;
    readonly summary: string;
    readonly instructions: string;
    readonly skills: readonly string[];
  },
  userSkills: readonly SkillChoice[] = [],
): { readonly ok: true; readonly fields: AgentDraftFields } | { readonly ok: false; readonly problems: AgentDraftProblems } {
  const name = normalize(input.name);
  const summary = normalize(input.summary);
  const instructions = normalize(input.instructions);
  const problems: AgentDraftProblems = {};
  const nameProblem = lineProblem(name, MAX_AGENT_NAME_LENGTH, true);
  if (nameProblem !== null) problems.name = nameProblem;
  const summaryProblem = lineProblem(summary, MAX_AGENT_SUMMARY_LENGTH, false);
  if (summaryProblem !== null) problems.summary = summaryProblem;
  if (CONTROL_BUT_NEWLINE.test(instructions)) problems.instructions = "control_char";
  else if (length(instructions) > MAX_AGENT_INSTRUCTIONS_LENGTH) problems.instructions = "too_long";
  const order = skillIdOrder(userSkills);
  if (!input.skills.every((id) => order.includes(id))) problems.skills = "unknown_skill";
  if (Object.keys(problems).length > 0) return { ok: false, problems };
  const chosen = new Set(input.skills);
  const skills = order.filter((id) => chosen.has(id));
  return { ok: true, fields: { name, summary, instructions, skills } };
}

/**
 * 저장소가 받아도 되는 초안인가 — ID 모양이 맞고, 칸이 이미 규칙대로 맞춰진 모양이어야 한다(checkAgentDraft 를 한 번 거친 값).
 * userSkills 는 저장소에 있는 사용자 Skill 이다 — 없는 Skill 을 고른 초안은 받지 않는다.
 * 두 저장 구현(메모리 · PostgreSQL)이 같은 값에 같은 답을 내도록 이 함수 하나로 판정한다.
 */
export function isAcceptedAgentDraft(
  draft: Pick<AgentDraft, "id" | "name" | "summary" | "instructions" | "skills">,
  userSkills: readonly SkillChoice[] = [],
): boolean {
  if (!isValidAgentId(draft.id)) return false;
  if (typeof draft.name !== "string" || typeof draft.summary !== "string" || typeof draft.instructions !== "string") return false;
  if (!Array.isArray(draft.skills)) return false;
  const checked = checkAgentDraft(draft, userSkills);
  if (!checked.ok) return false;
  const f = checked.fields;
  return (
    f.name === draft.name &&
    f.summary === draft.summary &&
    f.instructions === draft.instructions &&
    f.skills.length === draft.skills.length &&
    f.skills.every((s, i) => s === draft.skills[i])
  );
}

/** 목록의 머리글자 한 자 (시안의 P · B · R) */
export function agentInitial(name: string): string {
  return ([...name.trim()][0] ?? "?").toUpperCase();
}

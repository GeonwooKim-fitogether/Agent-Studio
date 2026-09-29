/**
 * Skill 의 Save draft 가 칸 규칙에 걸렸을 때(결정 21) 적어 둔 칸을 되살리는 짧은 쿠키. Agent 초안의 agent-draft-cookie.ts 와 같은 방식이다
 * — 사람이 적은 글을 주소에 싣지 않는다. 10분 뒤 사라지고, 저장이 되면 서버 액션이 지운다.
 */
import type { SkillDraftField, SkillDraftProblem, SkillDraftProblems } from "../domain/skill-draft";

export const SKILL_DRAFT_COOKIE = "studio-skill-draft";

export interface SkillFormDraft {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly instructions: string;
}

export function readSkillFormDraft(raw: string | undefined): SkillFormDraft | null {
  if (raw === undefined) return null;
  try {
    const v: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
    const [id, name, summary, instructions] = [text("id"), text("name"), text("summary"), text("instructions")];
    if (id === null || name === null || summary === null || instructions === null) return null;
    return { id, name, summary, instructions };
  } catch {
    return null;
  }
}

const FIELDS: readonly SkillDraftField[] = ["name", "summary", "instructions"];
const PROBLEMS: readonly SkillDraftProblem[] = ["empty", "too_long", "control_char", "duplicate"];

/** 주소의 ?bad= 값들 — "<칸>:<이유>" 여럿. 모양 밖의 값은 버린다 (사람이 적은 글은 싣지 않는다) */
export function skillProblemsToParams(problems: SkillDraftProblems): string[] {
  return FIELDS.flatMap((f) => (problems[f] === undefined ? [] : [`${f}:${problems[f]}`]));
}

export function skillProblemsFromParams(values: readonly string[]): SkillDraftProblems {
  const out: SkillDraftProblems = {};
  for (const v of values) {
    const [field, problem] = v.split(":");
    if (FIELDS.includes(field as SkillDraftField) && PROBLEMS.includes(problem as SkillDraftProblem)) {
      out[field as SkillDraftField] = problem as SkillDraftProblem;
    }
  }
  return out;
}

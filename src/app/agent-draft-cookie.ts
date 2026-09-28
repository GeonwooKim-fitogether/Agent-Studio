/**
 * Save draft 가 칸 규칙에 걸렸을 때(결정 20) 적어 둔 칸을 되살리는 짧은 쿠키. 사람이 적은 글을 주소에 싣지 않기 위해서다
 * (Review 패널의 review-draft.ts 와 같은 방식). 10분 뒤 사라지고, 저장이 되면 서버 액션이 지운다.
 */
import { type AgentDraftField, type AgentDraftProblem, type AgentDraftProblems } from "../domain/agent-draft";

export const AGENT_DRAFT_COOKIE = "studio-agent-draft";

export interface AgentFormDraft {
  readonly id: string;
  readonly name: string;
  readonly summary: string;
  readonly instructions: string;
  readonly skills: readonly string[];
}

export function readAgentFormDraft(raw: string | undefined): AgentFormDraft | null {
  if (raw === undefined) return null;
  try {
    const v: unknown = JSON.parse(decodeURIComponent(raw));
    if (typeof v !== "object" || v === null) return null;
    const o = v as Record<string, unknown>;
    const text = (k: string) => (typeof o[k] === "string" ? (o[k] as string) : null);
    const [id, name, summary, instructions] = [text("id"), text("name"), text("summary"), text("instructions")];
    const skills = Array.isArray(o["skills"]) && o["skills"].every((s) => typeof s === "string") ? (o["skills"] as string[]) : null;
    if (id === null || name === null || summary === null || instructions === null || skills === null) return null;
    return { id, name, summary, instructions, skills };
  } catch {
    return null;
  }
}

const FIELDS: readonly AgentDraftField[] = ["name", "summary", "instructions", "skills"];
const PROBLEMS: readonly AgentDraftProblem[] = ["empty", "too_long", "control_char", "unknown_skill"];

/** 주소의 ?bad= 값들 — "<칸>:<이유>" 여럿. 모양 밖의 값은 버린다 (사람이 적은 글은 싣지 않는다) */
export function problemsToParams(problems: AgentDraftProblems): string[] {
  return FIELDS.flatMap((f) => (problems[f] === undefined ? [] : [`${f}:${problems[f]}`]));
}

export function problemsFromParams(values: readonly string[]): AgentDraftProblems {
  const out: AgentDraftProblems = {};
  for (const v of values) {
    const [field, problem] = v.split(":");
    if (FIELDS.includes(field as AgentDraftField) && PROBLEMS.includes(problem as AgentDraftProblem)) {
      out[field as AgentDraftField] = problem as AgentDraftProblem;
    }
  }
  return out;
}

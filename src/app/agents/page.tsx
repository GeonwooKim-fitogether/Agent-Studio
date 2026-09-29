import { cookies } from "next/headers";
import { flowUsageOf } from "../../application/flow";
import { listAgents } from "../../application/agents";
import {
  type AgentDraftField,
  type AgentDraftProblems,
  agentInitial,
  MAX_AGENT_INSTRUCTIONS_LENGTH,
  MAX_AGENT_NAME_LENGTH,
  MAX_AGENT_SUMMARY_LENGTH,
} from "../../domain/agent-draft";
import { allSkills } from "../../domain/skill-draft";
import { getContainer } from "../../server/container";
import { addAgentAction, saveAgentDraftAction } from "../actions";
import { AGENT_DRAFT_COOKIE, problemsFromParams, readAgentFormDraft } from "../agent-draft-cookie";
import { AGENTS_DEMO_TEXT, DemoBand, DemoTag, SKILLS_DEMO_TEXT } from "../components/demo";
import { Icon } from "../components/glyph";
import { AGENT_PROBLEM } from "../components/labels";
import { Topbar } from "../components/topbar";
import { LAST_WORK_COOKIE } from "../last-work-cookie";
import { SkillsTab } from "./skills-tab";

export const dynamic = "force-dynamic";

/**
 * Agents (결정 20 · 21 — Demo). 한 화면에 탭 한 쌍 `Agents` · `Skills` 가 있다(업무 머리의 Conversation · Flow 탭과 같은 모양).
 *   ?tab=skills   Skills 탭 — 여러 Agent 가 함께 쓰는 지시문 묶음(skills-tab.tsx). 없으면 Agents 탭
 *
 * Agents 탭: 업무를 맡길 Agent 의 초안을 적어 둔다. 저장만 되고 아무것도 실행하지 않는다 — Run 버튼이 없고,
 * AI model 칸은 비활성이다(연결 · 확인된 모델이 없으므로, 결정 3 · 7).
 *
 *   왼쪽(휴대전화는 위의 가로 목록): 초안 목록 + Add Agent(이름만 받아 만든다)
 *   오른쪽: 고른 초안의 편집 칸 — Name · What it does(사람용) · Instructions(AI 용) · AI model(비활성) · Skills(+ Add Skill) · Save draft
 *   Add Skill 은 기본 Skill 과 Skills 탭에서 만든 Skill 에서 고른다. 새 Skill 은 Skills 탭에서 만든다
 * 모두 폼과 주소 파라미터로 동작한다(자바스크립트 없이).
 *   ?agent=<id>   고른 초안 (없으면 첫 초안)
 *   ?saved=1      방금 저장했다 · ?created=1 방금 만들었다
 *   ?bad=<칸>:<이유>  Save draft 가 걸린 칸 (적은 글은 짧은 쿠키로 되살린다)
 *   ?add=<이유>   Add Agent 가 걸린 이유
 */
export default async function AgentsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const one = (name: string) => (typeof query[name] === "string" ? (query[name] as string) : null);
  const all = (name: string) => {
    const v = query[name];
    return v === undefined ? [] : Array.isArray(v) ? v : [v];
  };
  const container = getContainer();
  await container.ensureSynced();
  const tab = one("tab") === "skills" ? "skills" : "agents";
  const agents = await listAgents(container.deps);
  const skillOptions = allSkills(await container.deps.store.listSkillDrafts());
  const header = (
    <>
      <Topbar crumbs={["Agents"]} />
      <DemoBand text={tab === "skills" ? SKILLS_DEMO_TEXT : AGENTS_DEMO_TEXT} />
      <header className="work-header has-tabs lib-header">
        <nav className="work-tabs" aria-label="Agents views">
          <a href="/agents" className={tab === "agents" ? "on" : undefined} aria-current={tab === "agents" ? "page" : undefined} data-testid="tab-agents">
            Agents
          </a>
          <a href="/agents?tab=skills" className={tab === "skills" ? "on" : undefined} aria-current={tab === "skills" ? "page" : undefined} data-testid="tab-skills">
            Skills
          </a>
        </nav>
      </header>
    </>
  );
  if (tab === "skills") {
    return (
      <>
        {header}
        <SkillsTab skills={skillOptions} agents={agents} selectedId={one("skill")} query={{ saved: one("saved"), created: one("created"), missing: one("missing"), bad: all("bad") }} />
      </>
    );
  }
  const selected = agents.find((a) => a.id === one("agent")) ?? agents[0];
  const problems: AgentDraftProblems = selected === undefined ? {} : problemsFromParams(all("bad"));
  const jar = await cookies();
  const cookieDraft = readAgentFormDraft(jar.get(AGENT_DRAFT_COOKIE)?.value);
  const draft = selected !== undefined && Object.keys(problems).length > 0 && cookieDraft?.id === selected.id ? cookieDraft : null;
  const usage = selected === undefined ? null : await flowUsageOf(container.deps, selected.id, jar.get(LAST_WORK_COOKIE)?.value ?? null);
  const addParam = one("add");
  const addProblem = addParam !== null && Object.hasOwn(AGENT_PROBLEM, addParam) ? AGENT_PROBLEM[addParam as keyof typeof AGENT_PROBLEM] : null;

  const values = selected === undefined ? null : (draft ?? selected);
  const chosen = new Set(values?.skills ?? []);
  const problemLine = (field: AgentDraftField) =>
    problems[field] === undefined ? null : (
      <span className="field-problem" data-testid={`agent-problem-${field}`}>
        저장하지 않았다 — {AGENT_PROBLEM[problems[field]!]}
      </span>
    );

  return (
    <>
      {header}
      <div className="content">
        <p className="lib-lead">업무를 맡길 Agent 의 초안을 적어 둔다.</p>
        {one("missing") === "1" && (
          <p className="form-error" data-testid="agent-missing">
            그 초안을 찾지 못해 저장하지 않았다. 목록에서 다시 고른다.
          </p>
        )}
        <div className="agent-grid">
          <div className="agent-side">
            <nav className="agent-list" aria-label="Agent drafts" data-testid="agent-list">
              <p className="eyebrow">
                <span>Drafts</span>
                <span>{agents.length}</span>
              </p>
              {agents.map((a) => {
                const on = a.id === selected?.id;
                return (
                  <a
                    key={a.id}
                    className={on ? "agent-item selected" : "agent-item"}
                    href={`/agents?agent=${encodeURIComponent(a.id)}`}
                    aria-current={on ? "true" : undefined}
                    data-testid={`agent-item-${a.id}`}
                  >
                    <span className="agent-avatar" aria-hidden="true">
                      {agentInitial(a.name)}
                    </span>
                    <span className="grow">
                      <b>{a.name}</b>
                      {a.summary !== "" && <small>{a.summary}</small>}
                    </span>
                  </a>
                );
              })}
            </nav>
            <details className="add-agent" id="add-agent" open={addProblem !== null || agents.length === 0} data-testid="add-agent">
              <summary>
                <Icon name="plus" />
                Add Agent
                <DemoTag />
              </summary>
              <form action={addAgentAction} className="add-agent-form">
                <label className="field">
                  <span>New agent name</span>
                  <input name="name" maxLength={MAX_AGENT_NAME_LENGTH} required placeholder="예: Tester" />
                </label>
                {addProblem !== null && (
                  <span className="field-problem" data-testid="agent-add-problem">
                    만들지 않았다 — {addProblem}
                  </span>
                )}
                <p className="hint">이름만 받아 빈 초안을 만든다. 소개 · 지시문 · Skill 은 편집 칸에서 적는다.</p>
                <button type="submit" className="btn small">
                  Create
                </button>
              </form>
            </details>
          </div>

          {selected === undefined || values === null ? (
            <p className="empty-card" data-testid="agents-empty">
              아직 Agent 초안이 없다 — Add Agent 로 이름을 적어 만든다.
            </p>
          ) : (
            <form className="editor" action={saveAgentDraftAction} aria-label="Agent" data-testid="agent-editor" key={`${selected.id}-${selected.updatedAt}-${draft === null ? "" : "draft"}`}>
              {usage !== null && (
                <p className="used-in" data-testid="agent-used-in">
                  Flow 에서 쓰는 곳 · <a href={`/works/${encodeURIComponent(usage.workId)}/flow?node=build#step`}>{usage.workTitle} — Build</a>
                </p>
              )}
              <input type="hidden" name="id" value={selected.id} />
              <div className="editor-form">
                <label className="field">
                  <span>Name</span>
                  <input name="name" defaultValue={values.name} maxLength={MAX_AGENT_NAME_LENGTH} required aria-invalid={problems.name !== undefined || undefined} />
                </label>
                {problemLine("name")}
                <label className="field">
                  <span>
                    What it does{" "}
                    <small>
                      <b>사람용</b> 소개 · 목록에 보이고, AI 에게는 가지 않는다
                    </small>
                  </span>
                  <input name="summary" defaultValue={values.summary} maxLength={MAX_AGENT_SUMMARY_LENGTH} aria-invalid={problems.summary !== undefined || undefined} />
                </label>
                {problemLine("summary")}
                <label className="field">
                  <span>
                    Instructions{" "}
                    <small>
                      <b>AI 용</b> 지시문 · 실행이 연결되면 이 글이 그대로 AI 에게 간다
                    </small>
                  </span>
                  <textarea
                    className="instructions"
                    name="instructions"
                    rows={5}
                    defaultValue={values.instructions}
                    maxLength={MAX_AGENT_INSTRUCTIONS_LENGTH}
                    aria-invalid={problems.instructions !== undefined || undefined}
                  />
                </label>
                {problemLine("instructions")}
                <div className="field">
                  <span>AI model</span>
                  <select disabled aria-label="AI model" defaultValue="none" data-testid="agent-model">
                    <option value="none">연결된 모델 없음</option>
                  </select>
                  <dl className="model-parts">
                    <div>
                      <dt>Runtime</dt>
                      <dd>—</dd>
                    </div>
                    <div>
                      <dt>Model</dt>
                      <dd>—</dd>
                    </div>
                    <div>
                      <dt>Access</dt>
                      <dd>—</dd>
                    </div>
                  </dl>
                  <p className="hint">
                    연결 · 확인된 모델만 여기에 보인다. 연결은 <a href="/connections">Connections</a> 에서 한다.
                  </p>
                </div>
                <fieldset className="field skills" data-testid="agent-skills">
                  <legend>Skills</legend>
                  <div className="skill-rows">
                    {skillOptions
                      .filter((k) => chosen.has(k.id))
                      .map((k) => (
                        <label key={k.id} className="skill-row">
                          <input type="checkbox" name="skills" value={k.id} defaultChecked /> {k.name}
                        </label>
                      ))}
                    {!skillOptions.some((k) => chosen.has(k.id)) && <p className="hint">고른 Skill 이 없다.</p>}
                  </div>
                  {skillOptions.some((k) => !chosen.has(k.id)) && (
                    <details className="add-skill" data-testid="add-skill">
                      <summary>
                        <Icon name="plus" />
                        Add Skill
                        <DemoTag />
                      </summary>
                      <div className="skill-rows">
                        {skillOptions
                          .filter((k) => !chosen.has(k.id))
                          .map((k) => (
                            <label key={k.id} className="skill-row">
                              <input type="checkbox" name="skills" value={k.id} /> {k.name}
                            </label>
                          ))}
                      </div>
                      <p className="hint">
                        <a href="/agents?tab=skills" data-testid="add-skill-to-skills">
                          새 Skill 은 Skills 탭에서 만든다
                        </a>
                      </p>
                    </details>
                  )}
                  {problemLine("skills")}
                </fieldset>
              </div>
              <div className="editor-foot">
                {(one("saved") === "1" || one("created") === "1") && Object.keys(problems).length === 0 && (
                  <span className="saved-note" role="status" data-testid="agent-saved">
                    <Icon name="check" />
                    {one("saved") === "1" ? "Saved draft" : "Created draft"} · 저장만 됐다, AI 에게 가지 않는다
                  </span>
                )}
                <button type="submit" className="btn primary">
                  Save draft
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
}

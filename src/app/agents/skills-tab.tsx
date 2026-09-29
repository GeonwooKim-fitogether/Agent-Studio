import { cookies } from "next/headers";
import { type AgentDraft, agentInitial } from "../../domain/agent-draft";
import {
  MAX_SKILL_INSTRUCTIONS_LENGTH,
  MAX_SKILL_NAME_LENGTH,
  MAX_SKILL_SUMMARY_LENGTH,
  type SkillDraftField,
  type SkillDraftProblems,
  type SkillView,
  usedBy,
} from "../../domain/skill-draft";
import { newSkillAction, saveSkillDraftAction } from "../actions";
import { DemoTag } from "../components/demo";
import { Icon } from "../components/glyph";
import { SKILL_PROBLEM } from "../components/labels";
import { readSkillFormDraft, SKILL_DRAFT_COOKIE, skillProblemsFromParams } from "../skill-draft-cookie";

/**
 * Agents 화면의 Skills 탭 (결정 21 — Demo). 여러 Agent 가 함께 쓰는 지시문 묶음이다. 저장만 되고 아무것도 실행하지 않는다 — Run · Test 버튼이 없다.
 *
 *   왼쪽(휴대전화는 위): New Skill(이름을 묻지 않고 "새 Skill" 을 만든다) + Skill 목록(기본 Skill 은 이름 옆 자물쇠)
 *   오른쪽: 고른 Skill 의 편집 칸 — Name · What it does(사람용) · Instructions(AI 용, Agent 의 지시문 뒤에 이어 붙는다) · Used by · Save draft
 *   기본 Skill 은 "기본 Skill — 고칠 수 없다" 이고 칸이 읽기 전용이며 Save draft 가 없다.
 *   Used by 는 Agent 초안의 Skills 에서 거꾸로 계산한다. 칩을 누르면 그 Agent 를 고른 Agents 탭으로 간다.
 * 모두 폼과 주소 파라미터로 동작한다(자바스크립트 없이).
 *   ?skill=<id>   고른 Skill (없으면 첫 Skill) · ?saved=1 방금 저장 · ?created=1 방금 만듦 · ?bad=<칸>:<이유> 걸린 칸 · ?missing=1 그 초안이 없다
 */
export async function SkillsTab({
  skills,
  agents,
  selectedId,
  query,
}: {
  skills: readonly SkillView[];
  agents: readonly AgentDraft[];
  selectedId: string | null;
  query: { saved: string | null; created: string | null; missing: string | null; bad: readonly string[] };
}) {
  const selected = skills.find((k) => k.id === selectedId) ?? skills[0]!;
  const locked = selected.builtIn;
  const problems: SkillDraftProblems = locked ? {} : skillProblemsFromParams(query.bad);
  const jar = await cookies();
  const cookieDraft = readSkillFormDraft(jar.get(SKILL_DRAFT_COOKIE)?.value);
  const draft = Object.keys(problems).length > 0 && cookieDraft?.id === selected.id ? cookieDraft : null;
  const values = draft ?? selected;
  const users = usedBy(selected.id, agents);
  const problemLine = (field: SkillDraftField) =>
    problems[field] === undefined ? null : (
      <span className="field-problem" data-testid={`skill-problem-${field}`}>
        저장하지 않았다 — {SKILL_PROBLEM[problems[field]!]}
      </span>
    );

  return (
    <div className="content">
      <p className="lib-lead">여러 Agent 가 함께 쓰는 지시문 묶음이다.</p>
      {query.missing === "1" && (
        <p className="form-error" data-testid="skill-missing">
          그 Skill 초안을 찾지 못해 저장하지 않았다. 목록에서 다시 고른다.
        </p>
      )}
      <div className="skill-grid">
        <nav className="skill-list" aria-label="Skills" data-testid="skill-list">
          <form action={newSkillAction}>
            <button type="submit" className="btn small new-skill" data-testid="new-skill">
              <Icon name="plus" />
              New Skill
              <DemoTag />
            </button>
          </form>
          {skills.map((k) => {
            const on = k.id === selected.id;
            return (
              <a
                key={k.id}
                className={on ? "agent-item skill-item selected" : "agent-item skill-item"}
                href={`/agents?tab=skills&skill=${encodeURIComponent(k.id)}`}
                aria-current={on ? "true" : undefined}
                data-testid={`skill-item-${k.id}`}
              >
                <span className="grow">
                  <b>
                    {k.name}
                    {k.builtIn && (
                      <span className="lock" role="img" aria-label="기본 Skill" title="기본 Skill" data-testid="skill-lock">
                        <Icon name="lock" />
                      </span>
                    )}
                  </b>
                  <small>{k.summary !== "" ? k.summary : "소개를 아직 적지 않았다."}</small>
                </span>
              </a>
            );
          })}
        </nav>

        <form
          className="editor"
          action={saveSkillDraftAction}
          aria-label="Skill"
          data-testid="skill-editor"
          data-locked={locked ? "true" : "false"}
          // 고른 Skill 이나 그 값이 바뀌면 입력칸을 새로 그린다(입력칸은 defaultValue 로 채운다)
          key={JSON.stringify([selected.id, draft === null, values.name, values.summary, values.instructions])}
        >
          {locked && (
            <p className="locked-note" data-testid="skill-locked">
              <Icon name="lock" />
              기본 Skill — 고칠 수 없다
            </p>
          )}
          {!locked && <input type="hidden" name="id" value={selected.id} />}
          <div className="editor-form">
            <label className="field">
              <span>Name</span>
              <input
                name="name"
                defaultValue={values.name}
                maxLength={MAX_SKILL_NAME_LENGTH}
                required={!locked}
                readOnly={locked}
                aria-invalid={problems.name !== undefined || undefined}
              />
            </label>
            {problemLine("name")}
            <label className="field">
              <span>
                What it does{" "}
                <small>
                  <b>사람용</b> 소개 · 목록에 보이고, AI 에게는 가지 않는다
                </small>
              </span>
              <input
                name="summary"
                defaultValue={values.summary}
                maxLength={MAX_SKILL_SUMMARY_LENGTH}
                readOnly={locked}
                aria-invalid={problems.summary !== undefined || undefined}
              />
            </label>
            {problemLine("summary")}
            <label className="field">
              <span>
                Instructions{" "}
                <small>
                  <b>AI 용</b> 지시문 · Agent 의 지시문 뒤에 이어 붙는다
                </small>
              </span>
              <textarea
                className="instructions"
                name="instructions"
                rows={5}
                defaultValue={values.instructions}
                maxLength={MAX_SKILL_INSTRUCTIONS_LENGTH}
                readOnly={locked}
                aria-invalid={problems.instructions !== undefined || undefined}
              />
            </label>
            {problemLine("instructions")}
            <div className="field">
              <span>Used by</span>
              <div className="chips" data-testid="skill-used-by">
                {users.length === 0 ? (
                  <span className="empty">아직 쓰는 Agent 없음</span>
                ) : (
                  users.map((a) => (
                    <a key={a.id} className="chip" href={`/agents?agent=${encodeURIComponent(a.id)}`} data-testid={`skill-used-by-${a.id}`}>
                      <span className="agent-avatar" aria-hidden="true">
                        {agentInitial(a.name)}
                      </span>
                      {a.name}
                    </a>
                  ))
                )}
              </div>
            </div>
          </div>
          {!locked && (
            <div className="editor-foot">
              {(query.saved === "1" || query.created === "1") && Object.keys(problems).length === 0 && (
                <span className="saved-note" role="status" data-testid="skill-saved">
                  <Icon name="check" />
                  {query.saved === "1" ? "Saved draft" : "Created draft"} · 저장만 됐다, AI 에게 가지 않는다
                </span>
              )}
              <button type="submit" className="btn primary">
                Save draft
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}

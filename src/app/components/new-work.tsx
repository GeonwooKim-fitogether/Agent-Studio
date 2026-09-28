import Link from "next/link";
import type { NewWorkProblem } from "../../application/new-work";
import type { Project, Work } from "../../domain/model";
import { MAX_WORK_GOAL_LENGTH } from "../../domain/work-goal";
import { markerFor } from "../../domain/work-marker";
import { newEmptyWorkAction } from "../actions";
import { CopyButton } from "./copy-button";
import { Icon } from "./glyph";
import { MARKER_HINT, NEW_WORK_PROBLEM } from "./labels";
import { StatusBadge } from "./work-status";

/** Workspace 머리의 New Work. 프로젝트가 하나도 없으면 누를 수 없고 그 이유를 옆에 보인다(결정 7) */
export function NewWorkButton({ hasProjects }: { hasProjects: boolean }) {
  if (hasProjects) {
    return (
      <Link href="/?newWork=1" className="btn primary">
        <Icon name="plus" />
        New Work
      </Link>
    );
  }
  return (
    <div className="new-work-off">
      <button type="button" className="btn primary" disabled>
        New Work
      </button>
      <small className="muted" data-testid="new-work-disabled-reason">
        연결된 프로젝트가 없어 업무를 만들 수 없다.
      </small>
    </div>
  );
}

/** 빈 업무 만들기 폼 (feature-plan F5, 결정 18 — 제목과 목표를 받는다). 자바스크립트 없이도 서버 액션으로 제출된다 */
export function NewWorkForm({
  projects,
  problem,
  projectId,
}: {
  projects: readonly Project[];
  problem: NewWorkProblem | null;
  projectId: string | null;
}) {
  const preset = projects.some((p) => p.id === projectId) ? (projectId ?? undefined) : undefined;
  return (
    <section className="newwork" aria-label="New Work" data-testid="new-work-form">
      <p className="eyebrow">New Work</p>
      {problem !== null && (
        <p className="source-error" data-testid="new-work-problem">
          업무를 만들지 않았다 — {NEW_WORK_PROBLEM[problem]}
        </p>
      )}
      <form action={newEmptyWorkAction} className="form-grid">
        <div className="form-row">
          <label className="field">
            Project
            <select name="projectId" defaultValue={preset} required>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field grow">
            Title
            <input name="title" required autoFocus placeholder="예: 관리자 목록 검색 필터" autoComplete="off" />
          </label>
        </div>
        <label className="field">
          Goal
          <textarea
            name="goal"
            required
            rows={2}
            maxLength={MAX_WORK_GOAL_LENGTH}
            placeholder="이 업무가 끝나면 무엇이 달라지나 — 예: 관리자가 이름 두 글자로 사용자를 3초 안에 찾는다"
          />
        </label>
        <div className="form-actions">
          <Link href="/" className="btn">
            Cancel
          </Link>
          <button type="submit" className="btn primary">
            Create
          </button>
        </div>
      </form>
    </section>
  );
}

/** 빈 업무를 만든 뒤: 표식과 Copy, 그 업무로 가는 Open Work (시안 v2) */
export function NewWorkCreated({ work, projectName }: { work: Work; projectName: string }) {
  const marker = markerFor(work.id);
  return (
    <section className="newwork" aria-label="New Work" data-testid="new-work-result">
      <p className="eyebrow">업무를 만들었다 · {projectName}</p>
      <p className="newwork-title">
        <span data-testid="new-work-title">{work.title}</span> <StatusBadge status={work.status} />
      </p>
      <p className="newwork-goal" data-testid="new-work-goal">
        {work.goal}
      </p>
      <div className="marker">
        <code id="new-work-marker" data-testid="new-work-marker" title={MARKER_HINT}>
          {marker}
        </code>
        <CopyButton text={marker} targetId="new-work-marker" />
        <Link href={`/works/${encodeURIComponent(work.id)}`} className="btn">
          Open Work
        </Link>
        <Link href="/" className="btn text">
          Close
        </Link>
      </div>
    </section>
  );
}

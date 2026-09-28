import type { Project, Work } from "../../domain/model";
import { DemoTag } from "./demo";
import { StatusBadge } from "./work-status";

/**
 * 업무 화면의 머리 (결정 18 · 20) — `표식 · 상태` 눈썹, 제목, 그리고 같은 업무의 두 보기 Conversation · Flow(Demo) 탭 한 쌍.
 * 두 탭은 그냥 링크라 자바스크립트 없이 동작한다. Conversation 은 그 업무의 Chat(/works/…), Flow 는 그 업무의 흐름도(/works/…/flow)다.
 */
export function WorkHeader({ work, project, marker, view }: { work: Work; project: Project; marker: string; view: "conversation" | "flow" }) {
  const path = `/works/${encodeURIComponent(work.id)}`;
  return (
    <header className="work-header has-tabs">
      <div className="work-head">
        <p className="work-eyebrow">
          {/* 휴대전화 폭에는 빵부스러기가 없어 프로젝트 이름을 여기에 */}
          <a className="mobile-only" href={`/?project=${encodeURIComponent(project.id)}`}>
            {project.name}
          </a>
          <span className="mono" data-testid="work-eyebrow-marker">
            {marker}
          </span>
          <StatusBadge status={work.status} />
        </p>
        <h1>{work.title}</h1>
      </div>
      <nav className="work-tabs" aria-label="Work views">
        <a href={path} className={view === "conversation" ? "on" : undefined} aria-current={view === "conversation" ? "page" : undefined} data-testid="tab-conversation">
          Conversation
        </a>
        <a href={`${path}/flow`} className={view === "flow" ? "on" : undefined} aria-current={view === "flow" ? "page" : undefined} data-testid="tab-flow">
          Flow
          <DemoTag />
        </a>
      </nav>
    </header>
  );
}

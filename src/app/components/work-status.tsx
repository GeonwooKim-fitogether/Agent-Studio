import type { WorkSummaryView } from "../../application/queries";
import type { WorkStatus } from "../../domain/model";
import { MANUAL_STATUSES } from "../../domain/work-status";
import { markDoneAction, setStatusAction } from "../actions";
import { DONE_CANDIDATE_NOTE, MANUAL_STATUS_NOTE, statusChangeText, WORK_STATUS } from "./labels";

/** 업무 상태 배지 (시안 v2: Draft · In progress · Needs review · Done candidate · Done). 완료 후보는 점선 테두리로 완료와 구분한다 */
export function StatusBadge({ status }: { status: WorkStatus }) {
  return (
    <span className={`status status-${status}`} data-testid="status-badge" data-status={status}>
      {WORK_STATUS[status]}
    </span>
  );
}

/** Workspace 의 업무 줄 아래에 붙는 상태 이력 한 줄 */
export function StatusHistoryLine({ summary }: { summary: Pick<WorkSummaryView, "latestChange" | "statusPinned"> }) {
  return (
    <p className="why" data-testid="status-history">
      상태 이력: {statusChangeText(summary.latestChange, summary.statusPinned)}
    </p>
  );
}

/**
 * 업무 화면의 상태 칸 — 이력 한 줄, 완료 후보일 때 Mark as Done 과 그 이유, 그리고 사람이 상태를 손으로 고르는 선택(R6).
 * 모두 Studio 의 업무 상태만 바꾸고 GitHub 에는 아무것도 보내지 않는다.
 */
export function WorkStatusPanel({ summary }: { summary: WorkSummaryView }) {
  const { work } = summary;
  const manualDefault = MANUAL_STATUSES.includes(work.status) ? work.status : "";
  return (
    <section className="status-box" data-testid="status-box" aria-label="Work status">
      <StatusHistoryLine summary={summary} />
      {work.status === "done_candidate" && (
        <div className="done-candidate">
          <form action={markDoneAction}>
            <input type="hidden" name="workId" value={work.id} />
            <button type="submit" className="btn primary">
              Mark as Done
            </button>
          </form>
          <p className="why" data-testid="done-candidate-note">
            {DONE_CANDIDATE_NOTE}
          </p>
        </div>
      )}
      <form action={setStatusAction} className="status-form">
        <input type="hidden" name="workId" value={work.id} />
        <label>
          Status{" "}
          <select name="status" defaultValue={manualDefault} key={work.status} aria-label="Status" required>
            {manualDefault === "" && (
              <option value="" disabled>
                {WORK_STATUS[work.status]}
              </option>
            )}
            {MANUAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {WORK_STATUS[s]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="btn tiny">
          Set Status
        </button>
        <small className="muted">{MANUAL_STATUS_NOTE}</small>
      </form>
    </section>
  );
}

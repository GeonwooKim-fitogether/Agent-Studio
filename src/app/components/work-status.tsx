import type { WorkSummaryView } from "../../application/queries";
import type { WorkStatus } from "../../domain/model";
import { MANUAL_STATUSES } from "../../domain/work-status";
import { setStatusAction } from "../actions";
import { MANUAL_STATUS_NOTE, statusChangeText, WORK_STATUS } from "./labels";

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
 * 업무 화면 Work details 의 상태 칸 — 이력 한 줄과, 사람이 상태를 손으로 고르는 선택(R6). R6 의 약속은 버튼의 title 로만 보인다(결정 18).
 * 완료 후보의 Mark as Done 은 Next action 카드에 있다(할 일이 그것 하나일 때 주 버튼이 된다).
 * 모두 Studio 의 업무 상태만 바꾸고 GitHub 에는 아무것도 보내지 않는다.
 */
export function WorkStatusPanel({ summary }: { summary: WorkSummaryView }) {
  const { work } = summary;
  const manualDefault = MANUAL_STATUSES.includes(work.status) ? work.status : "";
  return (
    <section className="status-box" data-testid="status-box" aria-label="Work status">
      <StatusHistoryLine summary={summary} />
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
        <button type="submit" className="btn small" title={MANUAL_STATUS_NOTE}>
          Set Status
        </button>
      </form>
    </section>
  );
}

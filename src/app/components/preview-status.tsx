import type { PreviewCardView } from "../../application/preview";
import { PREVIEW_PHASE, shortSha } from "./labels";

/** 미리보기 상태를 한 구절로 — 아이콘 줄의 미리보기 칸(pr-icons.tsx)이 title 로 쓴다. 자세한 것(로그 · 주소 · 종료)은 Review 패널에 있다 */
export function previewSummary(view: PreviewCardView | undefined): { readonly text: string; readonly tone: "ok" | "warn" | "off" | "quiet" } {
  if (view === undefined) return { text: "Not available", tone: "quiet" };
  const { availability, session } = view;
  if (session !== null && (session.phase === "running" || session.busy)) {
    if (session.phase === "running") {
      return session.freshness === "outdated"
        ? { text: `Outdated · ${shortSha(session.commitSha)} is running`, tone: "warn" }
        : { text: `Running · ${shortSha(session.commitSha)}`, tone: "ok" };
    }
    return { text: `${PREVIEW_PHASE[session.phase]} · ${shortSha(session.commitSha)}`, tone: "quiet" };
  }
  if (availability.kind === "runner_offline") return { text: "Preview host offline", tone: "off" };
  if (availability.kind === "blocked") return { text: "Not previewable", tone: "quiet" };
  if (session?.phase === "failed") return { text: `Failed · ${shortSha(session.commitSha)}`, tone: "warn" };
  return { text: "Not running", tone: "quiet" };
}

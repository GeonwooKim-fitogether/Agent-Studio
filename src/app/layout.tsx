import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPreviewDevice } from "../application/preview";
import { getContainer } from "../server/container";
import { syncAction } from "./actions";
import { formatKst, PREVIEW_PHASE } from "./components/labels";
import { SourceStatusList } from "./components/source-status";
import { Nav } from "./nav";
import "./globals.css";

// 화면은 저장소(메모리 또는 PostgreSQL)의 현재 상태를 그린다. 빌드 때 미리 굳혀 두면 안 되므로 매 요청마다 그린다.
export const dynamic = "force-dynamic";

const SOURCE_LABEL = {
  fixture: "Fixture data",
  github: "GitHub token (read-only)",
  github_app: "GitHub App (read-only)",
  github_combined: "GitHub App + token (read-only)",
} as const;

export const metadata: Metadata = { title: "Agent Studio" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const container = getContainer();
  await container.ensureSynced();
  const { reader } = container.deps;
  const status = container.status();
  const device = await getPreviewDevice(container.deps, container.preview);

  return (
    <html lang="ko">
      <body>
        <header className="topbar">
          <div className="brand">
            <span className="brand-mark" aria-hidden="true">
              A
            </span>
            Agent Studio
          </div>
          <Nav />
        </header>
        <div className="source-bar" data-testid="data-source">
          <span className="source-pill" data-testid="source-kind">
            {SOURCE_LABEL[reader.source]}
            {container.configError !== null && " · 설정 오류"}
          </span>
          <span>
            {reader.source === "fixture"
              ? "고정 데이터로 동작한다. 실제 GitHub 는 읽지 않는다."
              : `GitHub 에서 읽기만 한다. ${reader.limitNote ?? ""}`}
          </span>
          <span className="source-pill" data-testid="storage-kind">
            {container.storage === "postgres" ? "Stored in PostgreSQL" : "Stored in memory"}
          </span>
          {container.storage === "memory" && <span>저장은 서버 메모리라서 서버를 다시 켜면 처음 상태로 돌아간다.</span>}
          <span className="source-sync">
            Last sync{" "}
            {status.lastSyncedAt ? (
              <time dateTime={status.lastSyncedAt} data-testid="last-sync">
                {formatKst(status.lastSyncedAt)}
              </time>
            ) : (
              "없음"
            )}
          </span>
          {status.lastResult && (
            <span data-testid="last-sync-result">
              저장소 {status.lastResult.repositories} · PR {status.lastResult.pullRequests}
              {status.lastResult.skipped > 0 && ` · 건너뜀 ${status.lastResult.skipped}`}
            </span>
          )}
          <SourceStatusList sources={status.sources} />
          {status.lastError && (
            <span className="source-error" data-testid="sync-error">
              {container.configError !== null ? "설정 오류" : "동기화 실패"}: {status.lastError}
            </span>
          )}
          {status.lastWarning && <span className="source-error">{status.lastWarning}</span>}
          <span className={device.online ? "source-pill preview-device" : "source-pill preview-device offline"} data-testid="preview-device">
            {device.online ? "Preview device: connected" : "Preview device: not connected"}
          </span>
          <span data-testid="preview-device-detail">
            {device.text}
            {device.active !== null && ` · ${PREVIEW_PHASE[device.active.phase]} · ${device.active.repoName}#${device.active.number}`}
          </span>
          <form action={syncAction}>
            <button type="submit" className="btn tiny">
              Sync
            </button>
          </form>
        </div>
        <main className="page">{children}</main>
      </body>
    </html>
  );
}

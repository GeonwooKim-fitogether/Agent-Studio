import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getPreviewDevice } from "../application/preview";
import { getSidebar } from "../application/queries";
import { getContainer } from "../server/container";
import { syncAction } from "./actions";
import { AutoRefresh } from "./components/auto-refresh";
import { Icon } from "./components/glyph";
import { formatAgo, formatKst } from "./components/labels";
import { sourceStatusText } from "./components/source-status";
import { MobileTabs, Nav, ProjectNav, SettingsNav } from "./nav";
import "./globals.css";

// 화면은 저장소(메모리 또는 PostgreSQL)의 현재 상태를 그린다. 빌드 때 미리 굳혀 두면 안 되므로 매 요청마다 그린다.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agent Studio" };

/**
 * 모든 화면의 틀 (결정 18, Q1 · Q2). 넓은 화면은 왼쪽 사이드바, 휴대전화 폭은 위쪽 한 줄 + 아래쪽 탭이다.
 *
 * 기술 정보(출처 · 저장소 · 마지막 Sync 시각 · 저장 방식 · 출처별 결과 · 미리보기 기기 상세)는 Connections 화면에 있다.
 * 여기에는 판단에 필요한 것만 남긴다 — 한 줄 요약(GitHub · 3분 전 + Sync, Preview host), 그리고 동기화가 실패했거나 설정이
 * 틀렸으면 모든 화면 맨 위의 경고 한 줄. 고정 데이터로 돌면 "Fixture data" 가 늘 보인다.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const container = getContainer();
  await container.ensureSynced();
  const { reader } = container.deps;
  const status = container.status();
  const [device, sidebar] = await Promise.all([getPreviewDevice(container.deps, container.preview), getSidebar(container.deps)]);
  const fixture = reader.source === "fixture";
  const ago = status.lastSyncedAt === null ? "Not synced" : formatAgo(status.lastSyncedAt, Date.now());
  const failedSources = status.sources.filter((s) => s.error !== null);
  const warning =
    status.lastError !== null
      ? `${container.configError !== null ? "설정 오류" : "동기화 실패"}: ${status.lastError}`
      : failedSources.length > 0
        ? `GitHub 출처 일부를 읽지 못했다 — ${failedSources.map(sourceStatusText).join(" / ")}`
        : null;

  const syncSummary = (
    <div className="sync-summary" data-testid="sync-summary">
      <span className="sync-line">
        <Icon name={fixture ? "database" : "github"} />
        <span>
          {fixture && (
            <b className="fixture" data-testid="fixture-badge">
              Fixture data
            </b>
          )}
          {!fixture && "GitHub"} ·{" "}
          <time dateTime={status.lastSyncedAt ?? undefined} title={status.lastSyncedAt === null ? undefined : formatKst(status.lastSyncedAt)}>
            {ago}
          </time>
        </span>
      </span>
      <form action={syncAction}>
        <button type="submit" className="btn small">
          Sync
        </button>
      </form>
    </div>
  );
  const hostLine = (
    <span className={device.online ? "host-line" : "host-line offline"} data-testid="preview-host">
      <Icon name={device.online ? "monitor" : "off"} />
      Preview host · {device.online ? "Connected" : "Offline"}
    </span>
  );

  return (
    <html lang="ko">
      <body>
        <div className="app">
          <aside className="sidebar" aria-label="Sidebar">
            <a href="/" className="brand">
              <span className="brandmark" aria-hidden="true">
                <svg viewBox="0 0 27 29">
                  <path d="M3 23 13.5 4 24 23M8 16h11M3 23h8M16 23h8" />
                </svg>
              </span>
              Agent Studio
            </a>
            <Nav inboxCount={sidebar.inboxCount} />
            <ProjectNav projects={sidebar.projects} />
            <div className="sidebar-bottom">
              <SettingsNav />
              <div className="sidebar-status">
                {syncSummary}
                {hostLine}
              </div>
            </div>
          </aside>
          <div className="shell">
            <header className="mobile-top">
              <a href="/" className="brand small">
                <span className="brandmark" aria-hidden="true">
                  <svg viewBox="0 0 27 29">
                    <path d="M3 23 13.5 4 24 23M8 16h11M3 23h8M16 23h8" />
                  </svg>
                </span>
                Agent Studio
              </a>
              {syncSummary}
            </header>
            {warning !== null && (
              <div className="warning-bar" role="alert" data-testid="sync-error">
                <Icon name="warning" />
                <span>{warning}</span>
                <a href="/connections">Connections</a>
              </div>
            )}
            <main className="main">{children}</main>
          </div>
          <MobileTabs inboxCount={sidebar.inboxCount} />
        </div>
        {/* 주기 동기화의 결과(업무 상태 변화 포함)가 열어 둔 화면에도 보이도록 같은 간격으로 다시 그린다 */}
        {container.syncIntervalSeconds > 0 && <AutoRefresh everyMs={container.syncIntervalSeconds * 1000} />}
      </body>
    </html>
  );
}

import type { Metadata } from "next";
import type { ReactNode } from "react";
import { getContainer } from "../server/container";
import { syncAction } from "./actions";
import { Nav } from "./nav";
import "./globals.css";

// 화면은 서버 메모리의 현재 상태를 그린다. 빌드 때 미리 굳혀 두면 안 되므로 매 요청마다 그린다.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agent Studio" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const container = getContainer();
  await container.ensureSynced();
  const { reader } = container.deps;
  const status = container.status();

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
          <span className="source-pill">{reader.source === "fixture" ? "Fixture data" : "GitHub (read-only)"}</span>
          <span>
            {reader.source === "fixture"
              ? "고정 데이터로 동작한다. 실제 GitHub 는 읽지 않는다."
              : `GitHub 에서 읽기만 한다. ${reader.limitNote ?? ""}`}
          </span>
          <span>저장은 서버 메모리라서 서버를 다시 켜면 처음 상태로 돌아간다.</span>
          <span className="source-sync">
            Last sync{" "}
            {status.lastSyncedAt ? (
              <time dateTime={status.lastSyncedAt}>{status.lastSyncedAt.replace("T", " ").slice(0, 19)} UTC</time>
            ) : (
              "없음"
            )}
          </span>
          {status.lastError && <span className="source-error">동기화 실패: {status.lastError}</span>}
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

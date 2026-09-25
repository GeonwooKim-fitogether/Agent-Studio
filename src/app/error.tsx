"use client";

import Link from "next/link";

/** 요청 처리 중 오류(예: 다른 탭에서 이미 연결된 PR 을 다시 연결하려 할 때)를 보여 준다. */
export default function ErrorPage({ retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="page-inner">
      <div className="page-head">
        <h1>요청을 처리하지 못했다</h1>
        <p className="muted">화면이 오래됐을 수 있다. 다시 시도하거나 Workspace 로 돌아간다.</p>
      </div>
      <div className="inbox-actions">
        <button type="button" className="btn" onClick={() => retry()}>
          Try again
        </button>
        <Link href="/" className="btn">
          Back to Workspace
        </Link>
      </div>
    </div>
  );
}

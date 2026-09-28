import type { ReactNode } from "react";

/**
 * 셸 위의 빵부스러기 한 줄 (Focus 시안의 topbar). `Studio / Workspace`, `Studio / 결제 서비스 / studio-work-…` 처럼 지금 어디인지만 보인다.
 * 오른쪽에는 아무것도 두지 않는다 — 검색은 아직 없는 기능이라 그리지 않는다(결정 7).
 * 화면마다 자기 자리를 넘긴다(틀은 화면을 모른다). 휴대전화 폭에서는 위쪽 줄 아래에 작게 남는다.
 */
export function Topbar({ crumbs }: { crumbs: readonly ReactNode[] }) {
  return (
    <div className="topbar" data-testid="topbar">
      <nav className="crumb" aria-label="Breadcrumb">
        <span>Studio</span>
        {crumbs.map((c, i) => (
          <span key={i} className="crumb-part" style={{ display: "contents" }}>
            <span className="sep" aria-hidden="true">
              /
            </span>
            {i === crumbs.length - 1 ? <b>{c}</b> : c}
          </span>
        ))}
      </nav>
    </div>
  );
}

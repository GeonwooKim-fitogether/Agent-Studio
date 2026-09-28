"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Icon, type IconName } from "./components/glyph";

/**
 * 사이드바 · 아래쪽 탭의 내비게이션 (결정 18, Q1). 실제로 동작하는 화면만 둔다(결정 7) — Flow · Agents 는 3단계 전이라 두지 않는다(Q3).
 * 업무 화면이 곧 그 업무의 Chat 이라 /works/… 에서는 Chat 이 켜진다.
 * 자바스크립트가 없어도 링크는 그대로 동작한다(켜진 표시만 서버가 그린 그대로다).
 */
function useActive() {
  const pathname = usePathname();
  return {
    workspace: pathname === "/",
    chat: pathname === "/chat" || pathname.startsWith("/works/"),
    inbox: pathname.startsWith("/inbox"),
    connections: pathname.startsWith("/connections"),
  };
}

function NavLink({ href, label, icon, active, count }: { href: string; label: string; icon: IconName; active: boolean; count?: number }) {
  return (
    <Link href={href} className={active ? "nav-item active" : "nav-item"} aria-current={active ? "page" : undefined}>
      <Icon name={icon} />
      <span className="nav-label">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="count" aria-label={`${count} waiting`}>
          {count}
        </span>
      )}
    </Link>
  );
}

export function Nav({ inboxCount }: { inboxCount: number }) {
  const active = useActive();
  return (
    <nav className="nav" aria-label="Main">
      <NavLink href="/" label="Workspace" icon="workspace" active={active.workspace} />
      <NavLink href="/chat" label="Chat" icon="chat" active={active.chat} />
      <NavLink href="/inbox" label="Inbox" icon="inbox" active={active.inbox} count={inboxCount} />
    </nav>
  );
}

/** 사이드바의 Projects — 누르면 Workspace 를 그 프로젝트로 거른다 (?project=) */
export function ProjectNav({ projects }: { projects: readonly { readonly id: string; readonly name: string; readonly openWorks: number }[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = pathname === "/" ? params.get("project") : null;
  const total = projects.reduce((n, p) => n + p.openWorks, 0);
  return (
    <nav className="project-nav" aria-label="Projects">
      <p className="eyebrow">
        Projects <span>{String(projects.length).padStart(2, "0")}</span>
      </p>
      <Link href="/" className={pathname === "/" && selected === null ? "selected" : undefined} data-testid="project-filter-all">
        <Icon name="workspace" />
        <span className="grow">All projects</span>
        <span className="n">{total}</span>
      </Link>
      {projects.map((p) => (
        <Link
          key={p.id}
          href={`/?project=${encodeURIComponent(p.id)}`}
          className={selected === p.id ? "selected" : undefined}
          aria-current={selected === p.id ? "page" : undefined}
          data-testid={`project-filter-${p.id}`}
        >
          <span className="project-initial" aria-hidden="true">
            {[...p.name][0]}
          </span>
          <span className="grow">{p.name}</span>
          <span className="n">{p.openWorks}</span>
        </Link>
      ))}
    </nav>
  );
}

/** 휴대전화 폭의 아래쪽 탭 (Q1) */
export function MobileTabs({ inboxCount }: { inboxCount: number }) {
  const active = useActive();
  return (
    <nav className="mobile-tabs" aria-label="Main">
      <NavLink href="/" label="Workspace" icon="workspace" active={active.workspace} />
      <NavLink href="/chat" label="Chat" icon="chat" active={active.chat} />
      <NavLink href="/inbox" label="Inbox" icon="inbox" active={active.inbox} count={inboxCount} />
      <NavLink href="/connections" label="Connections" icon="settings" active={active.connections} />
    </nav>
  );
}

export function SettingsNav() {
  const active = useActive();
  return (
    <nav className="nav" aria-label="Settings">
      <NavLink href="/connections" label="Connections" icon="settings" active={active.connections} />
    </nav>
  );
}

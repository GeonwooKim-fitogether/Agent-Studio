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

/** 프로젝트 이름에서 소유자(`owner/`)를 뗀 짧은 이름. 목록에서는 소유자를 반복하지 않는다(결정 18) */
export const shortProjectName = (name: string) => name.slice(name.lastIndexOf("/") + 1);

/** 목록의 머리글자 — 두 낱말이면 각 첫 글자, 한 낱말이면 앞 두 글자 (시안의 AS · FT 처럼) */
export function projectInitial(name: string): string {
  const words = shortProjectName(name)
    .split(/[\s\-_.]+/)
    .filter((w) => w !== "");
  const letters = words.length >= 2 ? [...words[0]!][0]! + [...words[1]!][0]! : [...(words[0] ?? "?")].slice(0, 2).join("");
  return letters.toUpperCase();
}

type ProjectItem = { readonly id: string; readonly name: string; readonly openWorks: number };

function ProjectLink({ p, selected }: { p: ProjectItem; selected: boolean }) {
  return (
    <Link
      href={`/?project=${encodeURIComponent(p.id)}`}
      className={selected ? "selected" : undefined}
      aria-current={selected ? "page" : undefined}
      title={p.name}
      data-testid={`project-filter-${p.id}`}
    >
      <span className="project-initial" aria-hidden="true">
        {projectInitial(p.name)}
      </span>
      <span className="grow project-name">{shortProjectName(p.name)}</span>
      <span className="n">{p.openWorks}</span>
    </Link>
  );
}

/**
 * 사이드바의 Projects — 누르면 Workspace 를 그 프로젝트로 거른다 (?project=).
 * 끝나지 않은 업무가 없는 프로젝트는 아래의 "N more" 로 접는다(details — 자바스크립트 없이 동작한다). 개수는 머리글에 있다.
 */
export function ProjectNav({ projects }: { projects: readonly ProjectItem[] }) {
  const pathname = usePathname();
  const params = useSearchParams();
  const selected = pathname === "/" ? params.get("project") : null;
  const total = projects.reduce((n, p) => n + p.openWorks, 0);
  const active = projects.filter((p) => p.openWorks > 0 || p.id === selected);
  const idle = projects.filter((p) => !active.includes(p));
  return (
    <nav className="project-nav" aria-label="Projects">
      <p className="eyebrow">
        Projects <span data-testid="project-count">{String(projects.length).padStart(2, "0")}</span>
      </p>
      <Link href="/" className={pathname === "/" && selected === null ? "selected" : undefined} data-testid="project-filter-all">
        <Icon name="workspace" />
        <span className="grow">All projects</span>
        <span className="n">{total}</span>
      </Link>
      {active.map((p) => (
        <ProjectLink key={p.id} p={p} selected={selected === p.id} />
      ))}
      {idle.length > 0 && (
        <details className="project-more" data-testid="project-more">
          <summary>
            <Icon name="chevron" />
            {idle.length} more
          </summary>
          {idle.map((p) => (
            <ProjectLink key={p.id} p={p} selected={false} />
          ))}
        </details>
      )}
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

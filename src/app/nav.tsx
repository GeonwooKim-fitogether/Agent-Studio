"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/**
 * 상단 내비게이션. 실제로 동작하는 화면만 둔다(결정 7). 2.5단계에 Chat 이 나타난다(feature-plan §3-1) — 업무 화면이 곧 그 업무의 Chat 이다.
 * 아직 없는 Flow · Agents 는 두지 않는다.
 */
export function Nav() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Workspace", active: pathname === "/" },
    { href: "/chat", label: "Chat", active: pathname === "/chat" || pathname.startsWith("/works/") },
    { href: "/inbox", label: "Inbox", active: pathname.startsWith("/inbox") },
  ];
  return (
    <nav className="global-nav" aria-label="Main">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          className={item.active ? "nav-item active" : "nav-item"}
          aria-current={item.active ? "page" : undefined}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

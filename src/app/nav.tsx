"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

/** 상단 내비게이션. 지금 실제로 있는 화면 두 개만 둔다 — 아직 없는 Chat · Flow · Agents 는 두지 않는다. */
export function Nav() {
  const pathname = usePathname();
  const items = [
    { href: "/", label: "Workspace", active: pathname === "/" || pathname.startsWith("/works/") },
    { href: "/inbox", label: "Inbox", active: pathname.startsWith("/inbox") },
  ];
  return (
    <nav className="global-nav" aria-label="Main">
      {items.map((item) => (
        <Link key={item.href} href={item.href} className={item.active ? "nav-item active" : "nav-item"}>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

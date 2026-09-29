/**
 * 선 아이콘 몇 개 (Focus 시안의 아이콘 모양을 그대로 옮겼다). 외부 아이콘 글꼴이나 패키지를 쓰지 않는다.
 * 모두 장식이다 — 화면 읽기 프로그램에는 옆의 글자가 읽힌다(aria-hidden).
 */
const PATHS = {
  workspace: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="1.3" />
      <rect x="14" y="3" width="7" height="7" rx="1.3" />
      <rect x="3" y="14" width="7" height="7" rx="1.3" />
      <rect x="14" y="14" width="7" height="7" rx="1.3" />
    </>
  ),
  chat: (
    <>
      <path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-2 2V11.5a9.5 9.5 0 0 1 19 0Z" />
      <path d="M7 9h10M7 13h7" />
    </>
  ),
  inbox: (
    <>
      <path d="m4 4-2 11v5h20v-5L20 4Z" />
      <path d="M2 15h6l2 3h4l2-3h6" />
    </>
  ),
  settings: (
    <>
      <path d="M4 7h16M4 17h16" />
      <circle cx="9" cy="7" r="3" fill="currentColor" />
      <circle cx="16" cy="17" r="3" fill="currentColor" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  check: <path d="m5 12 4 4L19 6" />,
  lock: (
    <>
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </>
  ),
  review: (
    <>
      <path d="M6 3h9l4 4v14H6Z" />
      <path d="m9 13 2 2 4-4M14 3v5h5" />
    </>
  ),
  branch: (
    <>
      <circle cx="6" cy="4" r="2" />
      <circle cx="6" cy="20" r="2" />
      <circle cx="18" cy="6" r="2" />
      <path d="M6 6v12M18 8a10 10 0 0 1-12 9" />
    </>
  ),
  monitor: (
    <>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <path d="M12 17v4M7 21h10" />
    </>
  ),
  off: <path d="m3 3 18 18M3 15v4h14M7 21h10M12 19v2M7 3h14v14" />,
  close: <path d="m6 6 12 12M6 18 18 6" />,
  external: <path d="M14 3h7v7M21 3 11 13M10 3H4v17h17v-6" />,
  github: (
    <path d="M9 19c-5 2-5-3-7-3m14 5v-4c0-1 .5-2 1-2 4-.5 5-3 5-5 0-2-1-3-2-4 0-1 0-2-.5-3-2 0-3 1-4 2-2-.5-4-.5-6 0C8 3 7 3 5 3c-.5 1-.5 2-.5 3-1 1-2 2-2 4 0 3 2 5 6 5 .5 1 .5 2 .5 2v4" />
  ),
  warning: (
    <>
      <path d="m12 3 10 18H2Z" />
      <path d="M12 9v5m0 3v.1" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6m0-10v.1" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5" rx="8" ry="3" />
      <path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
    </>
  ),
  flow: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1" />
      <rect x="15" y="15" width="6" height="6" rx="1" />
      <path d="M6 9v9h9M9 6h9v9" />
    </>
  ),
  agents: (
    <>
      <rect x="4" y="7" width="16" height="14" rx="4" />
      <path d="M12 7V3m-2 10h.01M14 13h.01M9 17h6" />
    </>
  ),
  // ── GitHub 상태 아이콘 줄 (pr-icons.tsx, 시안 v3) ──
  prOpen: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M6 9v6M13 6h3a2 2 0 0 1 2 2v7" />
    </>
  ),
  prMerged: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="12" r="2.6" />
      <path d="M6 9v6M6 9a6 6 0 0 0 6 3h3" />
    </>
  ),
  prClosed: (
    <>
      <circle cx="6" cy="6" r="2.6" />
      <circle cx="6" cy="18" r="2.6" />
      <circle cx="18" cy="18" r="2.6" />
      <path d="M6 9v6M18 11v4M15.5 3.5l5 5m0-5-5 5" />
    </>
  ),
  checksPassing: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8.5 12 2.5 2.5 5-5" />
    </>
  ),
  checksFailing: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m9 9 6 6m0-6-6 6" />
    </>
  ),
  checksPending: <circle cx="12" cy="12" r="9" strokeDasharray="3 3" />,
  dash: <path d="M6 12h12" />,
  reviewApproved: (
    <>
      <path d="M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />
      <path d="m9 9.5 2.5 2.5 4-4" />
    </>
  ),
  reviewChanges: (
    <>
      <path d="M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />
      <path d="M12.5 6.5v4m0 2.5v.1" />
    </>
  ),
  reviewNone: <path d="M21 14a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2Z" />,
  monitorOff: <path d="M17 17H4a2 2 0 0 1-2-2V5c0-1 .5-1.7 1.2-2M9 3h11a2 2 0 0 1 2 2v10M8 21h8M12 17v4M2 2l20 20" />,
  sync: (
    <>
      <path d="M3 5v6h6M21 19v-6h-6" />
      <path d="M5.5 15a7 7 0 0 0 12.4 1.5M18.5 9A7 7 0 0 0 6.1 7.5" />
    </>
  ),
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name }: { name: IconName }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="icon">
      {PATHS[name]}
    </svg>
  );
}

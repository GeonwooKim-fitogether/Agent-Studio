"use client";

import { useEffect } from "react";
import { LAST_WORK_COOKIE } from "../last-work-cookie";

/** 위쪽 메뉴의 Chat 이 다시 열 업무를 기억한다 — 마지막으로 연 업무 하나의 ID 를 쿠키에 둔다(서버가 /chat 에서 읽는다) */
export function RememberWork({ id }: { id: string }) {
  useEffect(() => {
    document.cookie = `${LAST_WORK_COOKIE}=${encodeURIComponent(id)}; path=/; max-age=31536000; samesite=lax`;
  }, [id]);
  return null;
}

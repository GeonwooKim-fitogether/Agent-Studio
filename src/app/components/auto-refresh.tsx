"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

/** 미리보기가 준비되는 동안(코드 받기 · 설치 · 시작) 2초마다 화면을 다시 그린다. 준비가 끝나면 이 조각이 사라져 멈춘다. */
export function AutoRefresh({ everyMs = 2000 }: { everyMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => router.refresh(), everyMs);
    return () => clearInterval(timer);
  }, [router, everyMs]);
  return null;
}

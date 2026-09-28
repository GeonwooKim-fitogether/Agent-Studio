"use client";

import { useEffect } from "react";

/**
 * 하이드레이션(서버가 그린 화면에 브라우저 쪽 React 가 붙는 일)이 끝났음을 `<html data-hydrated="1">` 로 알린다.
 * 미리 채워진 입력칸(메모 Edit · 목표 Edit)은 React 가 붙는 순간 본문을 다시 놓는데, 그 사이에 글을 넣으면
 * 앞뒤가 이어 붙는다(부하가 큰 CI 에서 실측). e2e 는 이 표시를 기다린 뒤 그런 칸에 글을 넣는다.
 */
export function Hydrated() {
  useEffect(() => {
    document.documentElement.dataset["hydrated"] = "1";
  }, []);
  return null;
}

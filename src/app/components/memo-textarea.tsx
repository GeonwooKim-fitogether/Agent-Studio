"use client";

import type { TextareaHTMLAttributes } from "react";

/**
 * 메모 입력칸. 자바스크립트가 있으면 Enter 로 보내고 Shift+Enter 로 줄을 바꾼다(시안 v2).
 * 한글처럼 조합 중인 입력의 Enter 는 글자를 확정하는 것이라 보내지 않는다.
 * 자바스크립트가 없으면 보통의 textarea 다 — Enter 는 줄바꿈이고, 옆 버튼으로 보낸다.
 */
export function MemoTextarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      onKeyDown={(e) => {
        if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        e.currentTarget.form?.requestSubmit();
      }}
    />
  );
}

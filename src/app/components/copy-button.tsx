"use client";

import { useEffect, useState } from "react";

/**
 * 표식 옆의 Copy (feature-plan F5). 브라우저의 클립보드에 글자를 넣는다.
 *
 * 클립보드는 안전한 주소(https 또는 이 컴퓨터의 localhost)에서만 열린다. 휴대전화에서 http 주소로 연 경우처럼 열리지 않으면
 * 그 사실을 버튼 옆에 미리 적고, 누르면 표식 글자를 선택해 두어 사람이 직접 복사하게 한다(결정 7: 동작하지 않는 것을 숨기지 않는다).
 * 자바스크립트가 없으면 이 버튼은 그려지지 않는다 — 누를 수 있는데 아무 일도 하지 않는 버튼을 두지 않기 위해서다. 표식 글자는 그대로 선택할 수 있다.
 */
export function CopyButton({ text, targetId }: { text: string; targetId: string }) {
  const [clipboard, setClipboard] = useState<"unknown" | "available" | "unavailable">("unknown");
  const [result, setResult] = useState<"none" | "copied" | "selected">("none");

  useEffect(() => {
    setClipboard(window.isSecureContext && typeof navigator.clipboard?.writeText === "function" ? "available" : "unavailable");
  }, []);

  if (clipboard === "unknown") return null;

  const selectMarker = () => {
    const element = document.getElementById(targetId);
    const selection = window.getSelection();
    if (element === null || selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const copy = async () => {
    if (clipboard === "available") {
      try {
        await navigator.clipboard.writeText(text);
        setResult("copied");
        return;
      } catch {
        // 권한 거절 등 — 아래에서 글자를 선택해 둔다
      }
    }
    selectMarker();
    setResult("selected");
  };

  const message =
    result === "copied"
      ? "복사했다."
      : result === "selected"
        ? "자동으로 복사하지 못했다 — 표식을 선택해 두었다. 직접 복사한다(Ctrl+C, 휴대전화는 길게 눌러 복사)."
        : clipboard === "unavailable"
          ? "이 주소에서는 브라우저가 자동 복사를 막는다 — Copy 를 누르면 표식을 선택해 두니 직접 복사한다."
          : "";

  return (
    <>
      <button type="button" className="btn" onClick={() => void copy()} data-testid="copy-marker">
        Copy
      </button>
      <span role="status" className="muted copy-status" data-testid="copy-status">
        {message}
      </span>
    </>
  );
}

/**
 * 메모 본문의 규칙 (docs/product/feature-plan.md F8, src/domain/memo.ts). 업무 제목 규칙과 같은 방식이고, 줄바꿈만 받는다.
 */
import { describe, expect, it } from "vitest";
import { checkMemoBody, isAcceptedMemoBody, MAX_MEMO_LENGTH } from "../../src/domain/memo";

const ch = (code: number) => String.fromCodePoint(code);

describe("메모 본문의 규칙", () => {
  it("앞뒤 공백 · 빈 줄을 떼고, 안쪽 줄바꿈은 그대로 받는다. \\r\\n · \\r 은 \\n 으로 맞춘다", () => {
    expect(checkMemoBody("\n  로그인 화면 문구 다시 확인 필요\r\n\r\n둘째 문단\r셋째 줄  \n")).toEqual({
      ok: true,
      body: "로그인 화면 문구 다시 확인 필요\n\n둘째 문단\n셋째 줄",
    });
    expect(checkMemoBody("팀 👩‍💻 온보딩")).toEqual({ ok: true, body: "팀 👩‍💻 온보딩" }); // 결합자(ZWJ)는 막지 않는다
  });

  it("비었거나 공백 · 줄바꿈뿐이면 empty", () => {
    expect(checkMemoBody("")).toEqual({ ok: false, problem: "empty" });
    expect(checkMemoBody(" \r\n\n  ")).toEqual({ ok: false, problem: "empty" });
  });

  it(`${MAX_MEMO_LENGTH}글자(코드 포인트)까지 받고, 넘으면 too_long`, () => {
    expect(checkMemoBody("가".repeat(MAX_MEMO_LENGTH)).ok).toBe(true);
    expect(checkMemoBody("😀".repeat(MAX_MEMO_LENGTH)).ok).toBe(true);
    expect(checkMemoBody("가".repeat(MAX_MEMO_LENGTH + 1))).toEqual({ ok: false, problem: "too_long" });
  });

  it("줄바꿈 밖의 제어 문자 — 탭 · NUL · DEL · C1 · 줄 · 문단 구분자 · 방향 제어 문자 — 는 control_char", () => {
    for (const code of [0x09, 0x00, 0x0b, 0x0c, 0x1b, 0x7f, 0x85, 0x9f, 0x2028, 0x2029, 0x202a, 0x202e, 0x2066, 0x2069]) {
      expect(checkMemoBody(`a${ch(code)}b`), `U+${code.toString(16)}`).toEqual({ ok: false, problem: "control_char" });
    }
  });

  it("저장소는 규칙을 통과하고 이미 맞춰진 본문만 받는다", () => {
    expect(isAcceptedMemoBody("한 줄\n두 줄")).toBe(true);
    expect(isAcceptedMemoBody(" 앞 공백")).toBe(false);
    expect(isAcceptedMemoBody("a\r\nb")).toBe(false);
    expect(isAcceptedMemoBody("")).toBe(false);
    expect(isAcceptedMemoBody(42)).toBe(false);
  });
});

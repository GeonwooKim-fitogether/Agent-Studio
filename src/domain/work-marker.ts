/**
 * 업무 표식 — Studio 가 업무를 만들 때 발급하고, 사용자가 PR 본문이나 브랜치 이름에 넣는 글자 (계약 §4).
 *
 * 형식은 `studio-work-<업무 ID>` 하나다. 업무 ID 는 영문 소문자와 숫자로만 이뤄진다.
 * 표식이 git 브랜치 이름에도 그대로 들어가야 하기 때문이다(콜론 같은 문자는 브랜치 이름에 못 쓴다).
 */

export const MARKER_PREFIX = "studio-work-";

const WORK_ID_PATTERN = /^[a-z0-9]+$/;

/**
 * 글 안에서 표식을 찾는 패턴. 표식은 앞뒤가 "단어 문자" 에 붙어 있으면 표식이 아니다.
 *
 * 단어 문자 = 모든 언어의 글자(\p{L}), 결합 부호(\p{M}), 숫자(\p{N}), 밑줄(_).
 *   - 표식 아님: `xstudio-work-a1`, `_studio-work-a1`, `studio-work-a1_v2`, `studio-work-a1é`, `studio-work-a1B`,
 *               `studio-work-a1에서` (한국어 조사를 띄어 쓰지 않고 붙인 경우도 표식으로 보지 않는다)
 *   - 표식: 하이픈 · 슬래시 · 공백 · 줄바꿈 · 마침표 · 괄호 · 글의 처음과 끝에서 끊긴 것
 *           (예: `feat/studio-work-a1b2c3-login`, `studio-work-a1b2c3.`)
 * 확실할 때만 표식으로 본다. 애매한 것을 놓치면 PR 은 Inbox 로 갈 뿐이지만, 잘못 읽으면 엉뚱한 업무에 붙는다.
 */
const MARKER_IN_TEXT = /(?<![\p{L}\p{M}\p{N}_])studio-work-([a-z0-9]+)(?![\p{L}\p{M}\p{N}_])/gu;

export function isValidWorkId(id: string): boolean {
  return WORK_ID_PATTERN.test(id);
}

/** 업무의 표식 문자열. 업무 화면이 사용자에게 보여 주는 바로 그 글자다. */
export function markerFor(workId: string): string {
  return `${MARKER_PREFIX}${workId}`;
}

/** 주어진 글들(PR 본문, 브랜치 이름) 안의 표식이 가리키는 업무 ID 를 중복 없이, 처음 나온 순서대로 돌려준다. */
export function findMarkedWorkIds(...texts: readonly string[]): string[] {
  const ids = new Set<string>();
  for (const text of texts) {
    for (const match of text.matchAll(MARKER_IN_TEXT)) {
      const id = match[1];
      if (id !== undefined) ids.add(id);
    }
  }
  return [...ids];
}

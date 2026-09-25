/**
 * 업무 표식 — Studio 가 업무를 만들 때 발급하고, 사용자가 PR 본문이나 브랜치 이름에 넣는 글자 (계약 §4).
 *
 * 형식은 `studio-work-<업무 ID>` 하나다. 업무 ID 는 영문 소문자와 숫자로만 이뤄진다.
 * 표식이 git 브랜치 이름에도 그대로 들어가야 하기 때문이다(콜론 같은 문자는 브랜치 이름에 못 쓴다).
 */

export const MARKER_PREFIX = "studio-work-";

const WORK_ID_PATTERN = /^[a-z0-9]+$/;

/**
 * 글 안에서 표식을 찾는 패턴. 표식의 앞뒤가 영문자·숫자에 붙어 있으면 표식으로 보지 않는다.
 * 그래서 `xstudio-work-a1` 이나 `studio-work-a1B` 처럼 다른 낱말의 일부인 것은 걸리지 않고,
 * `feat/studio-work-a1b2c3-login` 처럼 하이픈·슬래시로 끊긴 것은 걸린다.
 */
const MARKER_IN_TEXT = /(?<![A-Za-z0-9])studio-work-([a-z0-9]+)(?![A-Za-z0-9])/g;

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

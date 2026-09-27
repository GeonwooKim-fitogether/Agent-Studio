/**
 * 연결되지 않은 미리보기 실행기. 미리보기 기기를 켜는 설정(PREVIEW_WORKDIR 등)이 없거나 틀렸을 때 조립부가 넣는다.
 * 화면은 이 실행기의 이유 문장을 Open Preview 버튼 옆에 그대로 보인다 (결정 7: 실행되지 않는 버튼을 두지 않는다).
 */
import type { PreviewRunner } from "../../../ports/preview-runner";

export function createOfflinePreviewRunner(reason: string): PreviewRunner {
  return {
    status: () => ({ online: false, reason }),
    start() {
      throw new Error(reason);
    },
    async stop() {},
    current: () => null,
  };
}

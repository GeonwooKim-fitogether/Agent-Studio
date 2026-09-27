/**
 * 미리보기 자식 프로세스의 환경변수와 로그 가림 (docs/plan/04-remote-preview.md §4).
 *
 * 허용 목록 방식이다. Studio 의 환경(GITHUB_* · DATABASE_URL · npm_config_* 등)을 통째로 물려주지 않고,
 * 프로그램이 돌기 위해 꼭 필요한 이름만 골라 복사한 뒤 실행에 필요한 값(PORT 등)을 더한다.
 */

/** 어느 단계든 주는 것: 실행 파일 찾기 · 사용자 폴더 · 임시 폴더 · 언어. Windows 에서 프로그램이 돌려면 필요한 것 몇 개를 포함한다. */
export const BASE_ENV_ALLOWLIST: readonly string[] = [
  "PATH",
  "Path", // Windows 는 이 이름으로 온다
  "PATHEXT",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "SYSTEMROOT",
  "SystemRoot",
  "COMSPEC",
  "TEMP",
  "TMP",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TZ",
];

/** 코드를 받거나 패키지를 설치하는 단계(npm ci)에만 더 주는 것: 사내 프록시와 인증서 */
export const NETWORK_ENV_ALLOWLIST: readonly string[] = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "NO_PROXY",
  "http_proxy",
  "https_proxy",
  "no_proxy",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
];

export type ChildStage = "fetch" | "install" | "run";

/** 자식 프로세스에 줄 환경. parent 는 Studio 의 환경(process.env)이고, extra 는 이 단계에 필요한 값이다. */
export function previewChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  stage: ChildStage,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  const allowed = stage === "run" ? BASE_ENV_ALLOWLIST : [...BASE_ENV_ALLOWLIST, ...NETWORK_ENV_ALLOWLIST];
  const env: Record<string, string> = {};
  for (const name of allowed) {
    const value = parent[name];
    if (value !== undefined) env[name] = value;
  }
  return { ...env, ...extra };
}

const REDACTED = "[가림]";

/**
 * 로그 한 줄에서 비밀처럼 보이는 값을 가린다.
 *   - GitHub 토큰 모양 (ghp_ · gho_ · ghu_ · ghs_ · ghr_ · github_pat_)
 *   - Authorization / Proxy-Authorization 헤더의 값
 *   - 주소 안의 계정 정보 (https://user:pass@host)
 *   - 이름이 TOKEN · SECRET · PASSWORD · KEY 로 끝나는 변수의 값 (FOO_TOKEN=...)
 *   - known 에 준 값 그대로 (예: 이번에 쓴 설치 토큰)
 */
export function redactSecrets(line: string, known: readonly string[] = []): string {
  let out = line;
  for (const secret of known) if (secret.length >= 8) out = out.split(secret).join(REDACTED);
  return out
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,})/g, REDACTED)
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?\S+/gi, `$1${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|_KEY))=\S+/g, `$1=${REDACTED}`);
}

/** 최근 N줄만 들고 있는 로그 꼬리. 줄마다 비밀을 가린 뒤 넣는다. */
export function createLogTail(maxLines: number, known: () => readonly string[] = () => []) {
  const lines: string[] = [];
  let partial = "";
  const push = (line: string) => {
    lines.push(redactSecrets(line.length > 500 ? `${line.slice(0, 500)}…` : line, known()));
    if (lines.length > maxLines) lines.splice(0, lines.length - maxLines);
  };
  return {
    write(chunk: string) {
      const parts = (partial + chunk).split(/\r?\n/);
      partial = parts.pop() ?? "";
      for (const part of parts) push(part);
    },
    note(line: string) {
      push(line);
    },
    lines(): string[] {
      return partial === "" ? [...lines] : [...lines, redactSecrets(partial, known())].slice(-maxLines);
    },
  };
}

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

/**
 * 패키지를 설치하는 단계(npm ci)에만 더 주는 것: 사내 프록시와 인증서.
 * 코드를 풀거나(tar) 로컬 저장소에서 묶는(git archive) 단계는 네트워크가 필요 없으므로 받지 않는다.
 * 프록시 주소에 계정이 들어 있으면(http://user:pass@proxy) 그 계정은 설치 단계의 자식 — 곧 PR 의 설치 스크립트 — 에게 보인다(04 문서 §4).
 */
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

/** fetch = 코드 풀기 · 로컬 저장소 묶기, install = npm ci, run = 앱 실행 */
export type ChildStage = "fetch" | "install" | "run";

/**
 * 자식 프로세스에 줄 환경. parent 는 Studio 의 환경(process.env)이고, extra 는 이 단계에 필요한 값이다.
 * Windows 는 환경변수 이름의 대소문자를 가리지 않아 `PATH` 와 `Path` 가 같은 값으로 함께 잡힌다. 두 이름을 모두 넘기면
 * 자식이 어느 쪽을 쓸지 정해지지 않으므로, Windows 에서는 대소문자만 다른 이름을 처음 것 하나만 남긴다.
 */
export function previewChildEnv(
  parent: Readonly<Record<string, string | undefined>>,
  stage: ChildStage,
  extra: Readonly<Record<string, string>> = {},
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const allowed = stage === "install" ? [...BASE_ENV_ALLOWLIST, ...NETWORK_ENV_ALLOWLIST] : BASE_ENV_ALLOWLIST;
  const env: Record<string, string> = {};
  const seen = new Set<string>();
  for (const name of [...allowed, ...Object.keys(extra)]) {
    const value = name in extra ? extra[name] : parent[name];
    if (value === undefined) continue;
    const key = platform === "win32" ? name.toUpperCase() : name;
    if (seen.has(key)) continue;
    seen.add(key);
    env[name] = value;
  }
  return env;
}

/** 이름이 비밀처럼 보이는 Studio 환경변수 (그 값은 로그에 나타나면 가린다) */
const SECRET_NAME = /TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|_KEY$|^KEY$|DATABASE_URL|_AUTH/i;

/**
 * Studio 환경에서 로그에 나타나면 가려야 할 값들. 비밀처럼 보이는 이름의 값과, 여러 줄 값(비밀 키 파일 내용)이면 그 각 줄.
 * 자식은 이 값을 물려받지 않지만, 같은 운영체제 사용자라 부모 환경을 직접 읽어 찍을 수는 있다(04 문서 §4) — 그때 로그 꼬리로는 새지 않게 한다.
 */
export function knownSecretsOf(parent: Readonly<Record<string, string | undefined>>): string[] {
  const out = new Set<string>();
  for (const [name, value] of Object.entries(parent)) {
    if (value === undefined || !SECRET_NAME.test(name)) continue;
    if (value.length >= 8) out.add(value);
    for (const line of value.split(/\r?\n|\\n/)) if (line.trim().length >= 16) out.add(line.trim());
  }
  return [...out].sort((a, b) => b.length - a.length); // 긴 값부터 가려, 짧은 값이 긴 값의 일부만 가리지 않게 한다
}

const REDACTED = "[가림]";

/**
 * 로그 한 줄에서 비밀처럼 보이는 값을 가린다. 이름 · 헤더 규칙은 대소문자를 가리지 않는다.
 *   - GitHub 토큰 모양 (ghp_ · gho_ · ghu_ · ghs_ · ghr_ · github_pat_), npm 토큰 모양 (npm_ + 20자 이상)
 *   - Authorization / Proxy-Authorization 헤더의 값
 *   - 주소 안의 계정 정보 (https://user:pass@host)
 *   - 이름이 TOKEN · SECRET · PASSWORD · KEY 로 끝나는 변수의 값 (FOO_TOKEN=... · //registry/:_authToken=...)
 *   - JSON 모양의 같은 이름 ("token": "...", "apiKey": "...")
 *   - known 에 준 값 그대로 (예: Studio 환경의 비밀 값)
 */
export function redactSecrets(line: string, known: readonly string[] = []): string {
  let out = line;
  for (const secret of known) if (secret.length >= 8) out = out.split(secret).join(REDACTED);
  return out
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9]{8,}|github_pat_[A-Za-z0-9_]{8,}|npm_[A-Za-z0-9]{20,})/g, REDACTED)
    .replace(/((?:proxy-)?authorization\s*[:=]\s*)(?:(?:bearer|basic|token)\s+)?\S+/gi, `$1${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${REDACTED}@`)
    .replace(/(_authToken\s*=\s*)\S+/gi, `$1${REDACTED}`)
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|_KEY))=\S+/gi, `$1=${REDACTED}`)
    .replace(/("[A-Za-z0-9_-]*(?:token|secret|password|passwd|apikey|api_key|_key)"\s*:\s*)"(?:[^"\\]|\\.)*"/gi, `$1"${REDACTED}"`);
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

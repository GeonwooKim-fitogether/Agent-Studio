/**
 * 로컬 git 저장소에서 커밋 하나의 코드를 받는다 — 시연 · 시험용 (PREVIEW_LOCAL_REPOS_DIR, docs/plan/04-remote-preview.md §3).
 *
 * 저장소 `owner/name` 은 `<dir>/<owner>/<name>` 폴더의 git 저장소로 찾는다. 네트워크를 쓰지 않는다.
 * 받는 방법은 `git archive <전체 SHA>` 이고, 그 SHA 가 커밋인지 먼저 확인한다.
 */
import { execFile } from "node:child_process";
import { join, resolve, sep } from "node:path";
import { isFullSha, isSafeRepoFullName } from "../../../domain/preview";
import { previewChildEnv } from "./child-env";
import { type CodeSource, CodeSourceError, MAX_ARCHIVE_BYTES } from "./code-source";

function git(
  args: readonly string[],
  cwd: string,
  env: Record<string, string>,
  encoding: "buffer" | "utf8",
  signal: AbortSignal | undefined,
): Promise<Buffer | string> {
  return new Promise((done, fail) => {
    const options = { cwd, env: env as NodeJS.ProcessEnv, encoding, maxBuffer: MAX_ARCHIVE_BYTES, windowsHide: true, timeout: GIT_TIMEOUT_MS, signal };
    execFile("git", [...args], options, (error, stdout) => {
      if (error !== null) fail(error);
      else done(stdout);
    });
  });
}

/** git 한 번의 시간 상한 */
const GIT_TIMEOUT_MS = 2 * 60 * 1000;

export function createLocalRepoSource(reposDir: string, parentEnv: Readonly<Record<string, string | undefined>>): CodeSource {
  const root = resolve(reposDir);
  const env = previewChildEnv(parentEnv, "fetch", { GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_NOSYSTEM: "1" });
  return {
    label: "local repositories",
    async archive(target, archiveOptions = {}) {
      if (!isFullSha(target.commitSha) || !isSafeRepoFullName(target.repoFullName)) {
        throw new CodeSourceError("받을 커밋이나 저장소 이름이 올바른 모양이 아니다.");
      }
      const [owner = "", name = ""] = target.repoFullName.split("/");
      const repoDir = join(root, owner, name);
      if (!repoDir.startsWith(root + sep)) throw new CodeSourceError("저장소 폴더가 PREVIEW_LOCAL_REPOS_DIR 밖을 가리킨다.");
      let kind: string;
      try {
        kind = String(await git(["cat-file", "-t", target.commitSha], repoDir, env, "utf8", archiveOptions.signal)).trim();
      } catch {
        throw new CodeSourceError(`로컬 저장소 ${target.repoFullName} 에 커밋 ${target.commitSha.slice(0, 7)} 이 없다.`);
      }
      if (kind !== "commit") throw new CodeSourceError(`${target.commitSha.slice(0, 7)} 은 커밋이 아니다.`);
      try {
        const bytes = await git(["archive", "--format=tar", target.commitSha], repoDir, env, "buffer", archiveOptions.signal);
        return { bytes: new Uint8Array(bytes as Buffer), gzip: false, stripComponents: 0 };
      } catch {
        throw new CodeSourceError(`로컬 저장소 ${target.repoFullName} 에서 코드를 묶지 못했다.`);
      }
    },
  };
}

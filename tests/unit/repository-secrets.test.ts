/**
 * 저장소 파일에 비밀 키가 없다 (docs/plan/03-github-app.md §4 의 4).
 * git 이 추적하는 파일과, 무시되지 않은 새 파일을 모두 읽어 PEM 비밀 키 머리글이 없는지 본다.
 * 시험용 키는 시험 안에서 만들고 파일로 남기지 않는다. .pem 파일은 .gitignore 가 막는다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

// 이 시험 파일 자신이 걸리지 않도록 머리글을 조각으로 만든다
const PEM_HEADER = new RegExp(["-----BEGIN", "(RSA |EC |OPENSSH |ENCRYPTED )?", "PRIVATE KEY-----"].join(" ?"));

describe("저장소의 비밀", () => {
  it("추적되거나 새로 더해질 파일 어디에도 PEM 비밀 키가 없다", () => {
    const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { encoding: "utf8" })
      .split("\n")
      .filter((f) => f !== "" && !f.startsWith("node_modules/"));
    expect(files.length).toBeGreaterThan(50);
    const offenders = files.filter((file) => {
      try {
        if (statSync(file).size > 2_000_000) return false;
        return PEM_HEADER.test(readFileSync(file, "utf8"));
      } catch {
        return false; // 지워진 파일 등
      }
    });
    expect(offenders).toEqual([]);
  });

  it(".pem 파일은 git 이 무시한다", () => {
    const ignored = execFileSync("git", ["check-ignore", "-v", "secrets/agent-studio.pem"], { encoding: "utf8" });
    expect(ignored).toContain("*.pem");
  });
});

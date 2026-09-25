/**
 * 클린 아키텍처의 경계를 소스 스캔으로 확인한다 (docs/plan/01-pr-collection.md §2, §4 "구조를 기계가 지킨다").
 *
 *   src/domain      → src/domain 만 import 할 수 있다 (외부 패키지 · node: 모듈 · Next.js 전부 금지)
 *   src/application → src/domain · src/application · src/ports 만
 *   src/ports       → src/domain · src/ports 만
 *
 * 상대 경로가 아닌 import(패키지 이름, node:fs, "@/..." 같은 별칭)는 그 자체로 위반이다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const RULES = [
  { layer: "src/domain", allowed: ["src/domain"] },
  { layer: "src/application", allowed: ["src/domain", "src/application", "src/ports"] },
  { layer: "src/ports", allowed: ["src/domain", "src/ports"] },
] as const;

/** 소스 안의 모든 import 대상 문자열. 정적 import · export from · 부작용 import · 동적 import() · require() 를 모두 찾는다. */
export function importSpecifiers(source: string): string[] {
  const patterns = [
    /\b(?:import|export)\s+(?:type\s+)?[^'"`;]*?\bfrom\s*['"]([^'"]+)['"]/g,
    /\bimport\s*['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
    /\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g,
  ];
  return patterns.flatMap((re) => [...source.matchAll(re)].map((m) => m[1] ?? ""));
}

/** 파일 하나의 위반 목록. 허용된 폴더 밖을 가리키는 import 를 돌려준다. */
export function violationsOf(file: string, source: string, allowed: readonly string[]): string[] {
  return importSpecifiers(source).filter((spec) => {
    if (!spec.startsWith(".")) return true;
    const target = relative(ROOT, resolve(dirname(file), spec)).split(sep).join("/");
    return !allowed.some((dir) => target === dir || target.startsWith(`${dir}/`));
  });
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(entry.name) ? [full] : [];
  });
}

describe("아키텍처 경계", () => {
  for (const rule of RULES) {
    it(`${rule.layer} 는 ${rule.allowed.join(", ")} 밖을 import 하지 않는다`, () => {
      const files = sourceFiles(join(ROOT, rule.layer));
      expect(files.length, `${rule.layer} 에 검사할 파일이 있어야 한다`).toBeGreaterThan(0);
      const problems = files.flatMap((file) =>
        violationsOf(file, readFileSync(file, "utf8"), rule.allowed).map((spec) => `${relative(ROOT, file)} → ${spec}`),
      );
      expect(problems).toEqual([]);
    });
  }

  it("스캐너 자체 시험: 금지된 import 를 실제로 잡는다", () => {
    const file = join(ROOT, "src/domain/example.ts");
    const source = [
      'import Link from "next/link";',
      'import { readFileSync } from "node:fs";',
      'import type { GitHubReader } from "../ports/github-reader";',
      "import {\n  createMemoryStore,\n} from '../adapters/store/memory/memory-store';",
      'export { x } from "@/somewhere";',
      'import "server-only";',
      'const m = await import("react");',
      'const r = require("pg");',
      'import { prKey } from "./model";',
    ].join("\n");
    expect(violationsOf(file, source, ["src/domain"])).toEqual([
      "next/link",
      "node:fs",
      "../ports/github-reader",
      "../adapters/store/memory/memory-store",
      "@/somewhere",
      "server-only",
      "react",
      "pg",
    ]);
  });
});

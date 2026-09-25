/**
 * 클린 아키텍처의 경계를 소스 스캔으로 확인한다 (docs/plan/01-pr-collection.md §2, §4 "구조를 기계가 지킨다").
 *
 *   src/domain      → src/domain 만 import 할 수 있다 (외부 패키지 · node: 모듈 · Next.js 전부 금지)
 *   src/application → src/domain · src/application · src/ports 만
 *   src/ports       → src/domain · src/ports 만
 *
 * 그리고 세 층 모두 바깥 세계에 닿는 전역(fetch · XMLHttpRequest · WebSocket · EventSource · process)을 쓰지 않는다.
 * 바깥 세계와는 포트로만 닿기 때문이다.
 *
 * 정규식이 아니라 TypeScript 컴파일러로 소스를 구문 트리로 읽는다. 그래서 주석이나 문자열 안의 글자에 속지 않고,
 * 백틱으로 쓴 import(`x`) · require(`x`), 타입 위치의 import("x"), 문자열이 아닌 동적 import 까지 잡는다.
 * 상대 경로가 아닌 import(패키지 이름, node:fs, "@/..." 같은 별칭)는 그 자체로 위반이다.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

const RULES = [
  { layer: "src/domain", allowed: ["src/domain"] },
  { layer: "src/application", allowed: ["src/domain", "src/application", "src/ports"] },
  { layer: "src/ports", allowed: ["src/domain", "src/ports"] },
] as const;

/** 검사할 소스 파일의 확장자. .mts · .cts 도 포함한다. */
export const isSourceFile = (name: string) => /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(name);

const FORBIDDEN_GLOBALS = new Set(["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "process"]);
const GLOBAL_OBJECTS = new Set(["globalThis", "window", "self", "global"]);
export const NON_LITERAL_IMPORT = "<문자열이 아닌 동적 import>";

interface ScanResult {
  /** import 대상 문자열 (문자열이 아닌 동적 import 는 NON_LITERAL_IMPORT) */
  readonly specifiers: string[];
  /** 바깥 세계에 닿는 전역 사용 */
  readonly globals: string[];
}

function literalText(node: ts.Node | undefined): string | undefined {
  return node !== undefined && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) ? node.text : undefined;
}

/** 이 식별자가 무언가의 "이름" 자리(속성 이름, 선언 이름)에 있어 전역 참조가 아닌가 */
function isNamePosition(node: ts.Identifier): boolean {
  const p = node.parent;
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true;
  if (ts.isQualifiedName(p) && p.right === node) return true;
  const named =
    ts.isPropertyAssignment(p) ||
    ts.isPropertySignature(p) ||
    ts.isPropertyDeclaration(p) ||
    ts.isMethodDeclaration(p) ||
    ts.isMethodSignature(p) ||
    ts.isVariableDeclaration(p) ||
    ts.isParameter(p) ||
    ts.isFunctionDeclaration(p) ||
    ts.isBindingElement(p);
  return named && (p as { name?: ts.Node }).name === node;
}

export function scanSource(fileName: string, source: string): ScanResult {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const specifiers: string[] = [];
  const globals: string[] = [];

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier !== undefined) {
      specifiers.push(literalText(node.moduleSpecifier) ?? NON_LITERAL_IMPORT);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      specifiers.push(literalText(node.moduleReference.expression) ?? NON_LITERAL_IMPORT);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      specifiers.push(literalText(node.argument.literal) ?? NON_LITERAL_IMPORT);
    } else if (ts.isCallExpression(node)) {
      const callee = node.expression;
      const isImport = callee.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(callee) && callee.text === "require";
      if (isImport || isRequire) specifiers.push(literalText(node.arguments[0]) ?? NON_LITERAL_IMPORT);
    }

    if (ts.isIdentifier(node) && FORBIDDEN_GLOBALS.has(node.text) && !isNamePosition(node)) {
      globals.push(node.text);
    } else if (
      ts.isPropertyAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text) &&
      FORBIDDEN_GLOBALS.has(node.name.text)
    ) {
      globals.push(`${node.expression.text}.${node.name.text}`);
    } else if (
      ts.isElementAccessExpression(node) &&
      ts.isIdentifier(node.expression) &&
      GLOBAL_OBJECTS.has(node.expression.text)
    ) {
      const key = literalText(node.argumentExpression);
      if (key !== undefined && FORBIDDEN_GLOBALS.has(key)) globals.push(`${node.expression.text}.${key}`);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { specifiers, globals };
}

/** 파일 하나의 위반 목록. 허용된 폴더 밖을 가리키는 import 와 금지된 전역 사용을 돌려준다. */
export function violationsOf(file: string, source: string, allowed: readonly string[]): string[] {
  const { specifiers, globals } = scanSource(file, source);
  const badImports = specifiers.filter((spec) => {
    if (!spec.startsWith(".")) return true;
    const target = relative(ROOT, resolve(dirname(file), spec)).split(sep).join("/");
    return !allowed.some((dir) => target === dir || target.startsWith(`${dir}/`));
  });
  return [...badImports, ...globals.map((g) => `global:${g}`)];
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return isSourceFile(entry.name) ? [full] : [];
  });
}

describe("아키텍처 경계", () => {
  for (const rule of RULES) {
    it(`${rule.layer} 는 ${rule.allowed.join(", ")} 밖을 import 하지 않고, 바깥 세계에 닿는 전역을 쓰지 않는다`, () => {
      const files = sourceFiles(join(ROOT, rule.layer));
      expect(files.length, `${rule.layer} 에 검사할 파일이 있어야 한다`).toBeGreaterThan(0);
      const problems = files.flatMap((file) =>
        violationsOf(file, readFileSync(file, "utf8"), rule.allowed).map((v) => `${relative(ROOT, file)} → ${v}`),
      );
      expect(problems).toEqual([]);
    });
  }

  it("스캐너 자체 시험: 금지된 import 와 전역 사용을 실제로 잡는다", () => {
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
      "const t = await import(`next/navigation`);", // 백틱
      "const u = require(`undici`);", // 백틱
      'import { a, /* ; */ b } from "next/headers";', // 중괄호 안 주석의 세미콜론
      'import { c, // ; 줄 끝 주석\n  d } from "next/cache";',
      "const name = 'react-dom'; const v = await import(name);", // 문자열이 아닌 동적 import
      'type Config = import("next").NextConfig;', // 타입 위치의 import
      'fetch("https://example.com");', // 전역 fetch
      'globalThis.fetch("https://example.com");',
      'globalThis["fetch"]("https://example.com");',
      "new XMLHttpRequest();",
      "const env = process.env.GITHUB_TOKEN;",
      'import { prKey } from "./model";', // 허용
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
      "next/navigation",
      "undici",
      "next/headers",
      "next/cache",
      NON_LITERAL_IMPORT,
      "next",
      "global:fetch",
      "global:globalThis.fetch",
      "global:globalThis.fetch",
      "global:XMLHttpRequest",
      "global:process",
    ]);
  });

  it("스캐너 자체 시험: 주석 · 문자열 · 속성 이름에는 속지 않는다", () => {
    const file = join(ROOT, "src/application/example.ts");
    const source = [
      '// import x from "pg";',
      '/* const y = require("pg"); */',
      "const s = \"import z from 'pg'\";",
      "interface Port { fetch(url: string): Promise<unknown>; process: number }",
      "const deps = { reader: { fetch: async () => 1 } }; await deps.reader.fetch();",
      'import { syncAll } from "./sync";',
      'import type { StudioStore } from "../ports/studio-store";',
    ].join("\n");
    expect(violationsOf(file, source, ["src/domain", "src/application", "src/ports"])).toEqual([]);
  });

  it("스캐너 자체 시험: .mts · .cts 파일도 검사 대상이다", () => {
    for (const name of ["a.ts", "a.tsx", "a.mts", "a.cts", "a.js", "a.jsx", "a.mjs", "a.cjs"]) expect(isSourceFile(name)).toBe(true);
    for (const name of ["a.css", "a.md", "a.json"]) expect(isSourceFile(name)).toBe(false);
    expect(violationsOf(join(ROOT, "src/domain/x.mts"), 'import "next/link";', ["src/domain"])).toEqual(["next/link"]);
  });
});

/**
 * API 規格（docs/openapi.json）不能跟程式碼漂開。
 *
 * 文件的價值在於「照它實作就能接上本站」；程式碼多打了一條上游路徑而規格沒寫，文件就在說謊。
 * 這裡把站台前端、站台伺服器、舞台端點表裡每一條 /open/v1 與 /oauth 路徑撈出來，逐條要求
 * 在規格檔的 paths 裡出現。路徑參數的寫法統一成 {name}（程式碼裡是 ${…}、{…} 或 :name）。
 * 總覽（docs/developers.md）另外要列出前端會翻譯的錯誤碼。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const spec = JSON.parse(readFileSync(at("../../docs/openapi.json"), "utf8")) as { openapi: string; paths: Record<string, Record<string, unknown>> };
const overview = readFileSync(at("../../docs/developers.md"), "utf8");
const specPaths = new Set(Object.keys(spec.paths));

/** 程式碼裡出現的上游路徑，正規化後去重。 */
function pathsIn(source: string): string[] {
  const found = new Set<string>();
  // 舞台端點表把前綴收成常數（`${V1}/conversation/start`）：先展開，否則只會撈到註解裡那個 /open/v1/...
  const expanded = source.replace(/\$\{V1\}/g, "/open/v1");
  const re = /(\/(?:open\/v1|oauth)\/[A-Za-z0-9_\-/.${}():]+)/g;
  for (const m of expanded.matchAll(re)) {
    let p = m[1]!;
    if (p.includes("...")) continue; // 註解裡的「/open/v1/...」不是端點
    p = p.replace(/\$\{encodeURIComponent\((\w+)\)\}/g, "{$1}").replace(/\$\{(\w+)\}/g, "{$1}").replace(/:(\w+)/g, "{$1}");
    p = p.replace(/[?#].*$/, "").replace(/[`'"),]+$/, "").replace(/\/+$/, "");
    found.add(p);
  }
  return [...found].sort();
}

/** 規格裡的路徑參數名字可能跟程式碼不同（{roleId} vs {id}）：只比對形狀。 */
const shape = (p: string) => p.replace(/\{[^}]+\}/g, "{}");
const specShapes = new Set([...specPaths].map(shape));
const specHas = (p: string) => specPaths.has(p) || specShapes.has(shape(p));

/** 來源檔與「至少要撈到幾條」：撈到太少代表抽取壞了（例如常數前綴沒展開），不是程式碼真的只打那幾條。 */
const SOURCES: Record<string, { file: string; atLeast: number }> = {
  "站台前端 api.ts": { file: at("../src/lib/api.ts"), atLeast: 30 },
  "站台前端 oauth.ts": { file: at("../src/lib/oauth.ts"), atLeast: 3 },
  "站台伺服器 upstream.ts": { file: at("../../src/upstream.ts"), atLeast: 5 },
  "舞台端點表": { file: at("../../stage/src/config/request-url.js"), atLeast: 40 },
};

describe("API 規格涵蓋程式碼打的每一條上游路徑", () => {
  it("規格檔是 OpenAPI 3.1 而且有東西", () => {
    expect(spec.openapi.startsWith("3.1")).toBe(true);
    expect(specPaths.size).toBeGreaterThan(90);
  });

  for (const [label, { file, atLeast }] of Object.entries(SOURCES)) {
    it(label, () => {
      const paths = pathsIn(readFileSync(file, "utf8"));
      expect(paths.length).toBeGreaterThanOrEqual(atLeast);
      // /image/{path} 是站台前端的共用小工具，實際子路徑在下面另外逐條看
      const missing = paths.filter((p) => p !== "/open/v1/image/{path}" && !specHas(p));
      expect(missing, `規格缺了這些路徑：\n${missing.join("\n")}`).toEqual([]);
    });
  }

  it("素材庫的子路徑逐條在規格裡", () => {
    const api = readFileSync(SOURCES["站台前端 api.ts"]!.file, "utf8");
    const subs = [...api.matchAll(/libraryPost\("([a-zA-Z/]+)"/g)].map((m) => `/open/v1/image/${m[1]}`);
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.filter((p) => !specHas(p))).toEqual([]);
  });

  it("每個端點都有摘要、回應，而且參數與請求本體的每個欄位都有型別", () => {
    const problems: string[] = [];
    const walk = (node: unknown, where: string) => {
      if (!node || typeof node !== "object") return;
      const s = node as Record<string, unknown>;
      if (s.$ref) return;
      if (s.properties && typeof s.properties === "object") {
        for (const [k, v] of Object.entries(s.properties as Record<string, unknown>)) {
          const p = v as Record<string, unknown>;
          if (!p.$ref && !p.type && !p.oneOf && !p.anyOf && !p.allOf) problems.push(`${where}.${k}: no type`);
          walk(v, `${where}.${k}`);
        }
      }
      if (s.items) walk(s.items, `${where}[]`);
    };
    for (const [path, item] of Object.entries(spec.paths)) {
      for (const [method, opRaw] of Object.entries(item)) {
        const op = opRaw as { summary?: string; responses?: Record<string, unknown>; parameters?: { name: string; schema?: unknown }[]; requestBody?: { content?: Record<string, { schema?: unknown }> } };
        const where = `${method.toUpperCase()} ${path}`;
        if (!op.summary) problems.push(`${where}: no summary`);
        if (!op.responses || !Object.keys(op.responses).length) problems.push(`${where}: no responses`);
        for (const p of op.parameters ?? []) if (!p.schema) problems.push(`${where} param ${p.name}: no schema`);
        for (const mt of Object.values(op.requestBody?.content ?? {})) walk(mt.schema, `${where} body`);
      }
    }
    expect(problems, problems.join("\n")).toEqual([]);
  });

  it("總覽寫的錯誤碼，前端翻譯表裡有的都在", () => {
    const api = readFileSync(SOURCES["站台前端 api.ts"]!.file, "utf8");
    // 只看供應商的那張表（CODE_KEY）；本站自己 API 的碼（SITE_CODE_KEY）不是供應商契約
    const block = api.slice(api.indexOf("const CODE_KEY"), api.indexOf("};", api.indexOf("const CODE_KEY")));
    const codes = [...block.matchAll(/^\s+([a-z_]+): "(?:error|state)\.[a-zA-Z]+",$/gm)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(3);
    expect(codes.filter((c) => c !== "invalid_argument" && !overview.includes(`\`${c}\``))).toEqual([]);
  });
});

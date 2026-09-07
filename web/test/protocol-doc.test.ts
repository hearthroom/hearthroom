/**
 * 相容供應商協議文件（docs/provider-protocol.md）不能跟程式碼漂開。
 *
 * 文件的價值在於「照它實作就能接上本站」；程式碼多打了一條上游路徑而文件沒寫，文件就在說謊。
 * 這裡把站台前端、站台伺服器、舞台端點表裡每一條 /open/v1 與 /oauth 路徑撈出來，逐條要求
 * 在文件裡出現。路徑參數的寫法統一成 :name（程式碼裡是 ${…} 或 {…}）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const at = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const doc = readFileSync(at("../../docs/provider-protocol.md"), "utf8");

/** 程式碼裡出現的上游路徑，正規化後去重。 */
function pathsIn(source: string): string[] {
  const found = new Set<string>();
  const re = /(\/(?:open\/v1|oauth)\/[A-Za-z0-9_\-/.${}():]+)/g;
  for (const m of source.matchAll(re)) {
    let p = m[1]!;
    p = p.replace(/\$\{encodeURIComponent\((\w+)\)\}/g, ":$1").replace(/\$\{(\w+)\}/g, ":$1").replace(/\{(\w+)\}/g, ":$1");
    p = p.replace(/[?#].*$/, "").replace(/[`'"),]+$/, "").replace(/\/+$/, "");
    found.add(p);
  }
  return [...found].sort();
}

/** 文件裡的每條路徑，同樣正規化：`/comment/like` 這種省略前綴的續寫也算（同一格內接在完整路徑後面）。 */
function docHas(path: string): boolean {
  if (doc.includes(`\`${path}\``) || doc.includes(`\`${path}?`) || doc.includes(`${path}\``) || doc.includes(`${path}?`)) return true;
  // 表格裡用「`POST /open/v1/comment`、`/comment/like`」省寫後面的：拿掉前綴再找
  const short = path.replace(/^\/open\/v1/, "");
  return doc.includes(`\`${short}\``) || doc.includes(`\`${short}?`);
}

const SOURCES: Record<string, string> = {
  "站台前端 api.ts": at("../src/lib/api.ts"),
  "站台前端 oauth.ts": at("../src/lib/oauth.ts"),
  "站台伺服器 upstream.ts": at("../../src/upstream.ts"),
  "舞台端點表": at("../../stage/src/config/request-url.js"),
};

describe("供應商協議文件涵蓋程式碼打的每一條上游路徑", () => {
  for (const [label, file] of Object.entries(SOURCES)) {
    it(label, () => {
      const paths = pathsIn(readFileSync(file, "utf8"));
      expect(paths.length).toBeGreaterThan(0);
      // /image/:path 是站台前端的共用小工具，實際子路徑在文件裡逐條列，這裡看那些子路徑
      const missing = paths.filter((p) => p !== "/open/v1/image/:path" && !docHas(p));
      expect(missing, `文件缺了這些路徑：\n${missing.join("\n")}`).toEqual([]);
    });
  }

  it("素材庫的子路徑逐條在文件裡", () => {
    const api = readFileSync(SOURCES["站台前端 api.ts"]!, "utf8");
    const subs = [...api.matchAll(/libraryPost\("([a-zA-Z/]+)"/g)].map((m) => `/open/v1/image/${m[1]}`);
    expect(subs.length).toBeGreaterThan(0);
    expect(subs.filter((p) => !docHas(p))).toEqual([]);
  });

  it("文件寫的錯誤碼，前端翻譯表裡有的都在", () => {
    const api = readFileSync(SOURCES["站台前端 api.ts"]!, "utf8");
    const codes = [...api.matchAll(/^\s+([a-z_]+): "(?:error|state)\.[a-zA-Z]+",$/gm)].map((m) => m[1]!);
    expect(codes.length).toBeGreaterThan(3);
    expect(codes.filter((c) => c !== "invalid_argument" && !doc.includes(`\`${c}\``))).toEqual([]);
  });
});

/**
 * 給 AI agent 讀的文件原文，建置時產進 dist/，由資源層直接出（不進 Worker）。
 *
 * 為什麼要另外產：/guide 與 /developers 頁面把 docs/*.md 打包進前端程式，網址上沒有 Markdown 原文，
 * agent 抓到的只是 SPA 殼。llms.txt 規範的做法是每個文件頁有一個同路徑加 .md 的孿生檔，另加一份把
 * 全部接起來的 /llms-full.txt。語言跟著網址前綴走（預設語言不帶前綴），跟 router 一致。
 *
 * 純函式 llmsDocs() 負責「產哪些路徑、裝什麼」；vite 外掛只是把它們寫進 dist（dev 時從記憶體出）。
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Plugin } from "vite";
import { PRIMARY_HOST } from "../../shared/site-hosts";

/** 倉根：由本檔位置推；測試環境（happy-dom）的 import.meta.url 不是 file:，就從工作目錄往上找到 docs/。 */
function repoRoot(): string {
  if (import.meta.url.startsWith("file:")) return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  let dir = process.cwd();
  while (!existsSync(resolve(dir, "docs/community-openapi.json"))) {
    const parent = dirname(dir);
    if (parent === dir) throw new Error("hearthroom repository root not found");
    dir = parent;
  }
  return dir;
}
const ROOT = repoRoot();
const read = (rel: string) => readFileSync(resolve(ROOT, rel.startsWith("public/") ? `web/${rel}` : `docs/${rel}`), "utf8");

/** 語言 → 網址前綴。順序與網站相同：繁中是預設語言，網址不帶前綴。 */
const LOCALES: ReadonlyArray<readonly [locale: string, prefix: string]> = [
  ["zh-Hant", ""], ["zh-Hans", "zh-Hans/"], ["en", "en/"], ["ja", "ja/"], ["ko", "ko/"],
];
const developersSource = (locale: string) => (locale === "en" ? "developers.md" : `developers/${locale}.md`);

export interface LlmsDoc { path: string; content: string; contentType: string }

const MD = "text/markdown; charset=utf-8";
const JSON_TYPE = "application/json; charset=utf-8";
const TEXT = "text/plain; charset=utf-8";

// 頁面上開發者文件會把兩份 OpenAPI 展開成端點列表；Markdown 孿生檔沒有那一段，所以補上原檔位置。
const REFERENCE = [
  "",
  "## OpenAPI sources",
  "",
  `- Community API: https://${PRIMARY_HOST}/developers/community-openapi.json`,
  `- Service integration API: https://${PRIMARY_HOST}/developers/integration-openapi.json`,
  "",
].join("\n");

export function llmsDocs(): LlmsDoc[] {
  const docs: LlmsDoc[] = [];
  for (const [locale, prefix] of LOCALES) {
    docs.push({ path: `${prefix}guide.md`, content: read(`guide/card-authoring.${locale}.md`), contentType: MD });
    docs.push({ path: `${prefix}developers.md`, content: read(developersSource(locale)).trimEnd() + "\n" + REFERENCE, contentType: MD });
  }
  // 「讓 AI Agent 幫你寫卡」按鈕複製的那句話叫 Agent 讀這份照做：裝 CLI、裝寫卡技能、登入。
  // 只出英文、不分語言前綴：Agent 什麼語言都讀，英文最省 token；回話語言由使用者那句話決定。
  docs.push({ path: "agent-setup.md", content: read("guide/agent-setup.md"), contentType: MD });
  docs.push({ path: "developers/community-openapi.json", content: read("community-openapi.json"), contentType: JSON_TYPE });
  docs.push({ path: "developers/integration-openapi.json", content: read("integration-openapi.json"), contentType: JSON_TYPE });
  // 全文版：索引在前，接英文開發者文件與寫卡指南。OpenAPI 太大，留連結就好。
  const full = [read("public/llms.txt"), read("developers.md"), read("guide/card-authoring.en.md")].map(s => s.trimEnd()).join("\n\n---\n\n") + "\n";
  docs.push({ path: "llms-full.txt", content: full, contentType: TEXT });
  return docs;
}

export const LLMS_DOC_PATHS: readonly string[] = llmsDocs().map(d => d.path);

/**
 * 資源層的 _headers：替這些檔補上 charset。沒有 charset 的 text/plain 會讓瀏覽器自己猜編碼
 * （繁中系統猜 Big5），整頁中日韓文字都變亂碼（owner 2026-09-29 在瀏覽器開 /llms.txt 看到）。
 * 一條路徑一條規則，不用萬用字元，避免猜 Cloudflare 的樣式語法。
 */
export function llmsHeaders(): string {
  const rules = [{ path: "llms.txt", contentType: TEXT }, ...llmsDocs()].map(d => `/${d.path}\n  Content-Type: ${d.contentType}`);
  return rules.join("\n\n") + "\n";
}

/** 建置時寫進 dist；dev server 直接從記憶體回，讓本機也能對 /en/guide.md 這種網址驗。 */
export function llmsDocsPlugin(): Plugin {
  return {
    name: "hearthroom:llms-docs",
    generateBundle() {
      for (const d of llmsDocs()) this.emitFile({ type: "asset", fileName: d.path, source: d.content });
      this.emitFile({ type: "asset", fileName: "_headers", source: llmsHeaders() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0]!.replace(/^\//, "");
        const doc = LLMS_DOC_PATHS.includes(path) ? llmsDocs().find(d => d.path === path) : undefined;
        if (!doc) return next();
        res.setHeader("Content-Type", doc.contentType);
        res.end(doc.content);
      });
    },
  };
}

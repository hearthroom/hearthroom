#!/usr/bin/env node
/**
 * 把這一版的 web/dist/assets/* 寫進 ASSET_ARCHIVE（KV），30 天到期。deploy 前跑。
 *
 * 舊部署的 hash 檔在資源層會消失，Worker 對 /assets/* 找不到時回退讀這裡（src/index.ts）。
 * key 是路徑（/assets/xxx.js），metadata 帶 content-type，值用 base64 交給 wrangler kv bulk put。
 * 只歸檔 assets/ 底下的 hash 檔；index.html 不歸檔——它必須永遠是當前版。
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const dir = path.resolve("web/dist/assets");
const TTL = 30 * 24 * 3600;
const TYPES = { ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".map": "application/json",
  ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".json": "application/json" };

const entries = readdirSync(dir).filter((f) => statSync(path.join(dir, f)).isFile()).map((f) => ({
  key: `/assets/${f}`,
  value: readFileSync(path.join(dir, f)).toString("base64"),
  base64: true,
  expiration_ttl: TTL,
  metadata: { contentType: TYPES[path.extname(f).toLowerCase()] ?? "application/octet-stream" },
}));
if (!entries.length) { console.error("archive-assets: web/dist/assets 是空的，先 build"); process.exit(1); }

const file = path.join(mkdtempSync(path.join(tmpdir(), "hearthroom-assets-")), "bulk.json");
writeFileSync(file, JSON.stringify(entries));
execFileSync("npx", ["wrangler", "kv", "bulk", "put", file, "--binding", "ASSET_ARCHIVE", "--remote"], { stdio: "inherit" });
const bytes = entries.reduce((n, e) => n + Buffer.byteLength(e.value, "base64"), 0);
console.log(`archive-assets: ${entries.length} 個檔、${(bytes / 1048576).toFixed(1)} MB 已歸檔，${TTL / 86400} 天到期`);

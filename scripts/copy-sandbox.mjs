#!/usr/bin/env node
/**
 * 把上游的沙箱殼（stage/dist-sandbox/，`npm --prefix stage run build:sandbox` 的產物）複製到
 * web/public/sandbox/，讓前端 build 把它帶進資源層。Worker 在 c<roleId>.<站台> 子網域上把它出成殼頁（src/sandbox.ts）。
 *
 * 產物固定三個檔：index.html、sandbox.js、sandbox.css。少一個就失敗，免得半套殼上線。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const from = path.join(root, "stage", "dist-sandbox");
const to = path.join(root, "web", "public", "sandbox");

for (const f of ["index.html", "sandbox.js", "sandbox.css"]) {
  if (!existsSync(path.join(from, f))) {
    console.error(`copy-sandbox: 缺 ${path.relative(root, path.join(from, f))}，先跑 npm --prefix stage run build:sandbox`);
    process.exit(1);
  }
}
rmSync(to, { recursive: true, force: true });
mkdirSync(to, { recursive: true });
let n = 0;
for (const f of readdirSync(from)) {
  const src = path.join(from, f);
  if (!statSync(src).isFile()) continue;
  copyFileSync(src, path.join(to, f));
  n++;
}
console.log(`copy-sandbox: ${n} 個檔 → ${path.relative(root, to)}`);

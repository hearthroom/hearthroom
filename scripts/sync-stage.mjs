#!/usr/bin/env node
/**
 * 把 stage/（上游 Moonstage 的子模組）更新到上游 main：拉最新、裝依賴、跑測試、build 套件。
 *
 * 子模組指向 Hearthroom 維護的獨立 Moonstage；舞台程式碼在該倉庫修改。
 * 跑完把印出來的指標更新提交進本倉庫即可。
 *
 *   npm run sync:stage
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "stage");

if (!existsSync(path.join(stage, "package.json"))) {
  console.error("stage/ 還沒 checkout：先跑 git submodule update --init stage");
  process.exit(1);
}

const run = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { cwd: stage, stdio: "inherit", ...opts });
};
const out = (cmd) => execSync(cmd, { cwd: stage, encoding: "utf8" }).trim();

const before = out("git rev-parse --short HEAD");
run("git fetch origin main");
run("git checkout --detach FETCH_HEAD");
const after = out("git rev-parse --short HEAD");
run("npm ci --no-audit --no-fund");
run("npm test");
run("npm run build:stage");

console.log(`\n更新完成：${before} → ${after}`);
console.log("接下來：");
console.log(`  git add stage && git commit -m 'chore(stage): 釘上游 ${after}'`);

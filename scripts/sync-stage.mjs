#!/usr/bin/env node
/**
 * 把上游 Moonstage（lunatalkai/moonstage，主線）同步進 stage/（我們的 fork）。
 *
 * 分工（2026-09-06 與 Moonstage 維護者對齊）：程式碼一律往上游提；fork 跟上游的差別只有
 * 部署／套件 build。所以每次發版前跑這支：拉上游 main 併進目前分支、裝依賴、跑測試、build 套件。
 * 併完要人手做的兩件事會印在最後：推 fork、更新本倉庫的子模組指標。
 *
 *   npm run sync:stage
 */
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "stage");
const UPSTREAM = "https://github.com/lunatalkai/moonstage.git";

if (!existsSync(path.join(stage, "package.json"))) {
  console.error("stage/ 還沒 checkout：先跑 git submodule update --init stage");
  process.exit(1);
}

const run = (cmd, opts = {}) => {
  console.log(`\n$ ${cmd}`);
  return execSync(cmd, { cwd: stage, stdio: "inherit", ...opts });
};
const out = (cmd) => execSync(cmd, { cwd: stage, encoding: "utf8" }).trim();

const remotes = out("git remote");
if (!remotes.split("\n").includes("upstream")) run(`git remote add upstream ${UPSTREAM}`);
const branch = out("git rev-parse --abbrev-ref HEAD");
if (branch === "HEAD") {
  console.error("stage/ 目前是 detached HEAD：先 git -C stage checkout <分支> 再同步");
  process.exit(1);
}
run("git fetch upstream main");
const before = out("git rev-parse --short HEAD");
run("git merge --no-edit upstream/main");
const after = out("git rev-parse --short HEAD");
run("npm ci --no-audit --no-fund");
run("npm test");
run("npm run build:stage");

console.log(`\n同步完成：${before} → ${after}（分支 ${branch}）`);
console.log("接下來：");
console.log(`  1. git -C stage push origin ${branch}`);
console.log("  2. git add stage && git commit -m 'chore(stage): 同步上游 Moonstage'");

#!/usr/bin/env node
/**
 * community 的部署憲章檢查，接在 predeploy 最前面。規則見 deploy-preflight-rules.mjs；
 * 這裡只負責跑 git 把事實餵進去，然後照結果 exit。
 */
import { execFileSync } from "node:child_process";
import { assess } from "./deploy-preflight-rules.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const tryGit = (...args) => { try { return git(...args); } catch { return ""; } };

// GitHub 的 SSH 在這台機器上會間歇性失敗（publickey denied／connection closed），多試幾次再判定。
let fetchOk = false;
for (let attempt = 1; attempt <= 4 && !fetchOk; attempt++) {
  try {
    execFileSync("git", ["fetch", "origin", "--quiet"], { stdio: "ignore", timeout: 60_000 });
    fetchOk = true;
  } catch {
    if (attempt < 4) execFileSync("sleep", ["2"]);
  }
}

const result = assess({
  porcelain: tryGit("status", "--porcelain"),
  submoduleStatus: tryGit("submodule", "status", "stage"),
  head: tryGit("rev-parse", "HEAD"),
  originMain: tryGit("rev-parse", "refs/remotes/origin/main"),
  stagePinned: (tryGit("ls-tree", "HEAD", "stage").split(/\s+/)[2] ?? ""),
  stageHead: tryGit("-C", "stage", "rev-parse", "HEAD"),
  fetchOk,
  force: process.env.DEPLOY_FORCE === "1",
});

if (result.reasons.length) {
  console.error(`${result.forced ? "⚠️⚠️  DEPLOY_FORCE=1，以下問題被跳過，事後必須立刻對齊" : "❌ 部署前檢查沒過"}：`);
  for (const r of result.reasons) console.error(`- ${r}`);
}
if (!result.ok) process.exit(1);
console.log(`✅ 部署源乾淨且與 origin/main 同步：${git("rev-parse", "--short", "HEAD")} ${git("log", "-1", "--format=%s")}`);

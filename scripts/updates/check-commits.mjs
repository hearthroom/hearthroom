#!/usr/bin/env node
/**
 * 每個使用者感覺得到的 commit，都要交代它屬於哪一則更新說明。
 *
 * 公告的單位是 updates/ 裡的一則說明，不是 commit：一個功能可以拆成好幾個 commit、上線後再調，
 * 全部指向同一則說明，就只公告一次。這支檢查只問一件事——你有沒有想過使用者會不會注意到：
 *
 *   - 這個 commit 新增或修改了 updates/ 底下的說明，或
 *   - 訊息尾端寫了 `Update: <說明 id>`（指向已有的說明），或 `Update: none`（使用者感覺不到）。
 *
 * 要交代的是 feat、fix、perf、copy、revert、沒有前綴的 commit，以及任何改到 stage 指標的 commit
 * （播放器的變化都從那裡進來，訊息格式不一，所以看 gitlink 而不是看訊息）。
 * docs、test、chore、ci、build、refactor、style 不用。
 *
 * 兩個入口：
 *   --commit-msg <file>   git commit-msg hook，提交當下就擋（.githooks/commit-msg）
 *   --range <a>..<b>      CI 檢查一次推送裡的每個 commit
 */
import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REQUIRED = new Set(["feat", "fix", "perf", "copy", "revert"]);
const EXEMPT = new Set(["docs", "test", "chore", "ci", "build", "refactor", "style"]);

export function needsUpdateNote({ subject, stageChanged }) {
  if (stageChanged) return true;
  const m = /^([A-Za-z]+)(?:\([^)]*\))?!?:/.exec(subject.trim());
  if (!m) return true;
  const type = m[1].toLowerCase();
  if (REQUIRED.has(type)) return true;
  return !EXEMPT.has(type);
}

export function updateTrailers(message) {
  return [...message.matchAll(/^update:[ \t]*(\S+)[ \t]*$/gim)].map((m) => m[1]);
}

const HELP = [
  "這個 commit 使用者會注意到嗎？在訊息最後加一行說明：",
  "  Update: <updates/ 裡的說明 id>   屬於某則更新說明（還沒有就先在 updates/ 新增一份，見 updates/README.md）",
  "  Update: none                      使用者感覺不到（重構、內部調整、純效能）",
  "Does this commit change something users notice? End the message with `Update: <entry id>` or `Update: none`.",
].join("\n");

/** 回傳問題描述；null 表示通過。 */
export function checkCommit({ subject, message, files, stageChanged, known }) {
  if (!needsUpdateNote({ subject, stageChanged })) return null;
  if (files.some((f) => f.startsWith("updates/") && f.endsWith(".json"))) return null;
  const values = updateTrailers(message);
  if (!values.length) return `缺少 Update: 說明\n${HELP}`;
  const unknown = values.filter((v) => v !== "none" && !known.has(v));
  if (unknown.length) return `找不到這些更新說明：${unknown.join(", ")}（updates/<id>.json）\n${HELP}`;
  return null;
}

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

function entriesAt(cwd, rev) {
  const out = git(cwd, ["ls-tree", "--name-only", `${rev}:updates`]).split("\n").filter(Boolean);
  return new Set(out.filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)));
}

function revExists(cwd, rev) {
  if (/^0+$/.test(rev)) return false;
  try {
    git(cwd, ["cat-file", "-e", `${rev}^{commit}`]);
    return true;
  } catch {
    return false;
  }
}

/** 檢查 a..b 裡每個非合併 commit；起點不明（新分支、強制推送）時只看 b 本身。 */
export function checkRange(cwd, range) {
  const [from, to = "HEAD"] = range.split("..");
  const shas = revExists(cwd, from)
    ? git(cwd, ["rev-list", "--no-merges", "--reverse", `${from}..${to}`]).split("\n").filter(Boolean)
    : git(cwd, ["rev-list", "--no-merges", "-n", "1", to]).split("\n").filter(Boolean);
  let known;
  try {
    known = entriesAt(cwd, to);
  } catch {
    known = new Set();
  }
  const problems = [];
  for (const sha of shas) {
    const message = git(cwd, ["log", "-1", "--format=%B", sha]);
    const subject = message.split("\n")[0];
    const files = git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "-r", "--root", sha]).split("\n").filter(Boolean);
    const stageChanged = git(cwd, ["diff-tree", "--no-commit-id", "-r", "--root", sha, "--", "stage"]) !== "";
    const problem = checkCommit({ subject, message, files, stageChanged, known });
    if (problem) problems.push(`${sha.slice(0, 7)} ${subject}\n${problem}`);
  }
  return problems;
}

function checkMessageFile(cwd, file) {
  const message = readFileSync(file, "utf8").split("\n").filter((l) => !l.startsWith("#")).join("\n").trim();
  if (!message) return null;
  const subject = message.split("\n")[0];
  if (/^(fixup|squash|amend)! /.test(subject) || /^Merge /.test(subject)) return null;
  const files = git(cwd, ["diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
  const stageChanged = git(cwd, ["diff", "--cached", "--", "stage"]) !== "";
  const dir = join(cwd, "updates");
  const known = new Set(existsSync(dir) ? readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => n.slice(0, -5)) : []);
  return checkCommit({ subject, message, files, stageChanged, known });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const [mode, arg] = process.argv.slice(2);
  const cwd = git(process.cwd(), ["rev-parse", "--show-toplevel"]);
  if (mode === "--commit-msg" && arg) {
    const problem = checkMessageFile(cwd, arg);
    if (problem) {
      console.error(problem);
      process.exit(1);
    }
  } else if (mode === "--range" && arg) {
    const problems = checkRange(cwd, arg);
    if (problems.length) {
      console.error(`${problems.length} 個 commit 沒有交代更新說明：\n\n${problems.join("\n\n")}`);
      process.exit(1);
    }
    console.log("update notes: ok");
  } else {
    console.error("usage: check-commits.mjs --commit-msg <file> | --range <from>..<to>");
    process.exit(2);
  }
}

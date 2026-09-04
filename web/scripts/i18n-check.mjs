#!/usr/bin/env node
/**
 * 翻譯覆蓋率與漏網字串。
 *
 * 兩件事：
 *   1. 每個語言翻了幾成，缺哪些 key —— 報數字，不擋合併。翻譯是慢慢補齊的，
 *      把完成度做成門檻等於要求貢獻者一次翻完一百多條，否則什麼都交不了。
 *   2. 元件裡還有沒有沒抽出來的中文 —— 這個要擋。漏掉一句不會報錯，
 *      只會在英文介面裡冒出一行中文，而且沒人會發現。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const LOCALES_DIR = new URL("../src/locales/", import.meta.url).pathname;
const SRC_DIR = new URL("../src/", import.meta.url).pathname;
const SOURCE = "zh-Hant";

const read = (f) => JSON.parse(readFileSync(join(LOCALES_DIR, f), "utf8"));
const files = readdirSync(LOCALES_DIR).filter((f) => f.endsWith(".json"));
const base = read(`${SOURCE}.json`);
const baseKeys = Object.keys(base);

let failed = false;

console.log(`基準語言 ${SOURCE}：${baseKeys.length} 個 key\n`);
console.log("翻譯覆蓋率");
for (const file of files.sort()) {
  const code = file.replace(".json", "");
  if (code === SOURCE) continue;
  const msgs = read(file);
  const missing = baseKeys.filter((k) => !msgs[k]);
  const extra = Object.keys(msgs).filter((k) => !base[k]);
  const pct = Math.round(((baseKeys.length - missing.length) / baseKeys.length) * 100);
  const bar = "█".repeat(Math.round(pct / 5)).padEnd(20, "·");
  console.log(`  ${code.padEnd(9)} ${bar} ${String(pct).padStart(3)}%  缺 ${missing.length}`);
  if (missing.length && missing.length <= 12) console.log(`             ${missing.join(", ")}`);
  // 多出來的 key 是真的錯：不是改名沒同步，就是複製貼上到錯的檔案。
  if (extra.length) {
    console.log(`  ✖ ${code} 有 ${extra.length} 個基準語言沒有的 key：${extra.join(", ")}`);
    failed = true;
  }
}

// 漏網的中文：只看模板與程式碼字面值，註解不算（那是寫給維護者的）。
const CJK = /[一-鿿]/;
const walk = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
  );

const leaks = [];
for (const path of walk(SRC_DIR)) {
  if (!/\.(vue|ts)$/.test(path) || path.includes("/locales/")) continue;
  let src = readFileSync(path, "utf8");
  // 標記要在剝註解之前判斷，它本身就寫在註解裡
  if (/i18n-ignore/.test(src)) continue;
  src = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "").replace(/<!--[\s\S]*?-->/g, "");
  src = src.replace(/label: "[^"]*"/g, "");
  src.split("\n").forEach((line, i) => {
    if (CJK.test(line)) leaks.push(`${path.replace(SRC_DIR, "src/")}:${i + 1}  ${line.trim().slice(0, 70)}`);
  });
}

// 簡體檔裡混進繁體字是最容易漏的一種錯：檔案本身完整、覆蓋率 100%，
// 但使用者會看到一半繁一半簡。機器轉換之後尤其常見。
const TRAD_ONLY = "繁體單語記標籤資檔預設儲尋顯結經歷總會來個為與從應無將並樣發點選項類變態進運動時間問題開關實現際還這麼頭";
const TW_TERMS = ["社群", "網路", "程式", "資訊", "品質", "影片", "螢幕", "軟體"];
const hans = files.includes("zh-Hans.json") ? read("zh-Hans.json") : null;
if (hans) {
  const bad = Object.entries(hans).filter(
    ([, v]) => [...TRAD_ONLY].some((c) => v.includes(c)) || TW_TERMS.some((t) => v.includes(t)),
  );
  console.log(`\nzh-Hans 混入繁體字或台灣用語：${bad.length}`);
  for (const [k, v] of bad) console.log(`  ${k}: ${v.slice(0, 50)}`);
  if (bad.length) failed = true;
}

console.log(`\n未抽出的中文字串：${leaks.length}`);
for (const l of leaks) console.log(`  ${l}`);
if (leaks.length) failed = true;

process.exit(failed ? 1 : 0);

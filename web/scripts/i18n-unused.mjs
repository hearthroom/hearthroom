#!/usr/bin/env node
/**
 * 找出翻譯檔裡已經沒有程式在用的 key（只回報，不刪、不擋 CI）。
 *
 *   node scripts/i18n-unused.mjs          列出沒用到的 key，依前綴分組
 *   node scripts/i18n-unused.mjs --json   印成 JSON（給別的腳本接）
 *
 * 判斷規則：
 *   - 直接用到：key 以引號包著出現在程式裡（"a.b"、'a.b'、`a.b`）。只是另一個 key 的前綴不算。
 *   - 動態組出來的：程式裡有 `a.b.${x}` 或 "a.b." + x，就把 a.b. 開頭的 key 都算「可能用到」，寧可漏報不誤報。
 *     程式裡以字串出現的 "a.b"、而有 a.b.* 的 key 時也一樣（例如 `${map[code] ?? "error.validateReject"}.${field}`）。
 * 掃 web/src（翻譯檔本身除外）、web/scripts、web/index.html、../shared 與 Worker 的 ../src。基準語言是 zh-Hant，其他語言的 key 由 i18n-check 保證對齊。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const web = join(dirname(fileURLToPath(import.meta.url)), "..");
// 伺服器回的錯誤碼有時直接就是前端的 key（前端拿來 $t），所以 Worker 的原始碼也要掃
const roots = [join(web, "src"), join(web, "..", "shared"), join(web, "..", "src"), join(web, "scripts")];
const extraFiles = [join(web, "index.html")];
const keys = Object.keys(JSON.parse(readFileSync(join(web, "src/locales/zh-Hant.json"), "utf8")));

function* files(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      if (name === "locales" || name === "node_modules") continue;
      yield* files(path);
    } else if (/\.(ts|vue|js|mjs)$/.test(name)) yield path;
  }
}

let source = "";
for (const root of roots) for (const file of files(root)) if (!file.endsWith("i18n-unused.mjs")) source += `\n${readFileSync(file, "utf8")}`;
for (const file of extraFiles) source += `\n${readFileSync(file, "utf8")}`;

const quoted = new Set();
for (const m of source.matchAll(/["'`]([A-Za-z0-9_.-]+)["'`]/g)) quoted.add(m[1]);
const prefixes = new Set();
for (const m of source.matchAll(/`([A-Za-z0-9_.-]+\.)\$\{/g)) prefixes.add(m[1]);
for (const m of source.matchAll(/["']([A-Za-z0-9_.-]+\.)["']\s*\+/g)) prefixes.add(m[1]);
// 前綴本身以字串出現（不帶結尾的點），之後才接上後半段
// （"error.validateReject" 自己也是 key：通用的那句；後面接欄位名的是分欄位的版本）
for (const q of quoted) if (q.includes(".") && keys.some((k) => k.startsWith(`${q}.`))) prefixes.add(`${q}.`);

const dynamic = [];
const unused = [];
for (const key of keys) {
  if (quoted.has(key)) continue;
  if ([...prefixes].some((p) => key.startsWith(p))) dynamic.push(key);
  else unused.push(key);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ total: keys.length, unused, dynamic }, null, 2));
} else {
  const groups = new Map();
  for (const key of unused) {
    const group = key.split(".").slice(0, 2).join(".");
    groups.set(group, [...(groups.get(group) ?? []), key]);
  }
  console.log(`基準語言 zh-Hant：${keys.length} 個 key`);
  console.log(`動態組出來、算可能用到：${dynamic.length}（前綴 ${[...prefixes].sort().join("、")}）`);
  console.log(`沒有程式在用：${unused.length}\n`);
  for (const [group, list] of [...groups].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`${String(list.length).padStart(4)}  ${group}`);
    for (const key of list) console.log(`        ${key}`);
  }
  console.log(`\n掃過：${[...roots, ...extraFiles].map((r) => relative(web, r)).join("、")}`);
}

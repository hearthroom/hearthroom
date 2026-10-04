#!/usr/bin/env node
/**
 * 驗證 updates/*.json，打包成 Worker 可以 import 的 src/generated/updates.ts。
 *
 * 任何一則不合格就以非零結束：建置、測試、部署都跑這一步，不合格的說明上不了線。
 * 只打包最近 365 天的說明，舊的留在倉庫裡，不再跟著每次部署出貨。
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEntries, repoContext } from "./entries.mjs";

const KEEP_DAYS = 365;

export function buildModule(entries, today) {
  const cutoff = new Date(`${today}T00:00:00Z`).getTime() - KEEP_DAYS * 86_400_000;
  const kept = entries.filter((e) => new Date(`${e.id.slice(0, 10)}T00:00:00Z`).getTime() >= cutoff);
  const json = JSON.stringify(kept, null, 1);
  const build = createHash("sha256").update(json).digest("hex").slice(0, 16);
  return {
    count: kept.length,
    source: [
      "// 由 scripts/updates/build.mjs 從 updates/*.json 產生，不要手改，也不入庫。",
      'import type { UpdateEntry } from "../../shared/updates";',
      `export const UPDATES_BUILD = "${build}";`,
      `export const UPDATES: readonly UpdateEntry[] = ${json};`,
      "",
    ].join("\n"),
  };
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = join(root, "updates");
  const { entries, errors } = existsSync(dir) ? loadEntries(dir, repoContext(root)) : { entries: [], errors: [] };
  if (errors.length) {
    console.error(`updates/ 有 ${errors.length} 個問題，修好才能建置：\n` + errors.map((e) => `  - ${e}`).join("\n"));
    process.exit(1);
  }
  const { source, count } = buildModule(entries, new Date().toISOString().slice(0, 10));
  const out = join(root, "src/generated/updates.ts");
  mkdirSync(dirname(out), { recursive: true });
  if (!existsSync(out) || readFileSync(out, "utf8") !== source) writeFileSync(out, source);
  console.log(`updates: ${count} entries`);
}

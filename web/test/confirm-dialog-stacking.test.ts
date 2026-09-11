/**
 * 確認框會從別的全頁浮層（世界書條目、正則規則、素材庫）裡叫出來，所以它的 z-index
 * 必須是全站最高——同為 100 時誰後掛到 body 誰在上，掛在 App 一開始的確認框永遠輸。
 * 世界書條目的「刪除」就曾這樣整個被壓在條目彈窗底下，看起來像按了沒反應。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : /\.(vue|css)$/.test(name) ? [full] : [];
  });
}

describe("ConfirmDialog 層級", () => {
  it("z-index 高於站內其他所有鋪滿整頁的浮層", () => {
    const root = join(__dirname, "../src");
    const dialog = readFileSync(join(root, "components/ConfirmDialog.vue"), "utf8");
    const own = Number(/\.dlg-backdrop\s*\{[^}]*z-index:\s*(\d+)/.exec(dialog)?.[1]);
    expect(own).toBeGreaterThan(0);
    for (const file of walk(root)) {
      if (file.endsWith("ConfirmDialog.vue")) continue;
      // 只看 position: fixed + inset: 0 的規則：那是會把確認框整個蓋住的全頁浮層。
      // 提示條（toast）之類不攔點擊的東西可以更高，不在此列。
      for (const block of readFileSync(file, "utf8").matchAll(/\{[^}]*\}/g)) {
        if (!/position:\s*fixed/.test(block[0]) || !/inset:\s*0\b/.test(block[0])) continue;
        const z = /z-index:\s*(-?\d+)/.exec(block[0]);
        if (z) expect(Number(z[1]), `${file} 的全頁浮層 z-index 不能 ≥ 確認框的 ${own}`).toBeLessThan(own);
      }
    }
  });
});

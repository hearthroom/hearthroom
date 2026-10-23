import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 卡片 hover 不能重畫整張卡：外框陰影不變、卡片不位移。封面放大（合成器做）與名字變色（只重畫那一行）照留。
 *
 * 2026-10-23 玩家回報（Windows Chrome）：滑鼠在卡片邊緣進出，整條畫面一閃一閃變空白。
 * 動圖封面本來就逐格重畫它那條區域；每次 hover 進出再讓整張卡的陰影淡入淡出十幾格，GPU 記憶體吃緊時
 * Chrome 畫不完，就把那條畫成空白。Mac 用 --force-gpu-mem-available-mb=64 重現：現狀 0.3–42% 的畫面缺內容，
 * hover 陰影不變後 0–1.5%；陰影照變只拿掉淡入淡出仍有 6–10%。量測見 docs/studio/tasks/2026-10-23-card-hover-flicker。
 * 首頁卡片原本還會上抬 3 px，游標停在下緣時卡片一抬就離開、放下又碰到，會自己來回觸發。
 */
const style = (path: string) =>
  (readFileSync(resolve(process.cwd(), path), "utf8").match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? "").replace(/\/\*[\s\S]*?\*\//g, "");
const rules = (css: string, selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body);

describe("卡片 hover 不重畫整張卡", () => {
  for (const file of ["src/components/CardTile.vue", "src/components/MyCardTile.vue"]) {
    const css = style(file);
    it(`${file}：.card:hover 不改陰影、不位移`, () => {
      for (const body of rules(css, ".card:hover")) expect(body).not.toMatch(/box-shadow|transform|translate/);
    });
    it(`${file}：.card 不對陰影或位移做過場`, () => {
      const card = rules(css, ".card");
      expect(card.length, ".card 沒有規則（測試沒在測東西）").toBeGreaterThan(0);
      for (const body of card) expect(body).not.toMatch(/transition(-property)?:[^;]*(box-shadow|transform|all)/);
    });
    it(`${file}：封面放大照留`, () => {
      expect(rules(css, ".card:hover .card__art img").join("")).toMatch(/transform:\s*scale/);
    });
  }
});

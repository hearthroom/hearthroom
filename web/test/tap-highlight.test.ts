import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 手機 Chrome 點擊時的系統藍框與長按反白（2026-11-19 玩家回報：點卡名、按鈕出現像選取的藍色反白）。
 * 系統點擊高亮整站關掉；控件與卡名不選取文字；拿掉系統高亮之後，按下的回饋要由我們自己的 :active 給。
 * 見 docs/studio/tasks/2026-11-19-mobile-tap-highlight。
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
const base = read("src/styles/base.css");
const rules = (css: string, selector: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, sel]) => sel.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body);

describe("手機點擊不出現系統藍框", () => {
  it("html 關掉系統點擊高亮（會繼承到整站與畫布）", () => {
    expect(rules(base, "html").join("")).toMatch(/-webkit-tap-highlight-color:\s*transparent/);
  });

  it("控件與卡名不選取文字，畫布裡的不管", () => {
    const rule = [...base.matchAll(/([^{}]+)\{([^{}]*)\}/g)].find(([sel, , body]) => sel.includes(".card__link") && /user-select:\s*none/.test(body ?? ""));
    expect(rule, "找不到控件的 user-select: none 規則").toBeTruthy();
    const sel = rule![1].trim();
    for (const s of ["button", ".btn", ".chip", ".seg__item", '[role="tab"]', ".card__link"]) expect(sel).toContain(s);
    // 特異度歸零：複製用的 user-select: all/text 照舊贏
    expect(sel.startsWith(":where(")).toBe(true);
    expect(sel).toContain(":not(.ms-stage *)");
  });

  it("沒有對內文或對話關掉選取", () => {
    for (const [sel, body] of base.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (/user-select:\s*none/.test(body ?? "")) expect(sel).not.toMatch(/\.mes_text|\bbody\b|\bhtml\b|\bp\b|\bmain\b/);
    }
  });

  it("拿掉系統高亮之後，chip 與分段控制有自己的按下回饋", () => {
    expect(rules(base, ".chip:active").join("")).toMatch(/background/);
    expect(rules(base, ".seg__item:active").join("")).toMatch(/color/);
    // 站台的 .btn 排除遊玩畫布（畫布與作者卡片美化自己決定按鈕外觀），站台內的按鈕照舊有按下回饋。
    expect(rules(base, ".btn:where(:not(.ms-stage *)):active").join("")).toMatch(/transform/);
  });

  for (const file of ["src/components/CardTile.vue", "src/components/MyCardTile.vue"]) {
    it(`${file}：按下卡片時封面跟 hover 一樣放大`, () => {
      const css = read(file).match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? "";
      expect(rules(css, ".card:active .card__art img").join("")).toMatch(/transform:\s*scale/);
    });
  }
});

describe("自己重定義分段控制的元件也有按下回饋", () => {
  it("ProfileTabs 的排序分段按下會變色", () => {
    const css = read("src/components/profile/ProfileTabs.vue").match(/<style[^>]*>([\s\S]*)<\/style>/)?.[1] ?? "";
    expect(css).toMatch(/\.seg__item[^{]*:active[^{]*\{[^}]*color/);
  });
});

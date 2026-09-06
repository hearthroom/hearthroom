import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * .btn:hover 是兩個選擇器，壓得過任何單一 class 的變體。每個「有自己底色」的實心變體都必須在
 * :hover 裡把底色再說一次，否則懸浮時底色被換成灰色而文字顏色不變——白字消失。
 * 這個測試掃 base.css，抓下一個忘記重述的變體。
 */
describe("實心按鈕變體的 hover 不能丟掉自己的底色", () => {
  const css = readFileSync(resolve(process.cwd(), "src/styles/base.css"), "utf8");
  const rule = (selector: string) => {
    const match = css.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*\\{([^}]*)\\}`));
    return match ? match[1] : null;
  };
  // 有自己底色（非 transparent、非 --surface）的變體
  const solid = [...css.matchAll(/^\.(btn--[a-z-]+)\s*\{([^}]*)\}/gm)]
    .filter(([, , body]) => /background:\s*(?!transparent)(?!var\(--surface\))/.test(body))
    .map(([, name]) => name);

  it("找得到實心變體（否則這個測試就沒在測東西）", () => {
    expect(solid).toContain("btn--primary");
  });

  for (const name of solid) {
    it(`.${name}:hover 重述了 background`, () => {
      const hover = rule(`.${name}:hover`);
      expect(hover, `.${name}:hover 沒有規則`).not.toBeNull();
      expect(hover).toMatch(/background:/);
    });
  }
});

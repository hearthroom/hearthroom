/**
 * 一家不支援的功能，就不該在那一家的會話裡給入口。
 *
 * 能力表（lib/provider.ts 的 FEATURES）本來就是為此存在，但只有留言接上了它：
 * 其餘入口照常顯示，點下去打的是那一家根本沒有的路徑，使用者拿到的是 404。
 * 這組測試釘住「宣告不支援 → 路由擋得住」，以及能力表本身涵蓋建卡與編輯。
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { can, setProvider } from "@/lib/provider";
import { router } from "@/router";

beforeEach(() => {
  localStorage.clear();
  setProvider("lunatalk");
});
afterEach(() => setProvider("lunatalk"));

describe("能力表", () => {
  it("建卡與編輯是一項能力：LunaTalk 有，Harbor 沒有", () => {
    setProvider("lunatalk");
    expect(can("editor")).toBe(true);
    setProvider("harbor");
    expect(can("editor")).toBe(false);
  });
});

describe("路由擋下那一家沒有的頁", () => {
  const cases: [string, string][] = [
    ["/create", "editor"],
    ["/cards/abc/edit", "editor"],
    ["/resources", "library"],
  ];

  for (const [path, feature] of cases) {
    it(`${path} 需要 ${feature}：Harbor 進不去`, async () => {
      setProvider("harbor");
      const match = router.resolve(path);
      expect(match.meta.feature).toBe(feature);
      expect(can(match.meta.feature as never)).toBe(false);
    });

    it(`${path}：LunaTalk 照常進得去`, () => {
      setProvider("lunatalk");
      expect(can(router.resolve(path).meta.feature as never)).toBe(true);
    });
  }
});

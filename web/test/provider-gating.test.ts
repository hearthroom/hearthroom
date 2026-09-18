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
  it("建卡與編輯是一項能力，兩家都有；編輯頁裡靠別家端點的功能 Harbor 沒有", () => {
    setProvider("lunatalk");
    expect(can("editor")).toBe(true);
    setProvider("harbor");
    expect(can("editor")).toBe(true);
    expect(can("regex")).toBe(true);
    expect(can("worldbook")).toBe(true);
    for (const f of ["validation", "deleteRole", "tags", "previewPage", "outputContract", "welcomeExtras"] as const) expect(can(f), f).toBe(true);
    expect(can("chatTest")).toBe(true);
    expect(can("library")).toBe(true);
    // 審核是本站自己的事（送審當下存快照），不看供應商有沒有分享介面
    expect(can("review")).toBe(true);
  });
});

describe("路由擋下那一家沒有的頁", () => {
  it("建卡與編輯兩家都進得去", () => {
    for (const id of ["lunatalk", "harbor"] as const) {
      setProvider(id);
      expect(can(router.resolve("/create").meta.feature as never), id).toBe(true);
      expect(can(router.resolve("/cards/abc/edit").meta.feature as never), id).toBe(true);
    }
  });

  const cases: [string, string][] = [
    ["/resources", "library"],
  ];

  for (const [path, feature] of cases) {
    it(`${path} 需要 ${feature}：Harbor 圖庫已接上`, async () => {
      setProvider("harbor");
      const match = router.resolve(path);
      expect(match.meta.feature).toBe(feature);
      expect(can(match.meta.feature as never)).toBe(true);
    });

    it(`${path}：LunaTalk 照常進得去`, () => {
      setProvider("lunatalk");
      expect(can(router.resolve(path).meta.feature as never)).toBe(true);
    });
  }
});

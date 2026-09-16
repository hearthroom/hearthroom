/**
 * 這個部署有哪幾家供應商，由伺服器說了算。
 *
 * 前端寫死兩家的話，沒配第二家的部署（包括自架的人）也會看到那顆按鈕，按下去
 * 每個請求都 400。所以登入頁要先問這裡。
 */
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("GET /v1/providers", () => {
  it("只列出這個部署真的設定過的那幾家", async () => {
    const res = await SELF.fetch("https://c.test/v1/providers");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { providers: { id: string; name: string }[] };
    // 測試環境兩家都設了（見 vitest.config.ts）
    expect(body.providers.map((p) => p.id)).toEqual(["lunatalk", "harbor"]);
    expect(body.providers[0].name).toBe("LunaTalk");
    expect(body.providers[1].name).toBe("HarperHarbor");
  });

  it("不需要登入就問得到：登入頁本來就還沒有身分", async () => {
    expect((await SELF.fetch("https://c.test/v1/providers")).status).toBe(200);
  });
});

/**
 * 等轉換器的測試給 15 秒：它刻意等頁面網路安靜才下載（最多 6 秒＋瀏覽器空閒 2 秒）。
 *
 * 卡片標題跟著介面字形顯示：簡體介面看到繁體標題要轉成簡體，反之亦然——跟對話頁同一套規則。
 * 轉換器與字典跟對話頁共用（moonstage/display-script），只有中文介面、而且標題有漢字時才載入。
 */
import { afterEach, describe, expect, it } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { displayName, displayScriptReady } from "../src/lib/display-name";
import CardTile from "../src/components/CardTile.vue";

describe("卡片標題的字形", () => {
  it("簡體介面把繁體標題轉成簡體，正體介面把簡體標題轉成繁體", async () => {
    displayName("魔法少女與黑貓", "zh-Hans");
    await displayScriptReady();
    expect(displayName("魔法少女與黑貓", "zh-Hans")).toBe("魔法少女与黑猫");
    expect(displayName("简体标题的学园", "zh-Hant")).toBe("簡體標題的學園");
  }, 15000);
  it("已經是目標字形、非中文介面、沒有漢字的標題原樣", async () => {
    await displayScriptReady();
    expect(displayName("魔法少女与黑猫", "zh-Hans")).toBe("魔法少女与黑猫");
    expect(displayName("魔法少女與黑貓", "en")).toBe("魔法少女與黑貓");
    expect(displayName("魔法少女與黑貓", "ja")).toBe("魔法少女與黑貓");
    expect(displayName("𝓗𝓸𝓷𝓴𝓪𝓲 Star Rail", "zh-Hans")).toBe("𝓗𝓸𝓷𝓴𝓪𝓲 Star Rail");
  }, 15000);
});

describe("榜單卡片", () => {
  let app: App | null = null;
  let el: HTMLElement | null = null;
  afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });
  it("簡體介面顯示簡體標題與首字，佔位色仍依原標題", async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:locale(zh-Hans|en)?/:p(.*)*", component: { template: "<div />" } }] });
    await router.push("/zh-Hans/");
    el = document.createElement("div");
    document.body.appendChild(el);
    const card = { id: "1", roleId: "r", num: 1, zone: "zh", name: "龍與魔法學園", summary: "", tags: [], avatarUrl: null, backgroundUrl: null, author: { handle: null, accountNumId: 1, name: "作者與貓", avatar: "" }, talkNum: 0, trending: 0 };
    app = createApp(CardTile, { card }).use(router).use(i18n);
    app.mount(el);
    await displayScriptReady();
    await nextTick();
    expect(el.querySelector(".card__name")?.textContent).toContain("龙与魔法学园");
    expect(el.querySelector(".card__void")?.textContent).toContain("龙");
    expect(el.textContent).toContain("作者與貓");
  }, 15000);
});

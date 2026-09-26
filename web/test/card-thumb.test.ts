/**
 * 卡片清單用縮圖（會動的照樣會動）；縮圖拿不到退回原圖，原圖也掛了才畫單字佔位。
 * 實測首頁第一張封面是 6.4 MB 的 GIF，顯示只有 179×238。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { cardThumb } from "../src/lib/card-thumb";
import { PRIMARY_HOST } from "../../shared/site-hosts";
import CardTile from "../src/components/CardTile.vue";

const GIF = "https://assets.harperharbor.com/versions/cover-1";
afterEach(() => vi.unstubAllGlobals());

describe("縮圖網址", () => {
  it("不管從哪個網域進來，都在主網域轉、來源走主網域的 /v1/art：同一張圖只轉一次、只收一次錢", () => {
    const expected = `https://${PRIMARY_HOST}/cdn-cgi/image/width=480,fit=scale-down,format=auto,anim=true,quality=80/v1/art/harbor/versions/cover-1`;
    for (const hostname of ["sukisuki.ai", "hearthroom.club", "www.sukisuki.chat", "play.hearthroom.club"]) {
      vi.stubGlobal("location", { hostname });
      expect(cardThumb(GIF), hostname).toBe(expected);
    }
    vi.stubGlobal("location", { hostname: "hearthroom.club" });
    expect(cardThumb("https://assets.harperharbor.com/media/abc?raw=1")).toContain("/v1/art/harbor/media/abc?raw=1");
    expect(cardThumb("https://objects.lunatalk.ai/hosting/abc")).toContain("/v1/art/lunatalk/hosting/abc");
  });
  it("別的來源、不是我們的網域（本機開發）、壞網址：原樣", () => {
    vi.stubGlobal("location", { hostname: "hearthroom.club" });
    expect(cardThumb("https://meimoaiimg.com/a.gif")).toBe("https://meimoaiimg.com/a.gif");
    expect(cardThumb("not a url")).toBe("not a url");
    vi.stubGlobal("location", { hostname: "localhost" });
    expect(cardThumb(GIF)).toBe(GIF);
  });
});

describe("卡片封面", () => {
  let app: App | null = null;
  let el: HTMLElement | null = null;
  afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });
  it("縮圖拿不到退回原圖；原圖也掛了才畫單字佔位", async () => {
    vi.stubGlobal("location", { ...window.location, hostname: "hearthroom.club" });
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
    el = document.createElement("div");
    document.body.appendChild(el);
    const card = { id: "1", roleId: "r", num: 1, zone: "zh", name: "夜行", summary: "", tags: [], avatarUrl: GIF, backgroundUrl: null, author: { handle: null, accountNumId: 1, name: "a", avatar: "" }, talkNum: 0, trending: 0 };
    app = createApp(CardTile, { card }).use(router).use(i18n);
    app.mount(el);
    await nextTick();
    const img = () => el!.querySelector<HTMLImageElement>(".card__art img");
    expect(img()!.getAttribute("src")).toContain("/cdn-cgi/image/");
    img()!.dispatchEvent(new Event("error"));
    await nextTick();
    expect(img()!.getAttribute("src")).toBe(GIF);
    img()!.dispatchEvent(new Event("error"));
    await nextTick();
    expect(img()).toBeNull();
    expect(el!.querySelector(".card__void")?.textContent).toContain("夜");
  });
});

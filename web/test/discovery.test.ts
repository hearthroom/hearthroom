import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import BoardPage from "../src/pages/BoardPage.vue";
import SearchPage from "../src/pages/SearchPage.vue";
import * as api from "../src/lib/api";
vi.mock("../src/lib/api", async (original) => ({ ...await original<typeof api>(),
  fetchBoard: vi.fn(async () => ({ items: [], total: 0, hasNext: false, limit: 24, offset: 0, sort: "hot" })),
  fetchAuthors: vi.fn(async () => ({ items: [], hasNext: false, limit: 24, offset: 0, sort: "talk" })),
  fetchTags: vi.fn(async () => []),
  searchTags: vi.fn(async () => ({ items: [{ tag: "西幻", n: 3 }], hasNext: false, limit: 24, offset: 0 })),
}));
let app: App | undefined;
let root: HTMLElement;
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise(r => setTimeout(r, 0)); await nextTick(); } };
async function mount(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/", component: BoardPage }, { path: "/search", component: SearchPage },
  ] });
  await router.push(path); await router.isReady();
  root = document.createElement("div"); document.body.appendChild(root);
  app = createApp({ template: "<router-view />" }).use(createPinia()).use(i18n).use(router);
  app.mount(root); await settle(); return router;
}
const button = (label: string) => [...root.querySelectorAll<HTMLButtonElement>("button")].find(x => x.textContent?.trim().startsWith(label))!;
afterEach(() => { app?.unmount(); root?.remove(); vi.clearAllMocks(); });

describe("社區探索自然操作", () => {
  it("首頁可多選、取消與清除，保留網址並重設分頁", async () => {
    const router = await mount("/?sort=hot&offset=24");
    button("角色扮演").click(); await settle();
    button("劇情").click(); await settle();
    expect(router.currentRoute.value.query.tag).toEqual(["roleplay", "story"]);
    expect(router.currentRoute.value.query.offset).toBeUndefined();
    expect(vi.mocked(api.fetchBoard).mock.lastCall?.[0]?.tag).toEqual(["roleplay", "story"]);
    button("角色扮演").click(); await settle();
    expect(router.currentRoute.value.query.tag).toEqual(["story"]);
    button("全部").click(); await settle();
    expect(router.currentRoute.value.query.tag).toBeUndefined();
  });
  it("搜尋的標籤、时间與排序進入真實查詢，標籤分頁可以點進結果", async () => {
    const router = await mount("/search?q=西幻");
    expect(button("篩選")).toBeTruthy();
    button("篩選").click(); await settle();
    button("角色扮演").click(); await settle();
    const period = root.querySelector<HTMLSelectElement>("select[name=period]")!;
    period.value = "quarter"; period.dispatchEvent(new Event("change")); await settle();
    const sort = root.querySelector<HTMLSelectElement>("select[name=sort]")!;
    sort.value = "new"; sort.dispatchEvent(new Event("change")); await settle();
    expect(api.fetchBoard).toHaveBeenLastCalledWith(expect.objectContaining({ tag: ["roleplay"], period: "quarter", sort: "new" }));
    button("標籤").click(); await settle();
    expect(root.querySelector("select[name=period]")).toBeNull();
    button("# 西幻").click(); await settle();
    expect(router.currentRoute.value.query.kind).toBeUndefined();
    expect(router.currentRoute.value.query.q).toBeUndefined();
    expect(router.currentRoute.value.query.tag).toEqual(["西幻"]);
  });
  it("字面標籤連結在共用目錄只顯示一次，已選標籤可取消", async () => {
    await mount("/search?tag=西幻");
    button("篩選").click(); await settle();
    const chips = [...root.querySelectorAll<HTMLButtonElement>(".discovery-tags button")].filter(b => b.textContent === "西幻");
    expect(chips).toHaveLength(1);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
  });
  it("舊查詢較晚回來不會覆蓋新結果", async () => {
    let resolveOld: (value: any) => void = () => {};
    vi.mocked(api.fetchAuthors).mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const router = await mount("/search?q=old&kind=authors");
    await router.push("/search?q=new&kind=authors"); await settle();
    resolveOld({ items: [{ handle: "old", name: "STALE_RESULT", cardCount: 0, talkTotal: 0, trending: 0 }], hasNext: false, limit: 24, offset: 0 });
    await settle(); expect(root.textContent).not.toContain("STALE_RESULT");
  });
});

/**
 * 卡片上的「幾天前更新」（2026-10-11）：時間是目前上線那一版過審的時刻（伺服器的 updatedAt），
 * 跟「更新」那個榜同一個口徑。畫面上只放時鐘與相對時間，整句「更新於…」給滑鼠提示與讀屏。
 * 舊伺服器沒給就不畫。
 */
import { afterEach, expect, it } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { relativeTime } from "../src/lib/format";
import CardTile from "../src/components/CardTile.vue";

let app: App | null = null; let el: HTMLElement | null = null;
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; });
async function mount(extra: Record<string, unknown>) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  el = document.createElement("div"); document.body.appendChild(el);
  const card = { id: "1", roleId: "r", num: 1, zone: "zh", name: "夜行", summary: "", tags: [], avatarUrl: null, backgroundUrl: null, author: { handle: null, accountNumId: 1, name: "a", avatar: "" }, talkNum: 0, trending: 0, ...extra };
  app = createApp(CardTile, { card }).use(router).use(i18n);
  app.mount(el); await nextTick();
}

it("畫出相對時間；整句「更新於…」在提示與讀屏裡", async () => {
  const updatedAt = Date.now() - 3 * 86_400_000;
  await mount({ updatedAt });
  const node = el!.querySelector(".card__updated")!;
  expect(node.textContent).toContain(relativeTime(updatedAt));
  const full = i18n.global.t("card.updatedAgo", { time: relativeTime(updatedAt) });
  expect(node.getAttribute("title")).toBe(full);
  expect(node.querySelector(".sr-only")?.textContent?.trim()).toBe(full);
  expect(node.querySelector("time")?.getAttribute("datetime")).toBe(new Date(updatedAt).toISOString());
});

it("伺服器沒給時間就不畫", async () => {
  await mount({});
  expect(el!.querySelector(".card__updated")).toBeNull();
});

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { createPinia, setActivePinia } from "pinia";
import { i18n } from "../src/lib/i18n";
import type { UpdateItem } from "../../shared/updates";
import {
  acknowledge, emptyState, initialState, keysForPath, localDay, mergeState, returningBrowser, spotlightKeys, stripDecision,
  STRIP_COOLDOWN, STRIP_WINDOW, useUpdates,
} from "../src/lib/updates";
import UpdateStrip from "../src/components/UpdateStrip.vue";
import NewMark from "../src/components/NewMark.vue";
import UpdatesPage from "../src/pages/UpdatesPage.vue";

const HOUR = 3_600_000, DAY = 86_400_000;
const NOW = new Date(2026, 9, 5, 21, 0, 0).getTime();
const item = (id: string, over: Partial<UpdateItem> = {}): UpdateItem => ({
  id, tier: "feature", audience: "everyone", liveAt: NOW - HOUR, announcedAt: NOW - HOUR, title: `標題 ${id}`, body: null, try: "/me/notifications", spotlight: [], ...over,
});

describe("第一次見到讀者", () => {
  it("新訪客從現在開始算；回訪的人往回看兩週", () => {
    expect(initialState(NOW, false).seenThrough).toBe(NOW);
    expect(initialState(NOW, true).seenThrough).toBe(NOW - STRIP_WINDOW);
  });
  it("以前某一天來過、或自己做過選擇才算回訪；第一次打開時本站自己寫的鍵不算", () => {
    const store = (entries: Record<string, string>) => ({ getItem: (k: string) => entries[k] ?? null });
    const today = "2026-10-05";
    expect(returningBrowser(store({}), today)).toBe(false);
    expect(returningBrowser(store({ "hearthroom.provider": "harbor", "hearthroom.pwa.days": '["2026-10-05"]', "hearthroom.updates": "{}" }), today)).toBe(false);
    expect(returningBrowser(store({ "hearthroom.pwa.days": '["2026-10-03","2026-10-05"]' }), today)).toBe(true);
    expect(returningBrowser(store({ "hearthroom.mode": "dark" }), today)).toBe(true);
    expect(returningBrowser(store({ "hearthroom.pwa.days": "broken" }), today)).toBe(false);
    expect(returningBrowser(null, today)).toBe(false);
  });
});

describe("首頁提示列", () => {
  const seen = emptyState(NOW - DAY);

  it("有沒看過的新功能才出現：重點優先，再來是最新的；數字算上其他沒看過的，包括修正", () => {
    const d = stripDecision([item("a", { announcedAt: NOW - 2 * HOUR }), item("hl", { tier: "highlight", announcedAt: NOW - 3 * HOUR }), item("fix", { tier: "fix" }), item("old", { announcedAt: NOW - 2 * DAY })], seen, NOW, false);
    expect(d.show).toBe(true);
    if (!d.show) return;
    expect(d.top.id).toBe("hl");
    expect(d.more).toBe(2);
    expect(d.state).toMatchObject({ stripDays: 1, stripDay: localDay(NOW) });
  });

  it("只有修正、或全部看過時不出現", () => {
    expect(stripDecision([item("fix", { tier: "fix" })], seen, NOW, false).show).toBe(false);
    expect(stripDecision([item("a")], emptyState(NOW), NOW, false).show).toBe(false);
  });

  it("寫卡的更新只算給登入的人；兩週前的不算", () => {
    expect(stripDecision([item("a", { audience: "authors" })], seen, NOW, false).show).toBe(false);
    expect(stripDecision([item("a", { audience: "authors" })], seen, NOW, true).show).toBe(true);
    expect(stripDecision([item("a", { announcedAt: NOW - 15 * DAY })], emptyState(0), NOW, false).show).toBe(false);
  });

  it("關掉之後 20 小時內，新上線的也先不出現", () => {
    const closed = acknowledge(seen, NOW - HOUR, true);
    const later = [item("b", { announcedAt: NOW - 30 * 60_000 })];
    expect(stripDecision(later, closed, NOW, false).show).toBe(false);
    expect(stripDecision(later, closed, NOW - HOUR + STRIP_COOLDOWN + 1, false).show).toBe(true);
  });

  it("同一天出現幾次都只算一天；第四天沒理會就自己收起來並推進游標", () => {
    let state = emptyState(NOW - 5 * DAY);
    const items = [item("a", { announcedAt: NOW - 4 * DAY })];
    for (let day = 0; day < 3; day++) {
      const at = NOW - 3 * DAY + day * DAY;
      const first = stripDecision(items, state, at, false);
      expect(first.show).toBe(true);
      state = first.state;
      expect(stripDecision(items, state, at + HOUR, false).state.stripDays).toBe(day + 1);
    }
    const fourth = stripDecision(items, state, NOW, false);
    expect(fourth.show).toBe(false);
    expect(fourth.state.seenThrough).toBe(NOW);
    expect(fourth.state.stripDays).toBe(0);
  });
});

describe("「新」標記", () => {
  it("上線兩週內、沒用過的入口，取最新的三個，而且只算畫面上有掛的", () => {
    const items = [
      item("a", { spotlight: ["header.bell"], announcedAt: NOW - 5 * HOUR }),
      item("b", { spotlight: ["menu.updates", "mine.agent"], announcedAt: NOW - 4 * HOUR }),
      item("c", { spotlight: ["menu.resources"], announcedAt: NOW - 3 * HOUR }),
      item("d", { spotlight: ["header.search"], announcedAt: NOW - 15 * DAY }),
    ];
    const all = ["header.bell", "menu.updates", "mine.agent", "menu.resources", "header.search"];
    expect(spotlightKeys(items, emptyState(0), NOW, false, all)).toEqual(["menu.resources", "menu.updates", "mine.agent"]);
    expect(spotlightKeys(items, { ...emptyState(0), spotlights: ["menu.resources"] }, NOW, false, all)).toEqual(["menu.updates", "mine.agent", "header.bell"]);
    expect(spotlightKeys(items, emptyState(0), NOW, false, ["header.bell"])).toEqual(["header.bell"]);
  });
  it("去過說明的「去試試」那一頁，就算用過它的入口；首頁不算", () => {
    const items = [item("a", { try: "/me/notifications#push", spotlight: ["notifications.push"] }), item("b", { try: "/", spotlight: ["header.search"] })];
    expect(keysForPath(items, "/en/me/notifications")).toEqual(["notifications.push"]);
    expect(keysForPath(items, "/")).toEqual([]);
  });
});

it("兩台裝置的狀態合併：時間取較晚，用過的入口取聯集", () => {
  const a = { seenThrough: 5, stripClosedAt: 1, stripDays: 2, stripDay: "2026-10-04", spotlights: ["x"] };
  const b = { seenThrough: 3, stripClosedAt: 4, stripDays: 0, stripDay: "2026-10-05", spotlights: ["y", "x"] };
  expect(mergeState(a, b)).toEqual({ seenThrough: 5, stripClosedAt: 4, stripDays: 2, stripDay: "2026-10-05", spotlights: ["x", "y"] });
});

// ---- 元件 ----------------------------------------------------------------------

let app: App | undefined;
let el: HTMLElement | undefined;
const fetches: string[] = [];
function respond(items: UpdateItem[], stats = { features: 3, fixes: 2, days: 30 }) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    fetches.push(url);
    return new Response(JSON.stringify({ items, stats }), { headers: { "Content-Type": "application/json" } });
  }));
}
beforeEach(() => { setActivePinia(createPinia()); fetches.length = 0; localStorage.clear(); i18n.global.locale.value = "zh-Hant" as never; vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => { app?.unmount(); el?.remove(); app = undefined; vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function mount(component: object, path = "/") {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div/>" } }] });
  await router.push(path); await router.isReady();
  el = document.createElement("div"); document.body.append(el);
  const pinia = createPinia(); setActivePinia(pinia);
  app = createApp(component).use(pinia).use(router).use(i18n);
  app.mount(el);
  for (let i = 0; i < 5; i++) { await nextTick(); await new Promise((r) => setTimeout(r, 0)); }
  return { root: el, router };
}
const returning = () => localStorage.setItem("hearthroom.pwa.days", JSON.stringify(["2026-10-01"]));

describe("提示列元件", () => {
  it("回訪的人看到最重要的那一則與剩下幾項；按關閉就收起來並記住", async () => {
    returning();
    respond([item("hl", { tier: "highlight", title: "通知鈴鐺會告訴你誰回覆了你。" }), item("a"), item("fix", { tier: "fix" })]);
    const { root } = await mount(UpdateStrip);
    const strip = root.querySelector(".update-strip");
    expect(strip).not.toBeNull();
    expect(root.querySelector(".update-strip__title")!.textContent).toBe("通知鈴鐺會告訴你誰回覆了你。");
    expect(root.querySelector(".update-strip__title")!.getAttribute("href")).toBe("/me/notifications");
    expect(root.querySelector(".update-strip__long")!.textContent).toBe("還有 2 項更新");
    expect(root.querySelector(".update-strip__short")!.textContent).toBe("還有 2 項");
    expect(fetches[0]).toContain("/v1/updates?lang=zh-Hant&view=summary");
    root.querySelector<HTMLButtonElement>(".update-strip__close")!.click();
    await nextTick();
    expect(root.querySelector(".update-strip")).toBeNull();
    const saved = JSON.parse(localStorage.getItem("hearthroom.updates")!);
    expect(saved.stripClosedAt).toBeGreaterThan(0);
    expect(saved.seenThrough).toBeGreaterThan(0);
  });

  it("第一次來的人不出現，即使加到主畫面提示已經記下今天（UTC 日期）", async () => {
    localStorage.setItem("hearthroom.pwa.days", JSON.stringify([new Date().toISOString().slice(0, 10)]));
    localStorage.setItem("hearthroom.provider", "harbor");
    respond([item("hl", { tier: "highlight" })]);
    const { root } = await mount(UpdateStrip);
    expect(root.querySelector(".update-strip")).toBeNull();
  });

  it("Android 下載橫幅會出現時讓位", async () => {
    returning();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/133 Mobile Safari/537.36");
    respond([item("hl", { tier: "highlight" })]);
    const { root } = await mount(UpdateStrip);
    expect(root.querySelector(".update-strip")).toBeNull();
  });
});

describe("「新」標記元件", () => {
  it("掛在入口上，點了入口就收起來", async () => {
    returning();
    respond([item("a", { spotlight: ["header.bell"] })]);
    const Host = { components: { NewMark }, template: '<button class="host">鈴鐺<NewMark k="header.bell" dot /></button>' };
    const { root } = await mount(Host);
    useUpdates();
    await useUpdates().load("zh-Hant");
    await nextTick();
    const mark = root.querySelector<HTMLElement>(".new-mark")!;
    expect(mark.style.display).not.toBe("none");
    root.querySelector<HTMLButtonElement>(".host")!.click();
    await nextTick();
    expect(mark.style.display).toBe("none");
    expect(JSON.parse(localStorage.getItem("hearthroom.updates")!).spotlights).toEqual(["header.bell"]);
  });
});

describe("更新頁", () => {
  it("依日期分組、重點排前面、修正收合；打開這頁就算全部看過", async () => {
    returning();
    respond([
      item("a", { title: "一般更新。", body: "說明。", announcedAt: NOW - HOUR }),
      item("hl", { tier: "highlight", title: "重點更新。", announcedAt: NOW - 2 * HOUR }),
      item("fix1", { tier: "fix", try: null, title: "修好一件事。", announcedAt: NOW - 3 * HOUR }),
      item("older", { title: "前幾天的。", announcedAt: NOW - 3 * DAY, try: "/search" }),
    ]);
    const { root } = await mount(UpdatesPage, "/updates?from=discord");
    expect(fetches.some((u) => u.includes("view=full"))).toBe(true);
    expect(root.querySelector(".updates__lead")!.textContent).toBe("過去 30 天上線了 3 項新功能，修正了 2 個問題。");
    const days = [...root.querySelectorAll(".updates__day")];
    expect(days).toHaveLength(2);
    expect([...days[0]!.querySelectorAll(".updates__title")].map((h) => h.textContent)).toEqual(["重點更新。", "一般更新。"]);
    expect(days[0]!.querySelector(".updates__fixes-toggle")!.textContent).toContain("修正了 1 個問題");
    expect(days[0]!.querySelector(".updates__fix-list")).toBeNull();
    days[0]!.querySelector<HTMLButtonElement>(".updates__fixes-toggle")!.click();
    await nextTick();
    expect(days[0]!.querySelector(".updates__fix-list")!.textContent).toContain("修好一件事。");
    expect(root.querySelector("#older .updates__try")!.getAttribute("href")).toBe("/search");
    expect(root.querySelectorAll(".updates__dot").length).toBeGreaterThan(0);
    expect(JSON.parse(localStorage.getItem("hearthroom.updates")!).seenThrough).toBeGreaterThan(NOW - DAY);
  });

  it("讀不到時說清楚，並給重新載入", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 503 })));
    const { root } = await mount(UpdatesPage, "/updates");
    expect(root.querySelector(".notice--error")!.textContent).toContain("更新紀錄暫時讀不到。");
    expect(root.querySelector(".notice--error button")!.textContent).toBe("重新載入");
  });
});

it("伺服器回了別的形狀時不提示，也不丟例外", async () => {
  returning();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ cards: [] }), { headers: { "Content-Type": "application/json" } })));
  const { root } = await mount(UpdateStrip);
  expect(root.querySelector(".update-strip")).toBeNull();
  expect(useUpdates().items).toEqual([]);
});

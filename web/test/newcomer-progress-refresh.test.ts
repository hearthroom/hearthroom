// 新手七日：在卡片頁分享（或留言、評分）之後回到首頁，首頁的新手卡要看得到達成，不能停在進站時讀到的那一份。
// 玩家回報「分享了三遍還是沒達成」：其實 Harbor 收到了，是首頁一直顯示舊進度（2026-11-23）。
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, profile: null, accessToken: async () => "tok" }) }));
vi.mock("../src/lib/onboarding", async (orig) => ({ ...(await orig<object>()), firstTourPending: () => false }));
import { useCheckin } from "../src/lib/checkin-store";
import NewcomerStrip from "../src/components/checkin/NewcomerStrip.vue";

const panelWith = (status: "locked" | "claimable") => ({
  serverNow: "2026-11-23T12:00:00Z", nextResetAt: "2026-11-23T20:00:00Z", planVersion: 1,
  checkin: { todayClaimed: true }, tasks: { daily: [], weekly: [] },
  newcomer: { active: true, stage: 5, deadline: "2026-12-01T20:00:00Z", today: { stage: 6, goal: "share_link", progress: status === "claimable" ? 1 : 0, target: 1, status },
    stages: [1, 2, 3, 4, 5, 6, 7].map((s) => ({ stage: s, goal: "turns", target: 1, reward: s < 7 ? { credits: 300 } : { chest: "newcomer" }, status: s <= 5 ? "claimed" : "locked" })) },
});
const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

let app: ReturnType<typeof createApp> | undefined;
let panelReads = 0;
beforeEach(() => {
  panelReads = 0;
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (String(url).includes("/rewards/plan")) return json({ version: 1 });
    panelReads++;
    return json(panelWith("claimable"));
  }));
});
afterEach(() => { app?.unmount(); app = undefined; vi.unstubAllGlobals(); });

async function mountStrip(fetchedAgoMs: number) {
  const pinia = createPinia();
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(NewcomerStrip).use(pinia).use(router).use(i18n);
  const store = useCheckin(pinia);
  store.$patch({ panel: panelWith("locked") as never, fetchedAt: Date.now() - fetchedAgoMs });
  const root = document.createElement("div");
  app.mount(root);
  await vi.waitFor(() => expect(store.loading).toBe(false));
  await nextTick();
  return { root, store };
}
const goal = (root: HTMLElement) => root.querySelector(".ns__goal")?.textContent?.trim();

it("回到首頁時進度是一陣子以前讀的：重讀一次，達成了就換成領取", async () => {
  const { root } = await mountStrip(60_000);
  expect(panelReads).toBe(1);
  expect(goal(root)).toBe(i18n.global.t("newcomer.home.claimable"));
  expect(root.querySelector(".ns__go")?.textContent?.trim()).toBe(i18n.global.t("task.cta.claim"));
});

it("剛剛才讀過：不重讀", async () => {
  await mountStrip(0);
  expect(panelReads).toBe(0);
});

it("從別的 app 切回這個分頁：重讀", async () => {
  const { root, store } = await mountStrip(0);
  expect(panelReads).toBe(0);
  store.$patch({ fetchedAt: Date.now() - 60_000 });
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
  document.dispatchEvent(new Event("visibilitychange"));
  await vi.waitFor(() => expect(panelReads).toBe(1));
  await vi.waitFor(() => expect(goal(root)).toBe(i18n.global.t("newcomer.home.claimable")));
});

it("分享之後（markStale）：剛讀過也照樣重讀", async () => {
  const { store } = await mountStrip(0);
  expect(panelReads).toBe(0);
  store.markStale();
  await store.refresh();
  expect(panelReads).toBe(1);
});

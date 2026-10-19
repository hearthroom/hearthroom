// 簽到頁的蘇綺是頁面插圖，桌寵整頁退場（美術總監最終 r1 H1）。
// 桌寵是閒置後才載入的：頁面在她出來之前就掛好，所以退場要由路由決定，不能靠頁面掛載時丟一次事件。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const calls: { type: string; on?: boolean }[] = [];
vi.mock("../src/pet/pet-ui", () => ({
  SukiPet: class {
    async start() {}
    stop() {}
    on(e: { type: string; on?: boolean }) { calls.push(e); }
    setGuide() {}
    tuckAside() {}
    setSkin() { return Promise.resolve(); }
  },
}));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ ready: true, me: null, wallet: null, accessToken: async () => null }) }));
vi.mock("../src/lib/notifications", () => ({ useNotifications: () => ({ unread: 0, items: [] }), noticeText: () => "" }));
vi.mock("../src/lib/review", () => ({ useReviewer: () => ({ pending: 0 }) }));

import SukiPet from "../src/components/SukiPet.vue";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => { app?.unmount(); calls.length = 0; });

it("hides the desk pet on the check-in page and brings her back elsewhere", async () => {
  vi.stubGlobal("requestIdleCallback", (f: () => void) => f());
  const page = defineComponent({ render: () => h("div") });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: page }, { path: "/checkin", component: page, meta: { petAway: true } }],
  });
  await router.push("/checkin");
  app = createApp(SukiPet).use(router).use(i18n);
  app.mount(document.createElement("div"));
  for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); }
  expect(calls.filter((c) => c.type === "away").at(-1)).toEqual({ type: "away", on: true });

  await router.push("/");
  await nextTick();
  expect(calls.filter((c) => c.type === "away").at(-1)).toEqual({ type: "away", on: false });
  vi.unstubAllGlobals();
});

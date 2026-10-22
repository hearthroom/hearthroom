// 桌寵四十多張貼圖約 740 KB：頁面還在載入（卡片頁的橫幅、封面還在下載）時不出來搶頻寬，
// 等 load 事件之後、瀏覽器空閒才載（100257 實測：原本 3 秒一到就開抓，跟 LCP 的橫幅搶了好幾秒）。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const started = vi.fn();
vi.mock("../src/pet/pet-ui", () => ({
  SukiPet: class {
    async start() { started(); }
    stop() {}
    on() {}
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
afterEach(() => { app?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };

it("頁面還在載入時不出來，load 之後才載", async () => {
  vi.stubGlobal("requestIdleCallback", (f: () => void) => f());
  const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: defineComponent({ render: () => h("div") }) }] });
  await router.push("/");
  app = createApp(SukiPet).use(router).use(i18n);
  app.mount(document.createElement("div"));
  await settle();
  expect(started).not.toHaveBeenCalled();
  state.mockReturnValue("complete");
  window.dispatchEvent(new Event("load"));
  await settle();
  expect(started).toHaveBeenCalledTimes(1);
});

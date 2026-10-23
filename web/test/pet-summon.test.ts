// 設定頁的「叫她出來」（任務 2026-10-23 曲面屏 ui-v3.md §2.6）：找不到她或她卡住時的脫離工具。
// 清掉存的位置；她被關掉的話也開回來；出來之後在預設的位置拉出來打招呼。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const calls: { type: string }[] = [];
// 真的桌寵自己聽 window 的 suki 事件；這裡一起記下來
addEventListener("suki", (e) => calls.push((e as CustomEvent<{ type: string }>).detail));
vi.mock("../src/pet/pet-ui", () => ({
  SukiPet: class {
    async start() {}
    stop() {}
    on(e: { type: string }) { calls.push(e); }
    setGuide() {}
    tuckAside() {}
    setSkin() { return Promise.resolve(); }
  },
}));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ ready: true, me: null, wallet: null, accessToken: async () => null }) }));
vi.mock("../src/lib/notifications", () => ({ useNotifications: () => ({ unread: 0, items: [] }), noticeText: () => "" }));
vi.mock("../src/lib/review", () => ({ useReviewer: () => ({ pending: 0 }) }));

import SukiPet from "../src/components/SukiPet.vue";
import { petEnabled, summonPet } from "../src/pet/enabled";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => { app?.unmount(); app = undefined; calls.length = 0; vi.unstubAllGlobals(); });
const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };

async function mount() {
  vi.stubGlobal("requestIdleCallback", (f: () => void) => f());
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/", component: defineComponent({ render: () => h("div") }) }] });
  await router.push("/");
  app = createApp(SukiPet).use(router).use(i18n);
  app.mount(document.createElement("div"));
  await settle();
}

it("她在的時候：清掉存的位置，叫她出來", async () => {
  petEnabled.value = true;
  localStorage.setItem("suki.pet.pos", JSON.stringify({ x: 2, y: 0.7 }));
  await mount();
  summonPet();
  await settle();
  expect(localStorage.getItem("suki.pet.pos")).toBeNull();
  expect(calls.filter((c) => c.type === "summon")).toHaveLength(1);
});

it("她被關掉的時候：開回來，出來之後拉出來打招呼", async () => {
  petEnabled.value = false;
  await nextTick();
  await mount();
  expect(calls).toHaveLength(0);
  summonPet();
  await settle();
  expect(petEnabled.value).toBe(true);
  expect(localStorage.getItem("suki.pet.off")).toBeNull();
  expect(calls.filter((c) => c.type === "summon")).toHaveLength(1);
});

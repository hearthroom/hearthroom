// 畫布「積分不夠」那張卡的月卡連結先到 /go/plan：記一筆點擊、立刻送出，再轉去 Console 的月卡分段。
// 轉址會讓頁面馬上離開，排隊等閒置才送的埋點在 iOS 常常送不出去，所以要先送再走。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createRouter, createMemoryHistory } from "vue-router";

vi.mock("../src/lib/rewards", async (orig) => ({ ...(await orig<typeof import("../src/lib/rewards")>()), fetchPeriodPlans: vi.fn(async () => ({ list: [{ id: "month", onSale: true, purchaseUrl: "https://console.example/me/billing?plan=month" }] })) }));
import GoPlanPage from "../src/pages/GoPlanPage.vue";
import { trackNow } from "../src/lib/track";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => { app?.unmount(); vi.restoreAllMocks(); });

function beacons(spy: ReturnType<typeof vi.spyOn>) {
  return spy.mock.calls.map(([, blob]) => blob as Blob);
}

it("trackNow 立刻送出，不等閒置", () => {
  const spy = vi.spyOn(navigator, "sendBeacon").mockReturnValue(true);
  trackNow("credits_shortfall_click", { detail: "plan" });
  expect(spy).toHaveBeenCalledTimes(1);
});

async function visit(path: string) {
  const order: string[] = [];
  const spy = vi.spyOn(navigator, "sendBeacon").mockImplementation(() => { order.push("beacon"); return true; });
  const replace = vi.fn((url: string) => { order.push(`replace:${url}`); });
  vi.stubGlobal("location", { ...window.location, replace });
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/go/plan", component: GoPlanPage }] });
  await router.push(path); await router.isReady();
  app = createApp(GoPlanPage).use(router);
  app.mount(document.createElement("div"));
  for (let i = 0; i < 5; i++) await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  vi.unstubAllGlobals();
  return { order, spy, replace };
}

it("從積分不夠那張卡來：先送出點擊，再轉去月卡的購買頁", async () => {
  const { order, spy } = await visit("/go/plan?from=canvas_shortfall");
  expect(order).toEqual(["beacon", "replace:https://console.example/me/billing?plan=month"]);
  const sent = JSON.parse(await beacons(spy)[0]!.text());
  expect(sent).toEqual([expect.objectContaining({ event: "credits_shortfall_click", detail: "plan" })]);
});

it("不是從那張卡來：不記，照樣轉址，網址不帶任何應用參數", async () => {
  const { order } = await visit("/go/plan");
  expect(order).toEqual(["replace:https://console.example/me/billing?plan=month"]);
});

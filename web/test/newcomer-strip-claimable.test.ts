// 新手七日：今天的目標做到了還沒領（Harbor 要領取才入帳），首頁常駐卡只留一個「領取」入口，
// 帶到簽到頁的新手區塊；不再開導覽（PM 2026-10-19）。
import { afterEach, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 1 }, profile: null, accessToken: async () => "tok" }) }));
vi.mock("../src/lib/onboarding", async (orig) => ({ ...(await orig<object>()), firstTourPending: () => false }));
import { useCheckin } from "../src/lib/checkin-store";
import NewcomerStrip from "../src/components/checkin/NewcomerStrip.vue";

let app: ReturnType<typeof createApp> | undefined;
afterEach(() => app?.unmount());

async function mount(status: "locked" | "claimable") {
  const pinia = createPinia();
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  await router.push("/");
  app = createApp(NewcomerStrip).use(pinia).use(router).use(i18n);
  useCheckin(pinia).$patch({ panel: { serverNow: "2026-10-19T12:00:00Z", newcomer: { active: true, stage: 0, deadline: "2026-11-01T20:00:00Z", today: { stage: 1, goal: "turns", progress: status === "claimable" ? 3 : 1, target: 3, status }, stages: [1, 2, 3, 4, 5, 6, 7].map((s) => ({ stage: s, goal: "turns", target: 3, reward: s < 7 ? { credits: 300 } : { chest: "newcomer" }, status: "locked" })) } } as never });
  const root = document.createElement("div"); app.mount(root); await nextTick();
  return root;
}

it("offers one claim entry that goes to the newcomer block", async () => {
  const root = await mount("claimable");
  const go = root.querySelector(".ns__go");
  expect(go?.tagName).toBe("A");
  expect(go?.getAttribute("href")).toBe("/checkin#newcomer");
  expect(go?.textContent?.trim()).toBe(i18n.global.t("task.cta.claim"));
  expect(root.querySelector(".ns__goal")?.textContent?.trim()).toBe(i18n.global.t("newcomer.home.claimable"));
});

it("keeps the guide button while the goal is not reached", async () => {
  const root = await mount("locked");
  expect(root.querySelector(".ns__go")?.tagName).toBe("BUTTON");
});

/**
 * 成人內容的門：沒登入 → 要登入（回到這張卡）；登入沒驗年齡 → 就地填生日、驗過就開；驗過但關著 → 一鍵開。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const session = vi.hoisted(() => ({
  me: null as null | { accountNumId: number; nickName: string; avatar: string },
  profile: null as null | { showNsfw: boolean; ageVerified: boolean },
  accessToken: async () => "tok",
}));
const api = vi.hoisted(() => ({
  updateSiteSettings: vi.fn(async (input: { showNsfw: boolean; birthdate?: string }) => ({ showNsfw: input.showNsfw, ageVerified: true })),
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string, readonly code = "") { super(message); } },
}));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/api", () => api);

import AdultGate from "../src/components/AdultGate.vue";

let app: App | null = null;
let el: HTMLElement | null = null;
async function mount(path = "/cards/x") {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: AdultGate }] });
  await router.push(path);
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(createPinia()).use(router).use(i18n);
  app.mount(el);
  await nextTick();
  return el;
}
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; api.updateSiteSettings.mockClear(); });

describe("AdultGate", () => {
  it("沒登入：要登入，登入後回到這張卡", async () => {
    session.me = null;
    const el = await mount("/cards/abc");
    expect(el.textContent).toContain(i18n.global.t("card.gate.login"));
    const a = el.querySelector<HTMLAnchorElement>("a.btn")!;
    expect(a.getAttribute("href")).toContain("/login?returnTo=%2Fcards%2Fabc");
  });

  it("登入沒驗年齡：填生日送出，驗過就開（一次性）", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    session.profile = { showNsfw: false, ageVerified: false };
    const el = await mount();
    const input = el.querySelector<HTMLInputElement>("input[type=date]")!;
    expect(input).not.toBeNull();
    input.value = "2000-01-01";
    input.dispatchEvent(new Event("input"));
    await nextTick();
    el.querySelector("form")!.dispatchEvent(new Event("submit"));
    await nextTick();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.updateSiteSettings).toHaveBeenCalledWith({ showNsfw: true, birthdate: "2000-01-01" }, "tok");
    expect(session.profile).toEqual({ showNsfw: true, ageVerified: true });
  });

  it("驗過年齡但關著：一鍵開，不再問生日", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    session.profile = { showNsfw: false, ageVerified: true };
    const el = await mount();
    expect(el.querySelector("input[type=date]")).toBeNull();
    el.querySelector<HTMLButtonElement>("button.btn--primary")!.click();
    await new Promise((r) => setTimeout(r, 0));
    expect(api.updateSiteSettings).toHaveBeenCalledWith({ showNsfw: true }, "tok");
  });
});

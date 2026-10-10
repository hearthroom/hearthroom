/**
 * 成人內容的門：沒登入 → 跟登入的人一樣確認年齡（遊客憑證，owner 2026-10-10）；站上發不出遊客憑證（自架站）才要登入（回到這張卡）；
 * 登入沒驗年齡或沒同意聲明 → 開聲明窗（勾同意，沒驗過再填生日）；
 * 驗過也同意過但關著 → 一鍵開。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

const session = vi.hoisted(() => ({
  ready: true,
  me: null as null | { accountNumId: number; nickName: string; avatar: string },
  profile: null as null | { showNsfw: boolean; ageVerified: boolean; adultConsent: boolean },
  accessToken: async () => "tok",
}));
const api = vi.hoisted(() => ({
  updateSiteSettings: vi.fn(async (input: { showNsfw: boolean; birthdate?: string }) => ({ showNsfw: input.showNsfw, ageVerified: true, adultConsent: true })),
  guestAvailable: true,
  updateGuestAdult: vi.fn(async function (this: unknown, input: { showNsfw?: boolean } = {}) {
    if (!api.guestAvailable) throw new Error("not_found");
    return { showNsfw: input.showNsfw ?? false, ageVerified: input.showNsfw === true, adultConsent: input.showNsfw === true };
  }),
  ApiError: class ApiError extends Error { constructor(readonly status: number, message: string, readonly code = "") { super(message); } },
}));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/api", () => api);

import AdultGate from "../src/components/AdultGate.vue";
import { forgetGuestAdult } from "../src/lib/adult-consent";
import { ADULT_CONSENT_VERSION } from "../../shared/adult-consent";

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
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; api.updateSiteSettings.mockClear(); api.updateGuestAdult.mockClear(); api.guestAvailable = true; forgetGuestAdult(); });
const flush = async () => { for (let i = 0; i < 4; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

describe("AdultGate", () => {
  it("自架站沒登入（發不出遊客憑證）：要登入，登入後回到這張卡", async () => {
    session.me = null;
    api.guestAvailable = false;
    const el = await mount("/cards/abc");
    await flush();
    expect(el.textContent).toContain(i18n.global.t("card.gate.login"));
    const a = el.querySelector<HTMLAnchorElement>("a.btn")!;
    expect(a.getAttribute("href")).toContain("/login?returnTo=%2Fcards%2Fabc");
  });

  it("遊客：不必登入，填生日、勾同意送到遊客憑證；不提使用者設定", async () => {
    session.me = null;
    const el = await mount("/cards/abc");
    await flush();
    expect(el.textContent).toContain(i18n.global.t("card.gate.verify"));
    expect(el.textContent).not.toContain(i18n.global.t("card.gate.settingsHint"));
    el.querySelector<HTMLButtonElement>(".gate button.btn--primary")!.click();
    await flush();
    const input = document.querySelector<HTMLInputElement>(".dlg input[type=date]")!;
    const box = document.querySelector<HTMLInputElement>(".dlg input[type=checkbox]")!;
    input.value = "2000-01-01"; input.dispatchEvent(new Event("input"));
    box.checked = true; box.dispatchEvent(new Event("change"));
    await nextTick();
    document.querySelector("form.dlg")!.dispatchEvent(new Event("submit"));
    await flush();
    expect(api.updateGuestAdult).toHaveBeenLastCalledWith({ showNsfw: true, birthdate: "2000-01-01", consentVersion: ADULT_CONSENT_VERSION });
    expect(api.updateSiteSettings).not.toHaveBeenCalled();
    expect(document.querySelector(".dlg")).toBeNull();
  });

  it("登入沒驗年齡：按下去開聲明窗，勾同意、填生日送出才開", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    session.profile = { showNsfw: false, ageVerified: false, adultConsent: false };
    const el = await mount();
    el.querySelector<HTMLButtonElement>(".gate button.btn--primary")!.click();
    await flush();
    expect(api.updateSiteSettings).not.toHaveBeenCalled();
    const input = document.querySelector<HTMLInputElement>(".dlg input[type=date]")!;
    const box = document.querySelector<HTMLInputElement>(".dlg input[type=checkbox]")!;
    input.value = "2000-01-01";
    input.dispatchEvent(new Event("input"));
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await nextTick();
    document.querySelector("form.dlg")!.dispatchEvent(new Event("submit"));
    await flush();
    expect(api.updateSiteSettings).toHaveBeenCalledWith({ showNsfw: true, birthdate: "2000-01-01", consentVersion: ADULT_CONSENT_VERSION }, "tok");
    expect(session.profile).toEqual({ showNsfw: true, ageVerified: true, adultConsent: true });
    expect(document.querySelector(".dlg")).toBeNull();
  });

  it("驗過年齡但沒同意這一版聲明：聲明窗不問生日，只要勾同意", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    session.profile = { showNsfw: false, ageVerified: true, adultConsent: false };
    const el = await mount();
    el.querySelector<HTMLButtonElement>(".gate button.btn--primary")!.click();
    await flush();
    expect(document.querySelector(".dlg input[type=date]")).toBeNull();
    const box = document.querySelector<HTMLInputElement>(".dlg input[type=checkbox]")!;
    box.checked = true;
    box.dispatchEvent(new Event("change"));
    await nextTick();
    document.querySelector("form.dlg")!.dispatchEvent(new Event("submit"));
    await flush();
    expect(api.updateSiteSettings).toHaveBeenCalledWith({ showNsfw: true, consentVersion: ADULT_CONSENT_VERSION }, "tok");
  });

  it("驗過也同意過但關著：一鍵開，不跳聲明", async () => {
    session.me = { accountNumId: 7, nickName: "月光", avatar: "" };
    session.profile = { showNsfw: false, ageVerified: true, adultConsent: true };
    const el = await mount();
    el.querySelector<HTMLButtonElement>(".gate button.btn--primary")!.click();
    await flush();
    expect(document.querySelector(".dlg")).toBeNull();
    expect(api.updateSiteSettings).toHaveBeenCalledWith({ showNsfw: true }, "tok");
  });
});

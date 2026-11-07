import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import * as i18nMod from "../src/lib/i18n";
import { applyLocale, detectLocale, i18n } from "../src/lib/i18n";

vi.mock("../src/lib/stage-preload", () => ({ preloadStage: async () => {} }));
vi.mock("../src/lib/session", () => ({
  useSession: () => ({ restore: async () => {}, accessToken: async () => null, me: { accountNumId: 1 } }),
}));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("../src/pages/BoardPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/CardPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/SettingsPage.vue", () => ({ default: { template: "<div />" } }));

import * as routerMod from "../src/router";
import { router } from "../src/router";
import LocaleSwitch from "../src/components/LocaleSwitch.vue";
import SettingsAppearance from "../src/components/settings/SettingsAppearance.vue";

let app: App | null = null;
let host: HTMLElement | null = null;

function setBrowserLanguages(languages: string[]) {
  vi.stubGlobal("navigator", {
    userAgent: "Test",
    language: languages[0] ?? "zh-TW",
    languages,
    sendBeacon: () => true,
  });
}

function resetFirstNavigation() {
  (routerMod as { resetFirstNavigationForTest?: () => void }).resetFirstNavigationForTest?.();
}

beforeEach(async () => {
  localStorage.removeItem(i18nMod.LOCALE_STORAGE_KEY ?? "hearthroom.locale");
  resetFirstNavigation();
  await applyLocale("zh-Hant");
});

afterEach(() => {
  app?.unmount();
  host?.remove();
  app = null;
  host = null;
  localStorage.removeItem(i18nMod.LOCALE_STORAGE_KEY ?? "hearthroom.locale");
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("手動切換語言記憶與首次導航", () => {
  it("未主動切換時：首次進無前綴網址依瀏覽器語言轉址，且不把自動偵測結果寫入 localStorage", async () => {
    setBrowserLanguages(["zh-CN", "zh"]);
    resetFirstNavigation();
    await router.push("/");
    expect(router.currentRoute.value.fullPath).toBe("/zh-Hans");
    expect(localStorage.getItem(i18nMod.LOCALE_STORAGE_KEY ?? "hearthroom.locale")).toBeNull();
  });

  it("在 LocaleSwitch 切到繁體中文後記住選擇；瀏覽器為 zh-CN 時重新整理 / 仍留在繁體中文", async () => {
    setBrowserLanguages(["zh-CN", "zh"]);
    await router.push("/zh-Hans");
    await router.isReady();

    host = document.createElement("div");
    document.body.appendChild(host);
    app = createApp(LocaleSwitch).use(router).use(i18n);
    app.mount(host);
    await nextTick();

    host.querySelector<HTMLButtonElement>(".lang__btn")!.click();
    await nextTick();
    const zhHantOption = [...host.querySelectorAll<HTMLButtonElement>(".lang__item")].find((btn) =>
      btn.textContent?.includes("繁體中文"),
    );
    expect(zhHantOption).toBeDefined();
    zhHantOption!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/"));
    expect(i18nMod.savedLocale()).toBe("zh-Hant");

    // 模擬重新整理：先移到別處再以首次導航進 /，瀏覽器仍是 zh-CN
    await router.push("/zh-Hans/settings");
    resetFirstNavigation();
    await router.push("/");
    expect(router.currentRoute.value.fullPath).toBe("/");
    expect(i18n.global.locale.value).toBe("zh-Hant");
  });

  it("在 SettingsAppearance 切換語言後記住選擇；下次從無前綴網址進站優先採用記住的語言", async () => {
    setBrowserLanguages(["zh-TW"]);
    await router.push("/settings");
    await router.isReady();

    host = document.createElement("div");
    document.body.appendChild(host);
    app = createApp(SettingsAppearance).use(router).use(i18n);
    app.mount(host);
    await nextTick();

    const jaBtn = host.querySelector<HTMLButtonElement>('[data-settings-locale="ja"]');
    expect(jaBtn).not.toBeNull();
    jaBtn!.click();
    await vi.waitFor(() => expect(router.currentRoute.value.fullPath).toBe("/ja/settings"));
    expect(i18nMod.savedLocale()).toBe("ja");

    // 模擬下次直接打開無前綴首頁 /
    resetFirstNavigation();
    await router.push("/");
    expect(router.currentRoute.value.fullPath).toBe("/ja");
  });

  it("帶語言前綴的分享連結一律照網址前綴走，且不覆蓋原本記住的語言偏好", async () => {
    setBrowserLanguages(["zh-TW"]);
    i18nMod.rememberLocale("zh-Hant");

    resetFirstNavigation();
    await router.push("/en/cards/100269");
    expect(router.currentRoute.value.fullPath).toBe("/en/cards/100269");
    expect(i18n.global.locale.value).toBe("en");
    expect(i18nMod.savedLocale()).toBe("zh-Hant");
  });

  it("localStorage 讀寫拋錯時退回瀏覽器語言判斷且不拋出例外", () => {
    setBrowserLanguages(["zh-CN"]);
    vi.spyOn(localStorage, "setItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });
    vi.spyOn(localStorage, "getItem").mockImplementation(() => {
      throw new DOMException("Blocked", "SecurityError");
    });

    expect(() => i18nMod.rememberLocale("zh-Hant")).not.toThrow();
    expect(i18nMod.savedLocale()).toBeNull();
    expect(detectLocale()).toBe("zh-Hans");
  });
});

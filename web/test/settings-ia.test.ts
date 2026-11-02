/**
 * 使用者設定改成標準 App 列表（任務 2026-11-03-settings-ia，規格 docs/studio/tasks/2026-11-03-settings-ia/ui.md）：
 * 第一層是列表，點進去是 /settings/<區>；手機是二級頁、桌機是右側面板（同一個元件、同一條路由，版面看容器寬度）。
 * 舊的 #hidden、#leaderboard-privacy 深連結導到新的區；蘇綺的救援入口從帳號選單搬到「疑難排解」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { computed, createApp, nextTick, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";

const session = vi.hoisted(() => ({
  ready: true,
  displayName: "月光", avatarUrl: "",
  me: { accountNumId: 7, nickName: "月光", avatar: "" },
  profile: {
    handle: "kxxoxfyb", memberSince: 0, reviewer: false, identities: [] as unknown[],
    showNsfw: false, ageVerified: true, adultConsent: true, showStats: false, hiddenTags: [] as string[],
  },
  accessToken: async () => "tok",
}));
vi.mock("../src/lib/session", () => ({ useSession: () => session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "settings", setSurface: () => {} }));
vi.mock("../src/lib/review", () => ({ useReviewer: () => ({ reviewer: false }) }));
vi.mock("../src/lib/connections", () => ({ connectAccount: vi.fn(async () => undefined), accountToken: async () => null }));
const settingsCalls = vi.hoisted(() => [] as unknown[]);
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<object>()),
  fetchPlayerPersona: async () => ({ nickName: "月光", userName: "", userSex: "", userDefine: "" }),
  updateSiteSettings: async (patch: Record<string, unknown>) => { settingsCalls.push(patch); return { ...session.profile, ...patch }; },
}));
vi.mock("../src/lib/community", async (original) => ({ ...(await original<object>()), communityRequest: async () => ({ recall: false }) }));

import SettingsPage from "../src/pages/SettingsPage.vue";
import { scrollFor, settingsRedirect } from "../src/router";
import { guideFor } from "../src/pet/guides";
import { gaPage } from "../src/lib/ga4-payload";
import { siteLinksKey } from "../src/lib/site-links";
import { petEnabled } from "../src/pet/enabled";
import { useAppearance } from "../src/lib/appearance";

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };

async function mount(path: string, o: { routeLine?: boolean } = {}): Promise<{ el: HTMLElement; router: Router }> {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/settings/:section?", component: SettingsPage, meta: { settings: true } },
      { path: "/:pathMatch(.*)*", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  await router.isReady();
  app = createApp({ template: "<RouterView />" }).use(createPinia()).use(router).use(i18n);
  app.provide(siteLinksKey, computed(() => ({ repoUrl: "", license: "", discordInvite: null, showDownloadEntry: false, canInstallSite: false, routeLine: o.routeLine ? { name: "routes.name.1", host: "sukisuki.ai" } : null })));
  app.mount(el);
  await flush();
  return { el, router };
}
beforeEach(() => { vi.stubGlobal("fetch", async () => new Response("{}", { status: 404, headers: { "Content-Type": "application/json" } })); });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; settingsCalls.length = 0; vi.unstubAllGlobals(); });

const t = (k: string) => i18n.global.t(k);
const at = (path: string, hash = "", params: Record<string, string> = {}, meta: Record<string, unknown> = { settings: true }) => ({ path, hash, query: {}, params, meta }) as never;

describe("網址", () => {
  it("每個區都有自己的網址，語言前綴照舊", async () => {
    const { router } = await import("../src/router");
    for (const prefix of ["", "/en", "/ko"]) {
      for (const section of ["", "/profile", "/play", "/content", "/appearance", "/links", "/help"]) {
        const r = router.resolve(`${prefix}/settings${section}`);
        expect(r.meta.settings, r.fullPath).toBe(true);
        expect(r.meta.auth).toBe(true);
      }
    }
  });

  it("不認得的區回到列表；舊的 #hidden 與 #leaderboard-privacy 換到它們現在所在的區", () => {
    expect(settingsRedirect(at("/settings/nope", "", { section: "nope" }))).toMatchObject({ path: "/settings", replace: true });
    expect(settingsRedirect(at("/settings", "#hidden"))).toMatchObject({ path: "/settings/content", hash: "#hidden", replace: true });
    expect(settingsRedirect(at("/en/settings", "#leaderboard-privacy", { locale: "en" }))).toMatchObject({ path: "/en/settings/profile", hash: "#leaderboard-privacy" });
    expect(settingsRedirect(at("/settings"))).toBeNull();
    expect(settingsRedirect(at("/settings/content", "#hidden", { section: "content" }))).toBeNull();
    expect(settingsRedirect(at("/wallet", "#hidden", {}, {}))).toBeNull();
  });

  it("在設定裡換區不動捲動位置；離開設定照舊回頂端", () => {
    expect(scrollFor(at("/settings/content", "", { section: "content" }), at("/settings/profile", "", { section: "profile" }), null)).toBe(false);
    expect(scrollFor(at("/wallet", "", {}, {}), at("/settings/profile", "", { section: "profile" }), null)).toEqual({ top: 0 });
  });

  it("桌寵導覽與 GA 頁面類型把子路徑當成同一頁", () => {
    expect(guideFor("/settings/play")?.id).toBe("settings");
    expect(guideFor("/en/settings")?.id).toBe("settings");
    const page = gaPage("https://sukisuki.ai/settings/appearance");
    expect(page?.page_type).toBe("settings");
    expect(page?.page_location).toBe("https://sukisuki.ai/settings");
  });
});

describe("第一層列表", () => {
  it("三群七列，通知直接去通知頁，其餘進各自的區", async () => {
    const { el } = await mount("/settings");
    const rows = [...el.querySelectorAll<HTMLAnchorElement>("[data-settings-nav] a")];
    expect(rows.map((a) => a.getAttribute("href"))).toEqual([
      "/settings/profile", "/me/notifications", "/settings/links",
      "/settings/play", "/settings/content", "/settings/appearance",
      "/settings/help",
    ]);
    expect(el.querySelectorAll("[data-settings-nav] .panel")).toHaveLength(3);
  });

  it("沒選區時桌機預設顯示個人資料，網址不改", async () => {
    const { el, router } = await mount("/settings");
    expect(router.currentRoute.value.path).toBe("/settings");
    expect(el.querySelector("[data-settings-section]")?.getAttribute("data-settings-section")).toBe("profile");
    expect(el.querySelector(".settings")?.classList.contains("settings--root")).toBe(true);
  });

  it("選了區：列表標出目前那列，二級頁有回到列表的返回鈕", async () => {
    const { el } = await mount("/settings/content");
    expect(el.querySelector('[data-settings-nav] a[aria-current="page"]')?.getAttribute("href")).toBe("/settings/content");
    expect(el.querySelector(".settings")?.classList.contains("settings--root")).toBe(false);
    const back = el.querySelector<HTMLButtonElement>(".settings__back");
    expect(back?.textContent).toContain(t("settings.title"));
  });

  it("從深連結直接進二級頁，返回鈕回到列表", async () => {
    const { el, router } = await mount("/settings/content");
    el.querySelector<HTMLButtonElement>(".settings__back")!.click();
    await flush();
    expect(router.currentRoute.value.path).toBe("/settings");
  });
});

describe("各區的設定都還在", () => {
  it("個人資料：編輯資料、主頁數據、榜單隱私", async () => {
    const { el } = await mount("/settings/profile");
    expect(el.querySelector('a[href="/me?edit=1"]')).not.toBeNull();
    expect(el.textContent).toContain(t("settings.profile.stats"));
    expect(el.querySelector("#leaderboard-privacy")).not.toBeNull();
  });

  it("遊玩：人設表單與儲存鈕", async () => {
    const { el } = await mount("/settings/play");
    expect(el.querySelector("#persona-name")).not.toBeNull();
    expect(el.querySelector('button[type="submit"]')?.textContent).toContain(t("settings.save"));
  });

  it("內容：成人內容開關與不想看的類型，點類型會存", async () => {
    const { el } = await mount("/settings/content");
    expect(el.textContent).toContain(t("settings.content.nsfw"));
    const chip = el.querySelector<HTMLButtonElement>("#hidden .tagchip")!;
    chip.click();
    await flush();
    expect(settingsCalls).toHaveLength(1);
  });

  it("外觀與語言：外觀、語言、蘇綺；在這裡換主題就是頁首那一份", async () => {
    const { el } = await mount("/settings/appearance");
    const { theme } = useAppearance();
    const ink = el.querySelector<HTMLButtonElement>('[data-theme-id="ink"]')!;
    ink.click();
    expect(theme.value).toBe("ink");
    expect(el.querySelectorAll("[data-settings-locale]")).toHaveLength(5);
    expect(el.textContent).toContain(t("settings.pet.label"));
    expect(el.textContent).toContain(t("settings.pet.recall"));
    useAppearance().setTheme("coral");
  });

  it("外觀與語言：換語言就換網址，停在同一區", async () => {
    const { el, router } = await mount("/settings/appearance");
    el.querySelector<HTMLButtonElement>('[data-settings-locale="en"]')!.click();
    await flush();
    expect(router.currentRoute.value.path).toBe("/en/settings/appearance");
  });

  it("連結與授權：Discord 社群與登入授權", async () => {
    const { el } = await mount("/settings/links");
    expect(el.querySelector('a[href="/me/community"]')).not.toBeNull();
    expect(el.querySelector(".accounts, [data-connected-accounts]") ?? el.textContent?.includes("HarperHarbor")).toBeTruthy();
  });

  it("疑難排解：叫她出來會把關掉的蘇綺開回來；有線路時顯示目前線路", async () => {
    petEnabled.value = false;
    const { el } = await mount("/settings/help", { routeLine: true });
    el.querySelector<HTMLButtonElement>("[data-settings-summon]")!.click();
    expect(petEnabled.value).toBe(true);
    expect(el.textContent).toContain(t("routes.name.1"));
    expect(el.querySelector("[data-settings-routes]")).not.toBeNull();
  });

  it("疑難排解：不在官方網域（沒有線路）時不放線路卡", async () => {
    const { el } = await mount("/settings/help");
    expect(el.querySelector("[data-settings-routes]")).toBeNull();
  });
});

/**
 * 國家／地區（owner 2026-11-03）：真的 session store、真的 api 客戶端、假的 fetch，照正式站的託管登入走。
 *   - 個人資料的第一次讀取帶「介面語言」：新成員的地區預設照介面語言決定，不照瀏覽器語言；
 *   - 設定頁的「內容」區有國家／地區，十個選項分兩組；選了就存，伺服器回什麼就顯示什麼；
 *   - 選中國大陸：設定頁的成人內容開關、頁首 R18 鈕都收起來；切回去，原本的成人設定照舊回來；
 *   - 卡片頁被地區擋下（403 region_unavailable）：畫「暫不提供」，不是 404、不是成人內容的門，
 *     剛才那一屏記住的卡也不能先畫出來；
 *   - 圖書館的請求被擋時錯誤碼要留著（遊玩頁靠它分辨舊聊天連結被地區擋下）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "settings", setSurface: () => {} }));
vi.mock("moonstage/stage", () => ({}));
vi.mock("moonstage/stage.css", () => ({}));

import SettingsPage from "../src/pages/SettingsPage.vue";
import CardPage from "../src/pages/CardPage.vue";
import AdultToggle from "../src/components/AdultToggle.vue";
import { useSession } from "../src/lib/session";
import { resetManagedAuthForTest } from "../src/lib/managed-auth";
import { recallCard, rememberCard } from "../src/lib/card-memory";
import { libraryRequest } from "../src/lib/library";
import { ApiError } from "../src/lib/api";

/** 伺服器那一份：地區＋成人偏好。中國大陸一律回 showNsfw:false，但原本的偏好不刪 */
const server = { region: "TW", sessionRegion: "TW", wantsNsfw: true, cardRegionBlocked: false };
/** 設定頁補讀 GET /v1/me 的回應：有值時先擋著，等測試放行（模擬網路慢） */
let holdMe: Promise<void> | null = null;
const view = () => ({ showNsfw: server.region !== "CN" && server.wantsNsfw, ageVerified: true, adultConsent: true, hiddenTags: [], showStats: false, countryRegion: server.region });
const profile = (region: string) => ({ handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [{ provider: "harbor", externalId: 7, linkedAt: 0 }], ...view(), countryRegion: region });
const requests: { method: string; url: string; headers: Headers; body?: string }[] = [];

const CARD = {
  id: "abc", num: 100300, roleId: "role-abc", zone: "zh", name: "記住的成人卡", summary: "s", names: { zh: "記住的成人卡", en: "", ja: "", ko: "" },
  summaries: { zh: "s", en: "", ja: "", ko: "" }, avatarUrl: null, backgroundUrl: null, slug: null, tags: [],
  author: { handle: null, accountNumId: 9, name: "作者", avatar: "" }, talkNum: 0, followNum: 0, trending: 0, registeredAt: 0, syncedAt: 0, provider: "harbor", rating: "R",
};

function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";
  requests.push({ method, url, headers: new Headers(init?.headers), body: typeof init?.body === "string" ? init.body : undefined });
  const json = (body: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } }));
  if (url.endsWith("/v1/auth/config")) return json({ managed: true });
  if (url.endsWith("/v1/auth/session")) return json({ provider: "harbor", me: { accountNumId: 7, nickName: "月光", avatar: "" }, profile: profile(server.sessionRegion), token: { accessToken: "tok", expiresAt: Date.now() + 3_600_000 } });
  if (url.endsWith("/v1/auth/token")) return json({ accessToken: "tok", expiresAt: Date.now() + 3_600_000 });
  if (url.endsWith("/v1/me")) { const snapshot = profile(server.region); return holdMe ? holdMe.then(() => json(snapshot)) : json(snapshot); }
  if (url.endsWith("/v1/me/settings")) {
    const body = JSON.parse(String(init?.body)) as { countryRegion?: string; showNsfw?: boolean };
    if (body.countryRegion !== undefined) server.region = body.countryRegion;
    if (body.showNsfw !== undefined) server.wantsNsfw = body.showNsfw;
    return json(view());
  }
  if (url.includes("/v1/me/conversations/blocked")) return json({ error: "region_unavailable" }, 403);
  if (/\/v1\/cards\/(abc|100300)(?:\?|$)/.test(url)) return server.cardRegionBlocked ? json({ error: "region_unavailable" }, 403) : json(CARD);
  if (url.includes("/v1/cards?")) return json({ items: [], total: 0, hasNext: false, limit: 9, offset: 0, sort: "hot" });
  return json({}, 200);
}

let app: App | null = null;
let el: HTMLElement | null = null;
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r, 0)); await nextTick(); };
beforeEach(() => {
  resetManagedAuthForTest(true);
  vi.stubGlobal("fetch", fakeFetch);
  requests.length = 0;
  Object.assign(server, { region: "TW", sessionRegion: "TW", wantsNsfw: true, cardRegionBlocked: false });
  holdMe = null;
  setActivePinia(createPinia());
});
afterEach(() => {
  app?.unmount(); el?.remove(); app = null; el = null; document.body.innerHTML = ""; vi.unstubAllGlobals();
  i18n.global.locale.value = "zh-Hant" as never;
});

async function mount(path: string, component: object, extra = "") {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path, component }, { path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  await session.restore();
  await router.push(path.replace(":id", "100300").replace(":section?", "content"));
  await router.isReady();
  app = createApp({ components: { AdultToggle }, template: `${extra}<RouterView />` }).use(pinia).use(router).use(i18n);
  app.mount(el);
  await flush();
  return session;
}

const regionSelect = () => el!.querySelector<HTMLSelectElement>("select.content__select");
const adultRow = () => [...el!.querySelectorAll("label.content__row")].find((row) => row.textContent?.includes(i18n.global.t("settings.content.nsfw")));
async function choose(code: string) {
  const select = regionSelect()!;
  select.value = code;
  select.dispatchEvent(new Event("change"));
  await flush();
}

describe("國家／地區", () => {
  it("託管登入的個人資料讀取、設定頁的補讀都帶目前的介面語言", async () => {
    i18n.global.locale.value = "en" as never;
    await mount("/settings/:section?", SettingsPage);
    const session = requests.find((r) => r.url.endsWith("/v1/auth/session"));
    expect(session?.headers.get("language")).toBe("en");
    const me = requests.find((r) => r.method === "GET" && /^\/v1\/me$/.test(r.url));
    expect(me?.headers.get("language")).toBe("en");
  });

  it("設定頁：十個選項分兩組，現值照伺服器；個人資料還沒有地區（回其他地區）時以本站的補讀為準", async () => {
    server.sessionRegion = "OTHER";
    const session = await mount("/settings/:section?", SettingsPage);
    const select = regionSelect()!;
    expect(select).not.toBeNull();
    const groups = [...select.querySelectorAll("optgroup")];
    expect(groups.map((g) => [...g.querySelectorAll("option")].map((o) => o.value))).toEqual([["HK", "MO", "TW", "SG", "MY", "CN"], ["JP", "KR", "US", "OTHER"]]);
    expect(groups.map((g) => g.label)).toEqual([i18n.global.t("settings.region.group.chinese"), i18n.global.t("settings.region.group.other")]);
    expect(select.textContent).toContain("中國大陸");
    expect(select.textContent).not.toMatch(/settings\.region/);
    expect(el!.textContent).toContain("國家／地區");
    expect(session.profile?.countryRegion).toBe("TW");
    expect(select.value).toBe("TW");
  });

  it("選中國大陸：存到伺服器，成人開關與頁首 R18 收起；切回台灣，原本開著的成人內容照舊", async () => {
    const session = await mount("/settings/:section?", SettingsPage, "<AdultToggle />");
    expect(adultRow()).toBeTruthy();
    expect(el!.querySelector("button.r18")).not.toBeNull();
    // 合流版面：地區在上、成人在下，同一張卡（不放卡頭）；中國大陸時只收成人那一列，卡還在
    const card = regionSelect()!.closest("section.set-card");
    expect(card).not.toBeNull();
    expect(card!.contains(adultRow()!)).toBe(true);
    expect(card!.querySelector(".set-card__head")).toBeNull();
    expect(regionSelect()!.compareDocumentPosition(adultRow()!) & Node.DOCUMENT_POSITION_FOLLOWING, "地區列在成人列上面").toBeTruthy();
    expect(card!.nextElementSibling?.id, "第二張卡是不想看的類型").toBe("hidden");

    await choose("CN");
    expect(regionSelect()!.closest("section.set-card")).toBe(card);
    const saved = requests.filter((r) => r.method === "POST" && r.url.endsWith("/v1/me/settings"));
    expect(saved.map((r) => JSON.parse(r.body!))).toEqual([{ countryRegion: "CN" }]);
    expect(session.profile).toMatchObject({ countryRegion: "CN", showNsfw: false });
    expect(regionSelect()!.value).toBe("CN");
    expect(adultRow(), "中國大陸不畫成人內容開關").toBeUndefined();
    expect(el!.querySelector("button.r18"), "中國大陸不畫頁首 R18").toBeNull();

    await choose("TW");
    expect(session.profile).toMatchObject({ countryRegion: "TW", showNsfw: true });
    expect(adultRow()?.querySelector<HTMLInputElement>("input")?.checked).toBe(true);
    expect(el!.querySelector("button.r18")?.getAttribute("aria-checked")).toBe("true");
  });

  it("換了地區：上一屏記住的卡整份丟掉，點進卡片頁不會先畫出來", async () => {
    await mount("/settings/:section?", SettingsPage);
    rememberCard(CARD as never);
    expect(recallCard("100300")).not.toBeNull();
    await choose("CN");
    expect(recallCard("100300")).toBeNull();
  });

  it("補讀比使用者的選擇晚回來：不把剛存好的中國大陸蓋回舊值", async () => {
    let release!: () => void;
    holdMe = new Promise((done) => { release = done; });
    const session = await mount("/settings/:section?", SettingsPage, "<AdultToggle />");
    await choose("CN");
    expect(session.profile?.countryRegion).toBe("CN");
    release();
    await flush();
    expect(session.profile).toMatchObject({ countryRegion: "CN", showNsfw: false });
    expect(regionSelect()!.value).toBe("CN");
    expect(adultRow()).toBeUndefined();
    expect(el!.querySelector("button.r18")).toBeNull();
  });

  it("存不進去：退回原本的地區並說明，成人開關不動", async () => {
    const session = await mount("/settings/:section?", SettingsPage);
    vi.stubGlobal("fetch", (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith("/v1/me/settings")
      ? Promise.resolve(new Response(JSON.stringify({ error: "countryRegion_invalid" }), { status: 400 }))
      : fakeFetch(input, init));
    await choose("CN");
    expect(regionSelect()!.value).toBe("TW");
    expect(session.profile?.countryRegion).toBe("TW");
    expect(el!.querySelector('[role="alert"]')).not.toBeNull();
    expect(adultRow()).toBeTruthy();
  });

  it("卡片頁被地區擋下：畫「暫不提供」與回榜單，不是 404 或成人內容的門，先畫出來的記住的卡也拿掉", async () => {
    server.region = server.sessionRegion = "CN";
    server.cardRegionBlocked = true;
    rememberCard(CARD as never);
    await mount("/cards/:id", CardPage);
    expect(el!.textContent).toContain(i18n.global.t("region.unavailable.title"));
    expect(el!.textContent).toContain(i18n.global.t("region.unavailable.hint"));
    expect(el!.textContent).not.toContain(i18n.global.t("card.gate.title"));
    expect(el!.textContent).not.toContain(i18n.global.t("card.notFound.title"));
    expect(el!.textContent).not.toContain("記住的成人卡");
    expect(el!.querySelector("a.btn--primary")?.getAttribute("href")).toBe("/");
  });

  it("圖書館的請求被擋：錯誤碼留在錯誤上", async () => {
    const err = await libraryRequest("conversations/blocked?provider=harbor", "tok").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 403, code: "region_unavailable" });
  });
});

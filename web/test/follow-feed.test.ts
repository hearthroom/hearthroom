/**
 * 首頁「關注」分頁（2026-11-01）：關注作者的新卡與作者選擇通知的更新，依事件時間新到舊，捲到底接下一批。
 * 各狀態只有一個主行動：未登入→登入；沒關注→瀏覽日榜；有關注沒動態→瀏覽日榜；失敗→重試。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import FollowFeed from "../src/components/FollowFeed.vue";
import * as library from "../src/lib/library";
import { useSession } from "../src/lib/session";
import type { CommunityCard } from "../src/lib/types";
import { relativeTime } from "../src/lib/format";

vi.mock("../src/lib/library", async (original) => ({ ...await original<typeof library>(), libraryRequest: vi.fn() }));
const request = vi.mocked(library.libraryRequest);

let app: App | undefined;
let root: HTMLElement;
let router: Router;
const events: string[] = [];
const settle = async () => { for (let i = 0; i < 8; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };
const t = (key: string, values?: Record<string, unknown>) => i18n.global.t(key, values ?? {});

function card(id: string, feedEvent: CommunityCard["feedEvent"]): CommunityCard {
  return { id, num: Number(id), name: `卡${id}`, summary: `簡介${id}`, tags: [], avatarUrl: "", zone: "zh", author: { name: "作者", avatar: "", handle: "abcdefgh" }, updatedAt: 1, feedEvent } as unknown as CommunityCard;
}
const page = (items: CommunityCard[], hasNext = false, nextCursor?: string) => ({ items, hasNext, limit: 24, offset: 0, total: null, ...(nextCursor ? { nextCursor } : {}) });

async function mount(opts: { signedIn?: boolean; following?: number } = {}) {
  router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:pathMatch(.*)*", component: { template: "<div />" } }] });
  await router.push("/?mode=following"); await router.isReady();
  root = document.createElement("div"); document.body.appendChild(root);
  const pinia = createPinia(); setActivePinia(pinia);
  const session = useSession();
  if (opts.signedIn !== false) {
    session.me = { accountNumId: 1, nickName: "fan", avatar: "" } as never;
    session.profile = { handle: "fanfanfa", memberSince: 0, reviewer: false, identities: [], showNsfw: false, ageVerified: false, adultConsent: false, hiddenTags: [], following: opts.following ?? 1 } as never;
    session.accessToken = (async () => "token") as never;
  }
  session.ready = true;
  app = createApp({ components: { FollowFeed }, template: `<FollowFeed @discover="e('discover')" @top="e('top')" />`, methods: { e: (name: string) => events.push(name) } }).use(pinia).use(i18n).use(router);
  app.mount(root); await settle();
}
const text = () => root.textContent?.replace(/\s+/g, " ") ?? "";
const buttonNamed = (label: string) => [...root.querySelectorAll<HTMLButtonElement | HTMLAnchorElement>("button, a")].find((b) => b.textContent?.trim() === label);

afterEach(() => { app?.unmount(); root?.remove(); request.mockReset(); events.length = 0; });

describe("關注動態", () => {
  it("新卡與更新各標類別，更新項的簡介位置放更新日誌；時間 chip 是事件時間", async () => {
    const newAt = Date.now() - 86_400_000;
    request.mockResolvedValueOnce(page([
      card("2", { kind: "update", at: Date.now() - 3_600_000, note: "新增第二章" }),
      card("1", { kind: "new", at: newAt }),
    ]));
    await mount();
    const tiles = [...root.querySelectorAll(".card")];
    expect(tiles.map((el) => el.querySelector(".card__kind")?.textContent?.trim())).toEqual([t("library.feedKindUpdate"), t("library.feedKindNew")]);
    expect(tiles[0]!.querySelector(".card__kind--new")).toBeNull();
    expect(tiles[1]!.querySelector(".card__kind--new")).not.toBeNull();
    expect(tiles[0]!.querySelector(".card__hook")?.textContent).toContain("新增第二章");
    expect(tiles[0]!.querySelector(".card__hook")?.textContent).toContain(t("cardUpdate.card.updateNote"));
    expect(tiles[0]!.textContent).not.toContain("簡介2");
    expect(tiles[1]!.querySelector(".card__hook")?.textContent).toContain("簡介1");
    expect(tiles[1]!.querySelector(".card__updated .sr-only")?.textContent?.trim()).toBe(t("library.feedPublishedAgo", { time: relativeTime(newAt) }));
    // 沒有分頁說明句、沒有上一頁／下一頁
    expect(root.querySelector(".feed__intro p")).toBeNull();
    expect(root.querySelector(".pager")).toBeNull();
    expect(buttonNamed(`${t("library.manageFollowing")} →`)).toBeTruthy();
  });

  it("捲到底帶 cursor 接下一批，到底顯示結尾與回到頂端", async () => {
    request.mockResolvedValueOnce(page([card("3", { kind: "new", at: 3 })], true, "next-1"));
    request.mockResolvedValueOnce(page([card("2", { kind: "new", at: 2 })]));
    await mount();
    window.dispatchEvent(new Event("scroll")); await settle();
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1]![0]).toContain("offset=24");
    expect(request.mock.calls[1]![0]).toContain("cursor=next-1");
    expect([...root.querySelectorAll(".card")]).toHaveLength(2);
    expect(text()).toContain(t("home.end"));
    buttonNamed(t("home.top"))!.click();
    expect(events).toEqual(["top"]);
  });

  it("沒關注任何作者：說明加瀏覽日榜，不顯示管理關注", async () => {
    request.mockResolvedValueOnce(page([]));
    await mount({ following: 0 });
    expect(text()).toContain(t("library.followingEmpty"));
    expect(text()).toContain(t("library.feedEmptyHint"));
    expect(buttonNamed(`${t("library.manageFollowing")} →`)).toBeUndefined();
    buttonNamed(t("library.browseToday"))!.click();
    expect(events).toEqual(["discover"]);
  });

  it("有關注但沒有動態：另一句說明，保留管理關注，同一個按鈕", async () => {
    request.mockResolvedValueOnce(page([]));
    await mount({ following: 3 });
    expect(text()).toContain(t("library.feedQuietTitle"));
    expect(text()).toContain(t("library.feedQuietHint"));
    expect(buttonNamed(`${t("library.manageFollowing")} →`)).toBeTruthy();
    expect(buttonNamed(t("library.browseToday"))).toBeTruthy();
  });

  it("未登入：標題加登入，登入後回到關注", async () => {
    await mount({ signedIn: false });
    expect(request).not.toHaveBeenCalled();
    expect(text()).toContain(t("library.feedGuest"));
    const login = buttonNamed(t("nav.login")) as HTMLAnchorElement;
    expect(decodeURIComponent(login.getAttribute("href")!)).toContain("returnTo=/?mode=following");
  });

  it("首次載入失敗：短標籤加重試，只重讀動態", async () => {
    request.mockRejectedValueOnce(new Error("down"));
    request.mockResolvedValueOnce(page([card("1", { kind: "new", at: 1 })]));
    await mount();
    expect(text()).toContain(t("home.firstError"));
    buttonNamed(t("home.retry"))!.click(); await settle();
    expect([...root.querySelectorAll(".card")]).toHaveLength(1);
  });
});

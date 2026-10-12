/**
 * 已登入首頁的蘇綺面板（owner 2026-10-13）：
 *   - 不替人挑卡：「接著上次的故事」列的是自己最近的對話，最多三段；一段都沒有就不出這個選項
 *   - 「找新卡」交給榜單（通知首頁切日榜、捲過去），面板自己不讀榜
 *   - 「隨便來一張」擲到幾張就給幾張：只讀一張隨機卡
 *   - 場景照裝置時間分五段，每段都有好幾張、每天輪一張；同一段同一天之內固定；晚上與深夜用深色場景
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";

vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "board", setSurface: () => {} }));

import MascotHome from "../src/components/MascotHome.vue";
import { useSession } from "../src/lib/session";
import { resetManagedAuthForTest } from "../src/lib/managed-auth";
import { clearLibraryCache } from "../src/lib/library";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { POSES, SCENES, isNight, poseOf, sceneOf, slotOf, type Slot } from "../src/lib/mascot-home";

const PROFILE = { handle: "abcdefgh", memberSince: 0, reviewer: false, identities: [], showNsfw: false, ageVerified: false, adultConsent: false, hiddenTags: [] };
const chat = (n: number) => ({ provider: "harbor", conversationId: `c${n}`, conversationRoleId: `r${n}`, cardNumber: n, conversationTitle: null, roleName: `角色${n}`, roleAvatar: "", lastChatTime: new Date(Date.now() - n * 3_600_000).toISOString() });
let conversations: unknown[] = [];
const calls: string[] = [];

function fakeFetch(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  calls.push(url);
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.endsWith("/v1/auth/config")) return Promise.resolve(json({ managed: true }));
  if (url.endsWith("/v1/auth/session")) return Promise.resolve(json({ provider: "harbor", me: { accountNumId: 7, nickName: "小月", avatar: "" }, profile: PROFILE, token: { accessToken: "tok", expiresAt: Date.now() + 3_600_000 } }));
  if (url.includes("/me/conversations")) return Promise.resolve(json({ conversations, hasNextPage: false }));
  if (url.includes("/v1/cards?")) return Promise.resolve(json({ items: [{ id: "x", num: 42, name: "夜班便利店", summary: "凌晨三點", avatarUrl: null }], total: 1, hasNext: false, limit: 1, offset: 0 }));
  return Promise.resolve(json({}));
}

let app: App | null = null;
let el: HTMLElement | null = null;
let discovered = 0;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function open() {
  el = document.createElement("div");
  document.body.appendChild(el);
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }] });
  const pinia = createPinia();
  setActivePinia(pinia);
  await router.push("/");
  await router.isReady();
  await useSession().restore();
  const Root = defineComponent({ render: () => h(MascotHome, { onDiscover: () => { discovered++; } }) });
  app = createApp(Root).use(pinia).use(router).use(i18n);
  app.mount(el);
  await wait(30);
  await nextTick();
}
const chips = () => [...el!.querySelectorAll<HTMLButtonElement>(".home__intent")];
const chip = (text: string) => chips().find((b) => b.textContent?.includes(text));

beforeEach(() => { resetManagedAuthForTest(true); clearLibraryCache(); vi.stubGlobal("fetch", fakeFetch); conversations = []; calls.length = 0; discovered = 0; i18n.global.locale.value = "zh-Hant"; });
afterEach(() => { app?.unmount(); el?.remove(); app = null; el = null; vi.unstubAllGlobals(); });

describe("蘇綺面板", () => {
  it("有對話時先列自己最近的三段，點了接回那段對話", async () => {
    conversations = [chat(1), chat(2), chat(3), chat(4)];
    await open();
    const rows = [...el!.querySelectorAll<HTMLAnchorElement>(".home__row")];
    expect(rows).toHaveLength(3);
    expect(rows[0].getAttribute("href")).toContain("/play/1?resume=c1");
    expect(chips()[0].getAttribute("aria-pressed")).toBe("true");
    expect(calls.some((u) => u.includes("/v1/cards?"))).toBe(false);
  });

  it("一段對話都沒有：不出「接著」那個選項，也不列卡", async () => {
    await open();
    expect(chips().some((b) => b.textContent?.includes("接著"))).toBe(false);
    expect(el!.querySelectorAll(".home__row")).toHaveLength(0);
  });

  it("找新卡：通知首頁去榜單，面板自己不讀榜", async () => {
    await open();
    chip("找新卡")!.click();
    await nextTick();
    expect(discovered).toBe(1);
    expect(calls.some((u) => u.includes("/v1/cards?"))).toBe(false);
  });

  it("隨便來一張：只讀一張隨機卡，畫在泡泡裡", async () => {
    await open();
    chip("隨便來一張")!.click();
    await wait(30);
    const board = calls.filter((u) => u.includes("/v1/cards?"));
    expect(board).toHaveLength(1);
    expect(board[0]).toContain("sort=random");
    expect(board[0]).toContain("limit=1");
    expect(el!.querySelector(".home__rolled")?.textContent).toContain("夜班便利店");
  });
});

describe("場景與姿勢", () => {
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h);
  it("同一段同一天之內固定，晚上換深色場景", () => {
    expect(sceneOf(at(2026, 10, 13, 9)).id).toBe(sceneOf(at(2026, 10, 13, 10)).id);
    expect(slotOf(at(2026, 10, 13, 18))).toBe("dusk");
    expect(isNight(at(2026, 10, 13, 22))).toBe(true);
    expect(sceneOf(at(2026, 10, 13, 22)).night).toBe(true);
    expect(sceneOf(at(2026, 10, 13, 10)).night).toBe(false);
  });
  it("每一段在每個月都至少有兩張可以輪", () => {
    const hour: Record<Slot, number> = { late: 2, morning: 8, afternoon: 14, dusk: 18, night: 21 };
    for (let m = 0; m < 12; m++) for (const [slot, h] of Object.entries(hour)) {
      const seen = new Set<string>();
      for (let d = 1; d <= 28; d++) seen.add(sceneOf(new Date(2026, m, d, h)).id);
      expect(seen.size, `${slot} ${m + 1}月`).toBeGreaterThanOrEqual(2);
    }
  });
  it("季節限定的場景只在那幾個月出現", () => {
    for (const s of SCENES.filter((x) => x.months)) {
      for (let d = 1; d <= 60; d++) {
        const day = new Date(2026, 0, d, 10);
        if (!s.months!.includes(day.getMonth() + 1)) expect(sceneOf(day).id).not.toBe(s.id);
      }
    }
  });
  it("姿勢跟著日子換，同一天固定", () => {
    expect(poseOf("roll", at(2026, 10, 13, 9))).toBe(poseOf("roll", at(2026, 10, 13, 18)));
  });
  it("每張場景與姿勢的圖都在", () => {
    const missing = [
      ...SCENES.map((x) => `scene-${x.id}`),
      ...Object.values(POSES).flatMap((p) => [...p.day, ...p.night]).map((x) => `pose-${x}`),
    ].filter((name) => !existsSync(resolve("public/mascot/home", `${name}.webp`)));
    expect(missing).toEqual([]);
  });
});

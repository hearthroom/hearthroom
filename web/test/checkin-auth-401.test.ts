// 簽到頁與獎勵請求的 401 處理：
// 1. 快取或本機未過期的 access token 被 Harbor 回 401 時，丟掉舊憑證並單飛換新一次自動重試（保留同一組 requestId）。
// 2. 換不到新憑證（或重試仍回 401）時，簽到頁與開箱舞台顯示「登入已失效，請重新登入」與「重新登入」主行動（直接走 OAuth 授權並帶回原頁），不誤報「簽到資料暫時載入不了」。
// 3. 5xx 與網路中斷仍維持暫時性錯誤與「重新載入」。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, nextTick } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView } from "vue-router";
import { i18n, loadLocale } from "../src/lib/i18n";
import { rememberManaged, resetManagedAuthForTest, restoreManaged } from "../src/lib/managed-auth";
import { setProvider } from "../src/lib/provider";
import { forgetCurrentPlan, forgetPeriodPlans, type RewardPlan, type RewardsPanel } from "../src/lib/rewards";
import { useCheckin } from "../src/lib/checkin-store";
import { usePeriodPlans } from "../src/lib/period-plan-store";
import { useSession } from "../src/lib/session";
import CheckinPage from "../src/pages/CheckinPage.vue";

vi.mock("../src/lib/checkin-art", async (original) => ({
  ...(await original<typeof import("../src/lib/checkin-art")>()),
  preloadPoses: async () => undefined,
}));

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

const planFixture: RewardPlan = {
  version: 1,
  drawRetentionDays: 30,
  checkin: { cycle: ["daily", "daily", "day3", "daily", "daily", "daily", "day7"], milestones: [{ at: 14, chest: "m14" }] },
  pity: { threshold: 200, maxMisses: 6 },
  chests: {
    daily: { prizes: [{ tier: 1, credits: 50, weight: 8000 }, { tier: 5, credits: 300, weight: 2000 }] },
  },
};

const panelFixture: RewardsPanel = {
  serverNow: "2026-11-15T05:46:00Z",
  businessDay: "2026-11-15",
  nextResetAt: "2026-11-15T20:00:00Z",
  weekResetAt: "2026-11-16T20:00:00Z",
  planVersion: 1,
  checkin: {
    streak: 4,
    todayClaimed: false,
    todayChests: ["daily"],
    fallback: null,
    track: [
      { day: 1, chest: "daily", status: "claimed" },
      { day: 2, chest: "daily", status: "claimed" },
      { day: 3, chest: "day3", status: "claimed" },
      { day: 4, chest: "daily", status: "claimed" },
      { day: 5, chest: "daily", status: "today" },
      { day: 6, chest: "daily", status: "future" },
      { day: 7, chest: "day7", status: "future" },
    ],
    nextMilestone: { day: 14, chest: "m14", inDays: 10 },
    makeup: { left: 1, repairableDays: [] },
  },
  pityRemaining: 3,
  today: { claims: [] },
  tasks: {
    daily: [
      { id: "chat5", type: "turns", progress: 5, target: 5, reward: { credits: 30 }, status: "claimable", period: "2026-11-15" },
    ],
    weekly: [],
  },
  newcomer: null,
  hints: [],
};

const offerFixture = {
  id: "month",
  onSale: true,
  priceMicro: 5_000_000,
  currency: "USD",
  credits: 30_000,
  days: 30,
  dailyCredits: 500,
  firstBonusDailyCredits: 500,
  maxDays: 180,
  makeupPerMonth: 3,
  purchaseUrl: "https://console.example/me/billing?plan=month",
};

const myPlanFixture = {
  id: "month",
  businessDay: "2026-11-15",
  nextResetAt: "2026-11-15T20:00:00Z",
  active: true,
  endsOn: "2026-12-14",
  remainingDays: 29,
  today: { status: "claimable", credits: 1000, bonusCredits: 500 },
  canPurchase: true,
  purchaseBlockedReason: null,
  firstBonus: { status: "active", dailyCredits: 500 },
  firstBonusDailyCredits: 500,
  makeupPerMonth: 3,
};

let app: ReturnType<typeof createApp> | null = null;
let root: HTMLElement | null = null;

async function flush() {
  for (let i = 0; i < 40; i++) await Promise.resolve();
  await nextTick();
}

beforeEach(() => {
  setProvider("harbor");
  localStorage.clear();
  sessionStorage.clear();
  forgetCurrentPlan();
  forgetPeriodPlans();
  resetManagedAuthForTest(true);
});

afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  root = null;
  resetManagedAuthForTest(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mountCheckin(path = "/checkin", locale: "zh-Hant" | "zh-Hans" | "en" = "zh-Hant") {
  await loadLocale(locale);
  i18n.global.locale.value = locale;
  const pinia = createPinia();
  setActivePinia(pinia);
  const session = useSession();
  session.ready = true;
  session.me = { accountNumId: 42, nickName: "Tester", avatar: "" };
  session.profile = { identities: [{ provider: "harbor", externalId: 42 }] } as never;

  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/checkin", component: CheckinPage },
      { path: "/:locale(zh-Hans|en)/checkin", component: CheckinPage },
      { path: "/login", component: { template: "<div data-testid='login-route' />" } },
      { path: "/:rest(.*)*", component: { template: "<div />" } },
    ],
  });
  await router.push(path);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp(CheckinPage).use(pinia).use(router).use(i18n);
  app.mount(root);
  await flush();
  return { router, session, store: useCheckin(), plans: usePeriodPlans() };
}

describe("簽到頁與獎勵請求 401 憑證恢復與重新登入提示", () => {
  it("託管模式快取 token 被回 401 時，自動丟掉快取並單飛換新一次，頁面直接載入成功", async () => {
    rememberManaged({ accessToken: "stale-tok", expiresAt: Date.now() + 3_600_000 }, "harbor");
    let tokenCalls = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/v1/auth/token")) {
        tokenCalls += 1;
        return json({ accessToken: "fresh-tok", expiresAt: Date.now() + 3_600_000 });
      }
      if (url.includes("/rewards/plan")) return json(planFixture);
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      if (auth === "Bearer stale-tok") return json({ error: "unauthorized" }, 401);
      if (auth === "Bearer fresh-tok") {
        if (url.endsWith("/open/v1/me/rewards")) return json(panelFixture);
        if (url.endsWith("/open/v1/me/plans")) return json({ serverNow: panelFixture.serverNow, list: [myPlanFixture] });
        if (url.includes("/open/v1/me/rewards/draws")) return json({ list: [], nextCursor: null });
      }
      return json({ error: "unexpected_route", url, auth }, 500);
    }));

    const { store, plans } = await mountCheckin("/checkin", "zh-Hant");

    expect(tokenCalls).toBe(1);
    expect(store.error).toBeNull();
    expect(store.panel?.checkin.streak).toBe(4);
    expect(plans.mine?.remainingDays).toBe(29);
    expect(root?.querySelector(".checkin__error")).toBeNull();
    expect(root?.textContent).not.toContain("簽到資料暫時載入不了");
    expect(root?.textContent).toContain("簽到開箱");
  });

  it("非託管模式本機未過期 token 被回 401 時，自動以 refresh_token 換新並保留同一組 requestId 重送簽到", async () => {
    resetManagedAuthForTest(false);
    const exp = Date.now() + 3_600_000;
    localStorage.setItem("hearthroom.oauth.grant_client.harbor", "client-harbor");
    localStorage.setItem("hearthroom.oauth.refresh.harbor", "refresh-1");
    localStorage.setItem("hearthroom.oauth.access.harbor", JSON.stringify({ accessToken: "stale-local", expiresAt: exp }));

    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSession();
    session.ready = true;
    session.token = { accessToken: "stale-local", clientId: "client-harbor", refreshToken: "refresh-1", expiresAt: exp };
    session.me = { accountNumId: 42, nickName: "Tester", avatar: "" };

    let oauthCalls = 0;
    const checkinCalls: { auth: string | null; requestId: string }[] = [];

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/oauth/token")) {
        oauthCalls += 1;
        return json({ access_token: "fresh-local", refresh_token: "refresh-2", expires_in: 3600 });
      }
      if (url.endsWith("/open/v1/me")) return json({ accountNumId: 42, nickName: "Tester", avatar: "" });
      if (url.endsWith("/open/v1/me/wallet")) return json({ available: 100, expiries: [] });
      if (url.endsWith("/v1/me")) return json({ id: 42, handle: "tester", identities: [{ provider: "harbor", externalId: 42 }] });
      if (url.endsWith("/open/v1/me/rewards/checkin")) {
        const body = JSON.parse(String(init?.body ?? "{}")) as { requestId: string };
        checkinCalls.push({ auth, requestId: body.requestId });
        if (auth === "Bearer stale-local") return json({ error: "unauthorized" }, 401);
        if (auth === "Bearer fresh-local") {
          return json({
            claims: [{ rewardKey: "checkin:2026-11-15", status: "granted", chest: "daily", tier: 1, stripSeed: 3, stripVersion: 1, planVersion: 1, credits: 50, duplicate: false }],
            streak: 5,
            replayed: false,
          });
        }
      }
      return json({ error: "unexpected" }, 500);
    }));

    const store = useCheckin();
    const res = await store.checkin();

    expect(oauthCalls).toBe(1);
    expect(checkinCalls).toHaveLength(2);
    expect(checkinCalls[0].auth).toBe("Bearer stale-local");
    expect(checkinCalls[1].auth).toBe("Bearer fresh-local");
    expect(checkinCalls[0].requestId).toBe(checkinCalls[1].requestId);
    expect(res).toMatchObject({ streak: 5, elsewhere: false });
  });

  it("憑證已失效且無法換新（/v1/auth/token 回 401）時，顯示「登入已失效，請重新登入」與「重新登入」按鈕，點擊直接發起 OAuth 授權並帶回簽到頁", async () => {
    const assignSpy = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    let startBody: Record<string, unknown> | null = null;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/token")) return json({ error: "connection_source_expired" }, 401);
      if (url.endsWith("/v1/auth/start")) {
        startBody = JSON.parse(String(init?.body ?? "{}"));
        return json({ url: "https://harbor.example/oauth/authorize?state=relogin" });
      }
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      return json({ error: "unexpected" }, 500);
    }));

    const { router } = await mountCheckin("/zh-Hans/checkin?from=menu", "zh-Hans");

    expect(root?.textContent).not.toContain("签到信息暂时加载不出来");
    expect(root?.textContent).not.toContain("重新加载");
    const alert = root?.querySelector(".checkin__error [role='alert']");
    expect(alert?.textContent).toContain("登录已失效，请重新登录");

    const btn = root?.querySelector(".checkin__error button") as HTMLButtonElement | null;
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe("重新登录");

    btn!.click();
    await flush();

    // 不能 router.push('/login')（託管模式下 session.me 仍存在，LoginPage 會立刻跳回 /checkin 形成死迴圈）
    expect(router.currentRoute.value.fullPath).toBe("/zh-Hans/checkin?from=menu");
    expect(startBody).toMatchObject({
      provider: "harbor",
      returnTo: "/zh-Hans/checkin?from=menu",
      locale: "zh-Hans",
    });
    expect(assignSpy).toHaveBeenCalledWith("https://harbor.example/oauth/authorize?state=relogin");
  });

  it("已打開簽到頁後憑證過期，按「簽到開箱」在舞台收到不可恢復的 401 時，顯示重新登入提示而非「寶箱現在打不開」", async () => {
    const assignSpy = vi.spyOn(window.location, "assign").mockImplementation(() => undefined);
    rememberManaged({ accessToken: "initial-ok", expiresAt: Date.now() + 3_600_000 }, "harbor");
    let expired = false;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/v1/auth/token")) {
        return expired ? json({ error: "connection_source_expired" }, 401) : json({ accessToken: "initial-ok", expiresAt: Date.now() + 3_600_000 });
      }
      if (url.endsWith("/v1/auth/start")) return json({ url: "https://harbor.example/oauth/authorize?state=stage-relogin" });
      if (url.includes("/rewards/plan")) return json(planFixture);
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      if (url.endsWith("/open/v1/me/rewards") && auth === "Bearer initial-ok" && !expired) return json(panelFixture);
      if (url.endsWith("/open/v1/me/plans") && auth === "Bearer initial-ok" && !expired) return json({ serverNow: panelFixture.serverNow, list: [myPlanFixture] });
      if (url.includes("/open/v1/me/rewards/draws") && auth === "Bearer initial-ok" && !expired) return json({ list: [], nextCursor: null });
      if (url.endsWith("/open/v1/me/rewards/checkin")) return json({ error: "unauthorized" }, 401);
      return json({ error: "unauthorized" }, 401);
    }));

    await mountCheckin("/checkin", "zh-Hant");
    expired = true;

    const openBtn = Array.from(root!.querySelectorAll("button")).find((b) => b.textContent?.includes("簽到開箱"));
    expect(openBtn).toBeDefined();
    openBtn!.click();
    await flush();

    const stageAlert = document.body.querySelector(".stage .st-error[role='alert']");
    expect(stageAlert).not.toBeNull();
    expect(stageAlert?.textContent).toContain("登入已失效，請重新登入");
    expect(stageAlert?.textContent).not.toContain("寶箱現在打不開");

    const primaryBtn = document.body.querySelector(".stage .st-primary") as HTMLButtonElement | null;
    expect(primaryBtn?.textContent?.trim()).toBe("重新登入");
    primaryBtn!.click();
    await flush();
    expect(assignSpy).toHaveBeenCalledWith("https://harbor.example/oauth/authorize?state=stage-relogin");
  });

  it("伺服器 503 暫時故障時，維持顯示「簽到資料暫時載入不了」與「重新載入」，不誤判為登入失效", async () => {
    rememberManaged({ accessToken: "valid-tok", expiresAt: Date.now() + 3_600_000 }, "harbor");
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      if (url.includes("/open/v1/me/rewards/draws")) return json({ list: [], nextCursor: null });
      if (url.endsWith("/open/v1/me/plans")) return json({ serverNow: panelFixture.serverNow, list: [] });
      if (url.endsWith("/open/v1/me/rewards")) return json({ error: "temporarily_unavailable" }, 503);
      return json({}, 503);
    }));

    await mountCheckin("/checkin", "zh-Hant");

    expect(root?.textContent).toContain("簽到資料暫時載入不了");
    expect(root?.textContent).toContain("重新載入");
    expect(root?.textContent).not.toContain("登入已失效");
  });

  it("換發拿到新 token 後重試仍被 Harbor 回 401 時，只重試一次、清掉壞快取並顯示重新登入", async () => {
    rememberManaged({ accessToken: "stale-tok", expiresAt: Date.now() + 3_600_000 }, "harbor");
    let tokenCalls = 0;
    let rewardsCalls = 0;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/v1/auth/token")) {
        tokenCalls += 1;
        return json({ accessToken: "still-bad-tok", expiresAt: Date.now() + 3_600_000 });
      }
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      if (url.endsWith("/open/v1/me/rewards")) {
        rewardsCalls += 1;
        return json({ error: "unauthorized" }, 401);
      }
      return json({ error: "unauthorized" }, 401);
    }));

    await mountCheckin("/checkin", "zh-Hant");

    expect(tokenCalls).toBe(1);
    expect(rewardsCalls).toBe(2);
    expect(restoreManaged("harbor")).toBeNull();
    expect(root?.textContent).toContain("登入已失效，請重新登入");
    expect(root?.textContent).toContain("重新登入");
    expect(root?.textContent).not.toContain("簽到資料暫時載入不了");
  });

  it("面板已載入後按任務「領取」遇到不可恢復的 401 時，轉為重新登入提示而不誤顯示「領取沒成功」", async () => {
    rememberManaged({ accessToken: "initial-ok", expiresAt: Date.now() + 3_600_000 }, "harbor");
    let expired = false;

    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/v1/auth/token")) {
        return expired ? json({ error: "connection_source_expired" }, 401) : json({ accessToken: "initial-ok", expiresAt: Date.now() + 3_600_000 });
      }
      if (url.includes("/rewards/plan")) return json(planFixture);
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      if (!expired && auth === "Bearer initial-ok") {
        if (url.endsWith("/open/v1/me/rewards")) return json(panelFixture);
        if (url.endsWith("/open/v1/me/plans")) return json({ serverNow: panelFixture.serverNow, list: [myPlanFixture] });
        if (url.includes("/open/v1/me/rewards/draws")) return json({ list: [], nextCursor: null });
      }
      return json({ error: "unauthorized" }, 401);
    }));

    await mountCheckin("/checkin", "zh-Hant");
    expired = true;

    const claimBtn = root!.querySelector(".task__claim") as HTMLButtonElement | null;
    expect(claimBtn).not.toBeNull();
    claimBtn!.click();
    await flush();

    expect(root?.querySelector(".checkin__error [role='alert']")?.textContent).toContain("登入已失效，請重新登入");
    expect(root?.querySelector(".checkin__error button")?.textContent?.trim()).toBe("重新登入");
    expect(root?.querySelectorAll(".btn--primary")).toHaveLength(1);
    expect(root?.querySelector(".checkin__cols")).toBeNull();
    expect(root?.querySelector(".toast")?.hasAttribute("hidden")).toBe(true);
  });

  it("非託管模式 refresh_token 也已失效（/oauth/token 回 400）時，回到分頁重讀不會卡在骨架屏，而是顯示重新登入", async () => {
    resetManagedAuthForTest(false);
    const exp = Date.now() + 3_600_000;
    localStorage.setItem("hearthroom.oauth.grant_client.harbor", "client-harbor");
    localStorage.setItem("hearthroom.oauth.refresh.harbor", "dead-refresh");
    localStorage.setItem("hearthroom.oauth.access.harbor", JSON.stringify({ accessToken: "stale-local", expiresAt: exp }));

    let expired = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const auth = new Headers(init?.headers).get("Authorization");
      if (url.endsWith("/oauth/token")) return json({ error: "invalid_grant" }, 400);
      if (url.includes("/rewards/plan")) return json(planFixture);
      if (url.endsWith("/open/v1/plans")) return json({ list: [offerFixture] });
      if (!expired && auth === "Bearer stale-local") {
        if (url.endsWith("/open/v1/me/rewards")) return json(panelFixture);
        if (url.endsWith("/open/v1/me/plans")) return json({ serverNow: panelFixture.serverNow, list: [myPlanFixture] });
        if (url.includes("/open/v1/me/rewards/draws")) return json({ list: [], nextCursor: null });
      }
      return json({ error: "unauthorized" }, 401);
    }));

    const pinia = createPinia();
    setActivePinia(pinia);
    const session = useSession();
    session.ready = true;
    session.token = { accessToken: "stale-local", clientId: "client-harbor", refreshToken: "dead-refresh", expiresAt: exp };
    session.me = { accountNumId: 42, nickName: "Tester", avatar: "" };

    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: "/checkin", component: CheckinPage }],
    });
    await router.push("/checkin");
    await router.isReady();
    root = document.createElement("div");
    document.body.appendChild(root);
    app = createApp(RouterView);
    app.use(pinia).use(router).use(i18n);
    app.mount(root);
    await flush();

    expect(root.textContent).toContain("簽到開箱");

    // 模擬回到分頁（onVisible 只呼叫 store.load() + plans.load()，不跑 loadDraws）且 refresh_token 已失效
    expired = true;
    const store = useCheckin();
    await store.load();
    await flush();

    expect(root.querySelector(".checkin__skel")).toBeNull();
    expect(root.querySelector(".checkin__error [role='alert']")?.textContent).toContain("登入已失效，請重新登入");
    expect(root.querySelector(".checkin__error button")?.textContent?.trim()).toBe("重新登入");
    expect(root.querySelector(".checkin__cols")).toBeNull();
  });
});

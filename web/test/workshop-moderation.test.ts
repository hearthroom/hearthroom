/**
 * 工坊的站方處理與「重新開放時通知我」（ui.md §3.9 ②③）。
 * 網路整個換成假的 fetch（照網址回），這樣釘的是真的請求路徑、方法與內容；確認框用真的 confirmForm，
 * 「理由必填」才是真的被擋，不是測試自己說了算。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App, type Component } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";
import type { WorkshopAppeal } from "../src/lib/workshop-moderation";
import type { CardWorkshopPage, ExtensionDetail, WorkshopCardChoice } from "../src/lib/workshop";

const fake = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  me: { reviewer: true, role: "manager" } as Record<string, unknown>,
  cards: [] as unknown[],
  detail: null as unknown,
}));
vi.mock("../src/lib/session", () => ({ useSession: () => fake.session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), fetchReviewMe: async () => fake.me }));
vi.mock("../src/lib/campaign", async (original) => ({ ...(await original<object>()), campaignsCached: async () => ({ items: [], canEdit: false }) }));
vi.mock("../src/lib/workshop", async (original) => ({
  ...(await original<object>()),
  fetchWorkshopCards: async () => ({ items: fake.cards }),
  fetchWorkshop: async () => fake.detail,
  fetchSelection: async () => ({ revision: 1, items: [] }),
}));

import CommunityManagementLayout from "../src/pages/CommunityManagementLayout.vue";
import ModerationWorkshopAppealsPage from "../src/pages/ModerationWorkshopAppealsPage.vue";
import ExtensionPage from "../src/pages/ExtensionPage.vue";
import WorkshopTab from "../src/components/workshop/WorkshopTab.vue";
import CardPickerDialog from "../src/components/workshop/CardPickerDialog.vue";
import { appealCount, forgetInterests } from "../src/lib/workshop-moderation";

// ── 假網路 ─────────────────────────────────────────────────────────
type Call = { method: string; path: string; body: unknown };
let calls: Call[] = [];
let route: (c: Call) => { status?: number; body: unknown } | undefined;
const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
function stubFetch() {
  vi.stubGlobal("fetch", vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(String(input), "https://site.test");
    const call = { method: init?.method ?? "GET", path: url.pathname + url.search, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const got = route(call);
    return got ? respond(got.status ?? 200, got.body) : respond(404, { error: "not_found" });
  }));
}
const posts = (part: string) => calls.filter((c) => c.method !== "GET" && c.path.includes(part));

const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };

function signIn(role: "reviewer" | "manager" | "owner" = "manager") {
  fake.me = { reviewer: true, role, reviews: 0, cases: 0, comments: 0, pending: 0 };
  fake.session = reactive({ me: { accountNumId: 7 }, profile: { reviewer: true, reviewerRole: role }, ready: true, accessToken: vi.fn(async () => "tok") });
}

const appeal = (over: Partial<WorkshopAppeal> = {}): WorkshopAppeal => ({
  id: "ap1", workshop: { id: "w1", name: "霧港地圖", coverUrl: "" }, card: { id: "c1", num: 100021, name: "夜行偵探" },
  maker: { handle: "frost", name: "小霜" }, owner: { handle: "shio", name: "汐見" },
  ownerAction: "hidden", ownerReason: "內容與原卡劇情衝突。", ownerActedAt: Date.now() - 3_600_000 * 26,
  appealReason: "地圖只是示意圖，沒有劇情。", appealedAt: Date.now() - 3_600_000 * 3,
  status: "pending", result: null, decidedAt: null, viewerRelation: null, ...over,
});

let app: App | null = null;
async function mount(routes: { path: string; component: Component; children?: { path: string; component: Component; meta?: Record<string, unknown> }[] }[], at: string): Promise<{ root: HTMLElement; router: Router }> {
  const root = document.createElement("div");
  document.body.append(root);
  const blank = defineComponent({ render: () => null });
  const router = createRouter({ history: createMemoryHistory(), routes: [...routes, { path: "/:rest(.*)*", component: blank }] });
  await router.push(at); await router.isReady();
  app = createApp({ render: () => h(RouterView) }).use(createPinia()).use(router).use(i18n);
  app.mount(root);
  await settle();
  return { root, router };
}
function mountComponent(component: Component, props: Record<string, unknown>) {
  return mount([{ path: "/cards/:id", component: defineComponent({ render: () => h(component, props) }) }], "/cards/c1");
}
const workbench = [{
  path: "/review", component: CommunityManagementLayout,
  children: [
    { path: "workshop-appeals", component: ModerationWorkshopAppealsPage, meta: { managementTab: "workshopAppeals" } },
    { path: ":rest(.*)*", component: defineComponent({ render: () => null }) },
  ],
}];

beforeEach(() => {
  calls = [];
  route = () => undefined;
  appealCount.pending = 0;
  forgetInterests();
  stubFetch();
  signIn();
});
afterEach(() => {
  if (confirmState.current) settleConfirm(false);
  app?.unmount(); app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

// ── 工作台分頁 ───────────────────────────────────────────────────────
describe("workbench tab", () => {
  const links = (root: HTMLElement) => [...root.querySelectorAll<HTMLAnchorElement>(".management-nav a")];

  it("shows 擴充申訴 right after 作品管理 with the pending count, for managers and owners only", async () => {
    route = (c) => (c.path === "/v1/moderation/summary" ? { body: { workshopAppeals: 3 } } : c.path.startsWith("/v1/moderation/workshop-appeals") ? { body: { items: [], hasNext: false } } : undefined);
    for (const role of ["manager", "owner"] as const) {
      signIn(role);
      const { root } = await mount(workbench, "/review/workshop-appeals");
      const hrefs = links(root).map((a) => a.getAttribute("href"));
      expect(hrefs.indexOf("/review/workshop-appeals")).toBe(hrefs.indexOf("/review/cards") + 1);
      const tab = links(root).find((a) => a.getAttribute("href") === "/review/workshop-appeals")!;
      expect(tab.textContent).toContain("擴充申訴");
      expect(tab.getAttribute("aria-current")).toBe("page");
      expect(tab.querySelector(".review-badge")?.textContent).toBe("3");
      app!.unmount(); app = null; document.body.innerHTML = "";
    }
    signIn("reviewer");
    calls = [];
    const { root } = await mount(workbench, "/review/cards");
    expect(links(root).some((a) => a.getAttribute("href") === "/review/workshop-appeals")).toBe(false);
    expect(calls.some((c) => c.path === "/v1/moderation/summary")).toBe(false);
  });

  it("the site router sends /review/workshop-appeals to this page, not to the review detail", async () => {
    const { router: site } = await import("../src/router");
    const r = site.resolve("/review/workshop-appeals");
    expect(r.meta.managementTab).toBe("workshopAppeals");
    expect(r.params.id).toBeUndefined();
  });

  it("a non-manager who opens the address directly gets a plain explanation, not a broken list", async () => {
    signIn("reviewer");
    route = (c) => (c.path.startsWith("/v1/moderation/workshop-appeals") ? { status: 403, body: { error: "forbidden" } } : undefined);
    const { root } = await mount(workbench, "/review/workshop-appeals");
    expect(root.querySelector("[data-wsa-forbidden]")?.textContent).toContain("只有站方管理員可以處理擴充申訴");
    expect(root.querySelector("[data-wsa-case]")).toBeNull();
  });
});

// ── 申訴頁 ──────────────────────────────────────────────────────────
describe("appeals page", () => {
  let list: WorkshopAppeal[] = [];
  beforeEach(() => {
    list = [appeal()];
    route = (c) => {
      if (c.path === "/v1/moderation/summary") return { body: { workshopAppeals: list.length } };
      if (c.path.startsWith("/v1/moderation/workshop-appeals?")) return { body: { items: c.path.includes("status=decided") ? [appeal({ id: "d1", status: "decided", result: "restored", decidedAt: Date.now() })] : list, hasNext: false } };
      if (c.method === "POST") { list = []; return { body: {} }; }
      return undefined;
    };
  });
  const click = (root: HTMLElement, sel: string) => root.querySelector<HTMLButtonElement>(sel)!.click();

  it("uphold and restore send nothing until a reason is written, then post it with an operation id", async () => {
    for (const decision of ["upheld", "restored"] as const) {
      list = [appeal()]; calls = [];
      const { root } = await mount(workbench, "/review/workshop-appeals");
      click(root, `[data-wsa-act="${decision}"]`); await settle();
      expect(confirmState.current?.field?.required).toBe(true);
      expect(confirmState.current?.focusCancel).toBe(true);
      settleConfirm(true, "", "   ");
      await settle();
      expect(confirmState.current).not.toBeNull();
      expect(posts("/decision")).toHaveLength(0);
      settleConfirm(true, "", "示意圖沒有劇情");
      await settle();
      const sent = posts("/decision");
      expect(sent).toHaveLength(1);
      expect(sent[0]!.path).toBe("/v1/moderation/workshop-appeals/ap1/decision");
      expect(sent[0]!.body).toMatchObject({ decision, reason: "示意圖沒有劇情" });
      expect(typeof (sent[0]!.body as { operationId: string }).operationId).toBe("string");
      // 處理完：清單重讀、徽章數重讀
      expect(root.querySelector("[data-wsa-empty]")?.textContent).toContain("沒有待處理的申訴");
      expect(document.body.textContent).toContain("已處理，已通知雙方。");
      app!.unmount(); app = null; document.body.innerHTML = "";
    }
  });

  it("staff take-down is a danger confirm that needs a reason and posts to the extension, not the appeal", async () => {
    const { root } = await mount(workbench, "/review/workshop-appeals");
    click(root, '[data-wsa-act="revoke"]'); await settle();
    expect(confirmState.current?.danger).toBe(true);
    expect(confirmState.current?.title).toBe("站方撤下「霧港地圖」？");
    settleConfirm(true, "", "");
    await settle();
    expect(posts("/revoke")).toHaveLength(0);
    settleConfirm(true, "", "違反站規");
    await settle();
    const sent = posts("/revoke");
    expect(sent.map((c) => c.path)).toEqual(["/v1/moderation/workshops/w1/revoke"]);
    expect(sent[0]!.body).toMatchObject({ reason: "違反站規" });
  });

  it("a failed decision keeps the same operation id when retried", async () => {
    let fail = true;
    const base = route;
    route = (c) => (c.method === "POST" && fail ? { status: 500, body: { error: "internal" } } : base(c));
    const { root } = await mount(workbench, "/review/workshop-appeals");
    click(root, '[data-wsa-act="upheld"]'); await settle();
    settleConfirm(true, "", "維持");
    await settle();
    expect(root.querySelector("[data-wsa-failed]")).not.toBeNull();
    fail = false;
    root.querySelector<HTMLButtonElement>("[data-wsa-failed] button")!.click();
    await settle();
    const sent = posts("/decision");
    expect(sent).toHaveLength(2);
    expect((sent[1]!.body as { operationId: string }).operationId).toBe((sent[0]!.body as { operationId: string }).operationId);
    expect(root.querySelector("[data-wsa-failed]")).toBeNull();
  });

  it("a case the manager is part of has no action buttons, only the reason why", async () => {
    list = [appeal({ id: "mine", viewerRelation: "maker" }), appeal({ id: "card", viewerRelation: "owner" })];
    const { root } = await mount(workbench, "/review/workshop-appeals");
    for (const id of ["mine", "card"]) {
      const row = root.querySelector(`[data-wsa-case="${id}"]`)!;
      expect(row.querySelector("[data-wsa-act]")).toBeNull();
      expect(row.querySelector("[data-wsa-self]")).not.toBeNull();
    }
    expect(root.querySelector('[data-wsa-case="mine"] [data-wsa-self]')?.textContent).toContain("你是這個擴充的製作者");
    expect(root.querySelector('[data-wsa-case="card"] [data-wsa-self]')?.textContent).toContain("你是這張卡的原作者");
  });

  it("decided cases show the result and no actions; reasons stay readable", async () => {
    const { root } = await mount(workbench, "/review/workshop-appeals");
    click(root, '[data-wsa-status="decided"]'); await settle();
    const row = root.querySelector('[data-wsa-case="d1"]')!;
    expect(row.querySelector("[data-wsa-result]")?.textContent).toBe("已恢復");
    expect(row.querySelector("[data-wsa-act]")).toBeNull();
    expect(row.textContent).toContain("製作者的申訴：地圖只是示意圖，沒有劇情。");
  });

  describe("查看 the extension's content", () => {
    const CONTENT = {
      id: "w1", releaseId: "r1", name: "霧港地圖", summary: "地圖", description: "港口的手繪地圖。", coverUrl: null,
      version: "v1", previousVersion: null, updateNote: null, residentChars: 0, residentMax: 2000,
      entries: [{ entryId: "e1", name: "燈塔", content: "燈塔在港口北側。", keywords: ["燈塔"], secondaryKeywords: [], isEnabled: true, isConstant: false }],
      rules: [], openings: [],
    };
    let failContent = false;
    beforeEach(() => {
      failContent = false;
      const base = route;
      route = (c) => (c.path === "/v1/moderation/workshops/w1/content" ? (failContent ? { status: 500, body: { error: "internal" } } : { body: CONTENT }) : base(c));
    });
    const reads = () => calls.filter((c) => c.method === "GET" && c.path.endsWith("/content"));

    it("reads the content only when 查看 is pressed, opens it in the panel, collapses, and does not read again", async () => {
      const { root } = await mount(workbench, "/review/workshop-appeals");
      const view = () => root.querySelector<HTMLButtonElement>('[data-wsa-case="ap1"] [data-wsa-view]')!;
      expect(reads()).toHaveLength(0);
      expect(view().getAttribute("aria-expanded")).toBe("false");
      expect(root.querySelector("[data-wsa-content]")).toBeNull();

      view().click(); await settle();
      expect(reads().map((c) => c.path)).toEqual(["/v1/moderation/workshops/w1/content"]);
      expect(view().getAttribute("aria-expanded")).toBe("true");
      const box = root.querySelector('[data-wsa-case="ap1"] [data-wsa-content]')!;
      expect(box.querySelector('[data-content="about"]')?.textContent).toContain("港口的手繪地圖。");
      expect(box.querySelector('[data-content="lore"]')?.textContent).toContain("燈塔在港口北側。");

      view().click(); await settle();
      expect(view().getAttribute("aria-expanded")).toBe("false");
      expect(root.querySelector("[data-wsa-content]")).toBeNull();

      view().click(); await settle();
      expect(root.querySelector('[data-wsa-content] [data-content="lore"]')).not.toBeNull();
      expect(reads()).toHaveLength(1);
    });

    it("decided cases and cases the manager is part of can still be viewed", async () => {
      list = [appeal({ id: "mine", viewerRelation: "maker" })];
      const { root } = await mount(workbench, "/review/workshop-appeals");
      root.querySelector<HTMLButtonElement>('[data-wsa-case="mine"] [data-wsa-view]')!.click(); await settle();
      expect(root.querySelector('[data-wsa-case="mine"] [data-wsa-content] [data-content="lore"]')).not.toBeNull();
      root.querySelector<HTMLButtonElement>('[data-wsa-status="decided"]')!.click(); await settle();
      root.querySelector<HTMLButtonElement>('[data-wsa-case="d1"] [data-wsa-view]')!.click(); await settle();
      expect(root.querySelector('[data-wsa-case="d1"] [data-wsa-content] [data-content="lore"]')).not.toBeNull();
    });

    it("a failed read says so with a retry, and the retry reads again", async () => {
      failContent = true;
      const { root } = await mount(workbench, "/review/workshop-appeals");
      root.querySelector<HTMLButtonElement>("[data-wsa-view]")!.click(); await settle();
      const error = root.querySelector("[data-wsa-content-error]")!;
      expect(error.textContent).toContain("擴充內容載入不了，請重試。");
      expect(root.querySelector("[data-wsa-content] [data-content]")).toBeNull();

      failContent = false;
      error.querySelector<HTMLButtonElement>("button")!.click(); await settle();
      expect(reads()).toHaveLength(2);
      expect(root.querySelector("[data-wsa-content-error]")).toBeNull();
      expect(root.querySelector('[data-wsa-content] [data-content="lore"]')).not.toBeNull();
    });
  });
});

// ── 擴充詳情的站方管理 ──────────────────────────────────────────────────
describe("extension detail staff block", () => {
  const DETAIL: ExtensionDetail = {
    id: "w1", cardId: "c1", name: "霧港地圖", summary: "地圖", coverUrl: "", author: { handle: "h", name: "小霜" },
    joinCount: 3, version: 1, updatedAt: Date.now(), kinds: ["display"], rating: null, adult: false, readme: "", commentCount: 0,
    card: { id: "c1", num: 100021, name: "夜行偵探", roleId: "role-1" },
    contents: { loreCount: 0, ruleCount: 1, openingCount: 0 }, residentChars: 0, availability: "open",
  };
  beforeEach(() => { fake.detail = DETAIL; route = (c) => (c.path.endsWith("/revoke") ? { body: {} } : undefined); });
  const page = () => mount([{ path: "/workshops/:id", component: ExtensionPage }], "/workshops/w1");

  it("managers get a take-down that opens the same danger confirm and posts the reason", async () => {
    const { root } = await page();
    expect(root.querySelector("[data-ext-staff]")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("[data-ext-revoke]")!.click(); await settle();
    expect(confirmState.current?.danger).toBe(true);
    expect(confirmState.current?.field?.required).toBe(true);
    settleConfirm(true, "", "違反站規");
    await settle();
    expect(posts("/revoke").map((c) => [c.path, (c.body as { reason: string }).reason])).toEqual([["/v1/moderation/workshops/w1/revoke", "違反站規"]]);
  });

  it("ordinary reviewers and players do not see it", async () => {
    signIn("reviewer");
    const { root } = await page();
    expect(root.querySelector("[data-ext-staff]")).toBeNull();
  });
});

// ── 重新開放時通知我 ─────────────────────────────────────────────────
describe("notify me when reopened", () => {
  const paused = (over: Partial<CardWorkshopPage> & { viewerInterested?: boolean } = {}) =>
    ({ tabVisible: true, allowNew: false, viewerIsOwner: false, total: 0, page: 1, hasMore: false, items: [], viewerInterested: false, ...over });
  const tab = (initial: ReturnType<typeof paused>) => mountComponent(WorkshopTab, { cardId: "c1", cardNum: "100021", initial, state: null, joinBusy: null });
  beforeEach(() => {
    route = (c) => (c.path === "/v1/cards/c1/workshop/interest" ? { body: { interested: c.method === "PUT" } } : undefined);
  });

  it("register asks for an optional draft name, then shows the green chip; cancel turns it back", async () => {
    const { root } = await tab(paused());
    root.querySelector<HTMLButtonElement>("[data-ws-interest]")!.click(); await settle();
    expect(confirmState.current?.title).toBe("重新開放時通知我");
    expect(confirmState.current?.focusCancel).toBe(true);
    expect(confirmState.current?.field?.required).toBeFalsy();
    settleConfirm(true, "", "港口祭的番外");
    await settle();
    expect(posts("/workshop/interest")).toEqual([{ method: "PUT", path: "/v1/cards/c1/workshop/interest", body: { draftName: "港口祭的番外" } }]);
    expect(root.querySelector("[data-ws-interested]")?.textContent).toBe("已登記，重新開放時通知你");
    expect(root.querySelector("[data-ws-interest]")).toBeNull();
    expect(document.body.textContent).toContain("已登記，重新開放時會通知你。");

    root.querySelector<HTMLButtonElement>("[data-ws-interest-off]")!.click(); await settle();
    expect(posts("/workshop/interest").map((c) => c.method)).toEqual(["PUT", "DELETE"]);
    expect(root.querySelector("[data-ws-interested]")).toBeNull();
    expect(root.querySelector("[data-ws-interest]")).not.toBeNull();
  });

  it("closing the dialog registers nothing; the server's earlier registration shows as the chip", async () => {
    let { root } = await tab(paused());
    root.querySelector<HTMLButtonElement>("[data-ws-interest]")!.click(); await settle();
    settleConfirm(false); await settle();
    expect(posts("/workshop/interest")).toHaveLength(0);
    app!.unmount(); app = null; document.body.innerHTML = "";
    ({ root } = await tab(paused({ viewerInterested: true })));
    expect(root.querySelector("[data-ws-interested]")).not.toBeNull();
  });

  it("stays registered when the tab is mounted again with the page data it first got", async () => {
    let { root } = await tab(paused());
    root.querySelector<HTMLButtonElement>("[data-ws-interest]")!.click(); await settle();
    settleConfirm(true, "", ""); await settle();
    expect(posts("/workshop/interest")[0]!.body).toEqual({});
    app!.unmount(); app = null; document.body.innerHTML = "";
    ({ root } = await tab(paused({ viewerInterested: false })));
    expect(root.querySelector("[data-ws-interested]")).not.toBeNull();
  });

  it("is not offered to the card author, signed-out visitors, or while the workshop is open", async () => {
    let { root } = await tab(paused({ viewerIsOwner: true }));
    expect(root.querySelector("[data-ws-interest]")).toBeNull();
    app!.unmount(); app = null; document.body.innerHTML = "";
    ({ root } = await tab(paused({ allowNew: true })));
    expect(root.querySelector("[data-ws-interest]")).toBeNull();
    app!.unmount(); app = null; document.body.innerHTML = "";
    fake.session = reactive({ me: null, profile: null, ready: true, accessToken: vi.fn(async () => null) });
    ({ root } = await tab(paused()));
    expect(root.querySelector("[data-ws-interest]")).toBeNull();
  });

  it("card picker: a paused card's row registers straight away without a dialog", async () => {
    const cards: WorkshopCardChoice[] = [
      { cardId: "c1", num: 100021, name: "夜行偵探", author: { name: "汐見" }, roleId: "r1", allowNew: false },
      { cardId: "c2", num: 100022, name: "星砂旅店", author: { name: "Kai" }, roleId: "r2", allowNew: true },
    ];
    fake.cards = cards;
    await mountComponent(CardPickerDialog, {});
    expect(document.querySelector('[data-ws-pick-interest="c2"]')).toBeNull();
    document.querySelector<HTMLButtonElement>('[data-ws-pick-interest="c1"]')!.click();
    await settle();
    expect(confirmState.current).toBeNull();
    expect(posts("/workshop/interest")).toEqual([{ method: "PUT", path: "/v1/cards/c1/workshop/interest", body: {} }]);
    expect(document.querySelector('[data-ws-pick-interested="c1"]')?.textContent).toBe("已登記，重新開放時通知你");
    expect(document.body.textContent).toContain("已登記，重新開放時會通知你。");
    // 灰列本身仍不能選
    expect(document.querySelector('[data-ws-pick="c1"]')?.getAttribute("aria-disabled")).toBe("true");
  });
});

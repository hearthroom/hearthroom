/**
 * 工坊的站方撤下：擴充詳情頁上只有人類 manager／owner 看得到撤下，確認框要理由。
 * 網路整個換成假的 fetch（照網址回），這樣釘的是真的請求路徑、方法與內容；確認框用真的 confirmForm，
 * 「理由必填」才是真的被擋，不是測試自己說了算。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App, type Component } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";
import type { ExtensionDetail } from "../src/lib/workshop";

const fake = vi.hoisted(() => ({
  session: null as null | Record<string, unknown>,
  me: { reviewer: true, role: "manager" } as Record<string, unknown>,
  detail: null as unknown,
}));
vi.mock("../src/lib/session", () => ({ useSession: () => fake.session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), fetchReviewMe: async () => fake.me }));
vi.mock("../src/lib/workshop", async (original) => ({
  ...(await original<object>()),
  fetchWorkshop: async () => fake.detail,
  fetchSelection: async () => ({ revision: 1, items: [] }),
}));

import ExtensionPage from "../src/pages/ExtensionPage.vue";

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

let app: App | null = null;
async function mount(routes: { path: string; component: Component }[], at: string): Promise<{ root: HTMLElement; router: Router }> {
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

beforeEach(() => {
  calls = [];
  route = () => undefined;
  stubFetch();
  signIn();
});
afterEach(() => {
  if (confirmState.current) settleConfirm(false);
  app?.unmount(); app = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
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

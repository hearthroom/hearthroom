/**
 * 擴充詳情頁：主按鈕列的四種狀態、成人擴充的年齡門、分頁記在網址。
 * 請求函式整組換掉（網頁照伺服器回的 availability／清單畫，這裡就是在釘「照什麼畫」）；
 * 評論區與成人聲明窗換成樁，只看頁面有沒有把它們叫出來。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, defineComponent, h, nextTick, reactive, type App } from "vue";
import { createPinia } from "pinia";
import { createMemoryHistory, createRouter, RouterView, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import type { ExtensionDetail, Selection } from "../src/lib/workshop";

const api = vi.hoisted(() => ({
  fetchWorkshop: vi.fn(),
  fetchWorkshopVersions: vi.fn(),
  fetchSelection: vi.fn(),
  fetchUsageSummary: vi.fn(),
  installWorkshop: vi.fn(),
  uninstallWorkshop: vi.fn(),
  confirm: vi.fn(),
}));
const fake = vi.hoisted(() => ({ session: null as null | Record<string, unknown> }));

vi.mock("../src/lib/workshop", async (original) => ({
  ...(await original<typeof import("../src/lib/workshop")>()),
  fetchWorkshop: api.fetchWorkshop,
  fetchWorkshopVersions: api.fetchWorkshopVersions,
  fetchSelection: api.fetchSelection,
  fetchUsageSummary: api.fetchUsageSummary,
  installWorkshop: api.installWorkshop,
  uninstallWorkshop: api.uninstallWorkshop,
}));
vi.mock("../src/lib/confirm", async (original) => ({ ...(await original<typeof import("../src/lib/confirm")>()), confirmDialog: api.confirm }));
vi.mock("../src/lib/session", () => ({ useSession: () => fake.session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "card", setSurface: () => {} }));
vi.mock("../src/components/CommentPanel.vue", async () => {
  const { defineComponent: dc, h: hh, onMounted } = await import("vue");
  return {
    default: dc({
      props: { target: { type: Object, required: false } },
      emits: ["count"],
      setup(props, { emit }) {
        onMounted(() => emit("count", 7));
        return () => hh("div", { "data-comment-stub": JSON.stringify(props.target) });
      },
    }),
  };
});
vi.mock("../src/components/AdultConsentDialog.vue", async () => {
  const { defineComponent: dc, h: hh } = await import("vue");
  return { default: dc({ emits: ["close", "done"], setup: () => () => hh("div", { "data-adult-consent": "" }) }) };
});

import ExtensionPage from "../src/pages/ExtensionPage.vue";
import { forgetCardWorkshops } from "../src/lib/card-workshop";

const DETAIL: ExtensionDetail = {
  id: "w1", cardId: "c1", name: "霧鐘鎮", summary: "多一段支線", coverUrl: "", author: { handle: "h", name: "月光" },
  joinCount: 1234, version: 3, updatedAt: 1_763_100_000_000, kinds: ["lore", "opening"], rating: null, adult: false,
  readme: "", commentCount: 2,
  card: { id: "c1", num: 100021, name: "夜行偵探", roleId: "role-1" },
  contents: { loreCount: 4, ruleCount: 0, openingCount: 1 }, residentChars: 1200, availability: "open",
};
const selection = (ids: string[]): Selection => ({
  revision: 1,
  items: ids.map((workshopId) => ({ workshopId, enabled: true, name: "x", coverUrl: "", kinds: [], residentChars: 0, availability: "open" as const })),
});

let app: App | null = null;
let router: Router;
// 路由切換要跨過幾個 macrotask，光等微任務不夠
const settle = async () => { for (let i = 0; i < 4; i++) { await new Promise((r) => setTimeout(r, 0)); await nextTick(); } };

function signIn(profile: Record<string, unknown> = { showNsfw: true, ageVerified: true, adultConsent: true }) {
  fake.session = reactive({ me: { accountNumId: 7 }, profile, accessToken: vi.fn(async () => "tok") });
}

async function mount(path = "/workshops/w1") {
  const root = document.createElement("div");
  document.body.append(root);
  const blank = defineComponent({ render: () => null });
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/workshops/:id", component: ExtensionPage },
      { path: "/:rest(.*)*", component: blank },
    ],
  });
  await router.push(path);
  await router.isReady();
  app = createApp({ render: () => h(RouterView) });
  app.use(createPinia());
  app.use(router);
  app.use(i18n);
  app.mount(root);
  await settle();
  return root;
}

beforeEach(() => {
  fake.session = reactive({ me: null, profile: null, accessToken: vi.fn(async () => null) });
  api.fetchWorkshop.mockResolvedValue(DETAIL);
  api.fetchWorkshopVersions.mockResolvedValue({ items: [], hasMore: false });
  api.fetchSelection.mockResolvedValue(selection([]));
  api.fetchUsageSummary.mockRejectedValue(new Error("skip"));
  api.installWorkshop.mockResolvedValue(selection(["w1"]));
  api.uninstallWorkshop.mockResolvedValue(selection([]));
  api.confirm.mockResolvedValue(false);
});
afterEach(() => {
  app?.unmount();
  app = null;
  document.body.innerHTML = "";
  forgetCardWorkshops();
  vi.clearAllMocks();
});

const mode = (root: HTMLElement) => root.querySelector<HTMLElement>("[data-ext-mode]")?.dataset.extMode;

describe("主按鈕列", () => {
  it("未加入：只有一顆主按鈕「加入」，按了就加進清單並變成已加入", async () => {
    signIn();
    const root = await mount();
    expect(mode(root)).toBe("join");
    const join = root.querySelector<HTMLButtonElement>("[data-ext-join]")!;
    expect(join.classList.contains("btn--primary")).toBe(true);
    expect(root.querySelectorAll(".btn--primary")).toHaveLength(1);
    join.click();
    await settle();
    expect(api.installWorkshop).toHaveBeenCalledWith("role-1", "w1", "tok");
    expect(mode(root)).toBe("joined");
    expect(document.body.textContent).toContain("已加入「霧鐘鎮」");
  });

  it("已加入：綠 chip＋管理＋移除；移除後立刻變回加入，toast 帶復原", async () => {
    signIn();
    api.fetchSelection.mockResolvedValue(selection(["w1"]));
    const root = await mount();
    expect(mode(root)).toBe("joined");
    expect(root.querySelector("[data-ext-joined]")?.classList.contains("ws-chip--ok")).toBe(true);
    expect(root.querySelector("[data-ext-manage]")).not.toBeNull();
    expect(root.querySelector(".btn--primary")).toBeNull();
    root.querySelector<HTMLButtonElement>("[data-ext-leave]")!.click();
    await settle();
    expect(api.uninstallWorkshop).toHaveBeenCalledWith("role-1", "w1", "tok");
    // 詳情帶的 joined 旗標已經過時：清單讀到之後以清單為準
    expect(mode(root)).toBe("join");
    const undo = document.body.querySelector<HTMLButtonElement>(".ws-toast__undo");
    expect(undo?.textContent).toContain("復原");
  });

  it("已加入時「管理」開啟管理視窗", async () => {
    signIn();
    api.fetchSelection.mockResolvedValue(selection(["w1"]));
    const root = await mount();
    root.querySelector<HTMLButtonElement>("[data-ext-manage]")!.click();
    await settle();
    expect(document.body.querySelector("#ws-manage-title")).not.toBeNull();
  });

  it("已下架：停用的「已下架」加說明；在清單裡多一顆移除，不在就沒有", async () => {
    signIn();
    api.fetchWorkshop.mockResolvedValue({ ...DETAIL, availability: "removed" });
    api.fetchSelection.mockResolvedValue(selection(["w1"]));
    let root = await mount();
    expect(mode(root)).toBe("removed");
    const off = root.querySelector<HTMLButtonElement>("[data-ext-disabled]")!;
    expect(off.disabled).toBe(true);
    expect(off.textContent).toContain("已下架");
    expect(root.querySelector("[data-ext-note=removed]")?.textContent).toContain("這個擴充已下架");
    expect(root.querySelector("[data-ext-leave]")).not.toBeNull();
    expect(root.querySelector("[data-ext-join]")).toBeNull();

    app!.unmount(); document.body.innerHTML = ""; forgetCardWorkshops();
    api.fetchSelection.mockResolvedValue(selection([]));
    root = await mount();
    expect(mode(root)).toBe("removed");
    expect(root.querySelector("[data-ext-leave]")).toBeNull();
  });

  it("被隱藏（新玩家）：停用的「暫不開放加入」加說明，沒有加入鈕", async () => {
    api.fetchWorkshop.mockResolvedValue({ ...DETAIL, availability: "hidden" });
    const root = await mount();
    expect(mode(root)).toBe("hidden");
    const off = root.querySelector<HTMLButtonElement>("[data-ext-disabled]")!;
    expect(off.disabled).toBe(true);
    expect(off.textContent).toContain("暫不開放加入");
    expect(root.querySelector("[data-ext-note=hidden]")?.textContent).toContain("原作者暫時隱藏了這個擴充");
    expect(root.querySelector("[data-ext-join]")).toBeNull();
  });

  it("身分晚到：帶 token 重讀詳情，並讀玩家清單", async () => {
    const root = await mount();
    expect(api.fetchWorkshop).toHaveBeenLastCalledWith("w1", null);
    api.fetchSelection.mockResolvedValue(selection(["w1"]));
    fake.session!.accessToken = vi.fn(async () => "tok");
    fake.session!.profile = { showNsfw: true, ageVerified: true, adultConsent: true };
    fake.session!.me = { accountNumId: 7 };
    await settle();
    expect(api.fetchWorkshop).toHaveBeenLastCalledWith("w1", "tok");
    expect(mode(root)).toBe("joined");
  });
});

describe("成人擴充", () => {
  it("沒同意過成人內容：按加入先要求年齡確認，不直接加入", async () => {
    signIn({ showNsfw: false, ageVerified: false, adultConsent: false });
    api.fetchWorkshop.mockResolvedValue({ ...DETAIL, adult: true });
    const root = await mount();
    expect(root.querySelector("[data-ext-adult]")).not.toBeNull();
    root.querySelector<HTMLButtonElement>("[data-ext-join]")!.click();
    await settle();
    expect(document.body.querySelector("[data-adult-consent]")).not.toBeNull();
    expect(api.installWorkshop).not.toHaveBeenCalled();
  });

  it("已同意過：再問一次這個擴充含成人內容，取消就不加入", async () => {
    signIn();
    api.fetchWorkshop.mockResolvedValue({ ...DETAIL, adult: true });
    const root = await mount();
    root.querySelector<HTMLButtonElement>("[data-ext-join]")!.click();
    await settle();
    expect(api.confirm).toHaveBeenCalledTimes(1);
    expect(api.confirm.mock.calls[0]![0]).toMatchObject({ focusCancel: true });
    expect(api.installWorkshop).not.toHaveBeenCalled();
    expect(mode(root)).toBe("join");
  });
});

describe("分頁", () => {
  it("沒有參數是介紹；點更新紀錄、評論寫進網址，網址決定顯示哪一頁", async () => {
    api.fetchWorkshopVersions.mockResolvedValue({ items: [{ version: 3, publishedAt: 1_763_100_000_000, note: "<b>新增</b>三條" }, { version: 1, publishedAt: null, note: "" }], hasMore: false });
    const root = await mount();
    expect(root.querySelector("[data-ext-resident]")?.textContent).toContain("1,200");
    expect(root.querySelector("[data-include=regex]")).toBeNull();
    expect(root.querySelector("[data-include=lore]")?.textContent).toContain("世界書 4 條");

    root.querySelector<HTMLButtonElement>("#ext-tab-log")!.click();
    await settle();
    expect(router.currentRoute.value.query.tab).toBe("log");
    expect(api.fetchWorkshopVersions).toHaveBeenCalledWith("w1", 1);
    const current = root.querySelector('[data-version="3"]');
    expect(current?.querySelector("[data-current-version]")?.textContent).toContain("目前版本");
    // 作者寫的更新說明是純文字
    expect(current?.textContent).toContain("<b>新增</b>三條");
    expect(current?.querySelector("b")).toBeNull();
    expect(root.querySelector('[data-version="1"] [data-current-version]')).toBeNull();
    expect(root.querySelector('[data-version="1"]')?.textContent).toContain("首次發布");

    root.querySelector<HTMLButtonElement>("#ext-tab-comments")!.click();
    await settle();
    expect(router.currentRoute.value.query.tab).toBe("comments");
    expect(JSON.parse(root.querySelector<HTMLElement>("[data-comment-stub]")!.dataset.commentStub!)).toEqual({ kind: "workshop", workshopId: "w1" });
    // 評論數以評論區回報的為準
    expect(root.querySelector("#ext-tab-comments")?.textContent).toContain("7");

    root.querySelector<HTMLButtonElement>("#ext-tab-about")!.click();
    await settle();
    expect(router.currentRoute.value.query.tab).toBeUndefined();
  });

  it("直接開 ?tab=comments 就在評論分頁；不認得的值回到介紹", async () => {
    let root = await mount("/workshops/w1?tab=comments");
    expect(root.querySelector("#ext-tab-comments")?.getAttribute("aria-selected")).toBe("true");
    expect(root.querySelector("[data-comment-stub]")).not.toBeNull();
    app!.unmount(); document.body.innerHTML = "";
    root = await mount("/workshops/w1?tab=bogus");
    expect(root.querySelector("#ext-tab-about")?.getAttribute("aria-selected")).toBe("true");
  });
});

describe("載入", () => {
  it("找不到畫 404；其他錯誤畫錯誤＋重試", async () => {
    const { ApiError } = await import("../src/lib/api");
    api.fetchWorkshop.mockRejectedValueOnce(new ApiError(404, "not_found", "not_found"));
    let root = await mount();
    expect(root.textContent).toContain("找不到這個擴充");
    app!.unmount(); document.body.innerHTML = "";

    api.fetchWorkshop.mockRejectedValueOnce(new Error("offline"));
    root = await mount();
    const err = root.querySelector(".notice--error");
    expect(err?.textContent).toContain("這個擴充暫時載入不了");
    err!.querySelector<HTMLButtonElement>("button")!.click();
    await settle();
    expect(mode(root)).toBe("join");
  });
});

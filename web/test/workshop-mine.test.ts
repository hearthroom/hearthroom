import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App, type Component } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";
import type { ExtensionSummary, MineItem, WorkshopCardChoice } from "../src/lib/workshop";

const ws = vi.hoisted(() => ({
  fetchMyWorkshops: vi.fn(), fetchWorkshopCards: vi.fn(), fetchPolicy: vi.fn(), savePolicy: vi.fn(),
}));
const api = vi.hoisted(() => ({ fetchCard: vi.fn() }));
vi.mock("../src/lib/workshop", async (original) => ({ ...(await original<object>()), ...ws }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), ...api }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => "tok" }) }));
import MineExtensions from "../src/components/workshop/MineExtensions.vue";
import CardPickerDialog from "../src/components/workshop/CardPickerDialog.vue";
import OwnerWorkshopBlock from "../src/components/workshop/OwnerWorkshopBlock.vue";

let app: App | undefined;
const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve(); } };
beforeEach(() => { i18n.global.locale.value = "zh-Hant"; });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); if (confirmState.current) settleConfirm(false); });

const Blank = { render: () => null };
async function mount(component: Component, props: Record<string, unknown> = {}, at = "/mine"): Promise<Router> {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/:rest(.*)*", component: Blank },
  ] });
  await router.push(at);
  await router.isReady();
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(component, props) }); app.use(i18n); app.use(router); app.mount(root);
  await settle();
  return router;
}

const summary = (id: string, over: Partial<ExtensionSummary> = {}): ExtensionSummary => ({
  id, cardId: "100001", name: `擴充${id}`, summary: "", coverUrl: "", author: { handle: null, name: "鹽與帆" },
  joinCount: 12, version: 2, updatedAt: 0, kinds: ["lore"], kind: "lorebook", loreCount: 3, rating: "G", adult: false, ownerState: "visible", ...over,
});
const mine = (id: string, over: Partial<MineItem> = {}): MineItem => ({
  ...summary(id), card: { id: "100001", num: 100001, name: "霧港燈塔", roleId: "role-1" },
  status: "live", ownerState: "visible", workshopClosed: false, ...over,
});
const row = (id: string) => document.querySelector<HTMLElement>(`[data-ws-mine="${id}"]`)!;

it("my extensions: a layer chip and draft or published; closed and hidden are marks with a line, never an appeal", async () => {
  ws.fetchMyWorkshops.mockResolvedValue({ items: [
    mine("dlc", { kind: "dlc", status: "draft", name: "" }),
    mine("closed", { workshopClosed: true }),
    mine("hid", { ownerState: "hidden", status: "live_changed" }),
    mine("ownclosed", { kind: "dlc", workshopClosed: true }),
  ] });
  await mount(MineExtensions);
  expect(row("dlc").querySelector("[data-ws-kind]")?.textContent).toBe("作者 DLC");
  expect(row("dlc").querySelector("[data-ws-status]")?.textContent).toBe("草稿");
  expect(row("dlc").querySelector(".mine-ws__name")?.textContent).toBe("未命名 DLC");
  expect(row("closed").querySelector("[data-ws-kind]")?.textContent).toBe("玩家擴充");
  expect(row("closed").querySelector("[data-ws-status]")?.textContent).toBe("已發布");
  expect(row("closed").querySelector("[data-ws-closed]")?.textContent).toBe("作者已關閉工坊");
  expect(row("closed").querySelector("[data-ws-closed-note]")?.textContent).toContain("重新開啟後會自動恢復");
  expect(row("hid").querySelector("[data-ws-status]")?.textContent).toBe("已發布");
  expect(row("hid").querySelector("[data-ws-hidden]")?.textContent).toBe("原作者已隱藏");
  // 自己的 DLC 用第一人稱，不自稱「原作者」
  expect(row("ownclosed").querySelector("[data-ws-closed]")?.textContent).toBe("工坊已關閉");
  expect(document.body.textContent).not.toMatch(/申訴|審核|分潤/);
  expect(document.querySelector("[data-ws-appeal]")).toBeNull();
});

it("card picker: other people's closed cards are greyed out with the reason; open ones say 玩家擴充; my cards say DLC", async () => {
  const cards: WorkshopCardChoice[] = [
    { cardId: "100003", num: 100003, name: "封閉的圖書館", author: { name: "鹽與帆" }, roleId: "r3", allowNew: false },
    { cardId: "100002", num: 100002, name: "星砂旅店", author: { name: "Kai" }, roleId: "r2", allowNew: true },
    { cardId: "100004", num: 100004, name: "我的燈塔", author: { name: "我" }, roleId: "r4", allowNew: true, viewerIsOwner: true },
    { cardId: "100005", num: 100005, name: "我的舊卡", author: { name: "我" }, roleId: "r5", allowNew: false, viewerIsOwner: true },
  ];
  ws.fetchWorkshopCards.mockResolvedValue({ items: cards });
  const router = await mount(CardPickerDialog);
  const closed = document.querySelector<HTMLButtonElement>('[data-ws-pick="100003"]')!;
  expect(closed.getAttribute("aria-disabled")).toBe("true");
  expect(closed.textContent).toContain("作者沒有開啟工坊");
  expect(document.querySelector('[data-ws-pick-settings="100003"]')).toBeNull();
  expect(document.querySelector('[data-ws-pick="100002"]')?.textContent).toContain("玩家擴充");
  expect(document.querySelector('[data-ws-pick="100004"]')?.textContent).toContain("你的卡・建立 DLC");
  expect(document.querySelector('[data-ws-pick="100005"]')?.textContent).toContain("你的卡・工坊關閉");
  expect(document.querySelector<HTMLAnchorElement>('[data-ws-pick-settings="100005"]')?.getAttribute("href")).toBe("/cards/100005/edit");
  expect(document.body.textContent).not.toContain("通知我");
  closed.click();
  await settle(); await new Promise((r) => setTimeout(r, 0)); await settle();
  expect(router.currentRoute.value.path).toBe("/mine");
  document.querySelector<HTMLButtonElement>('[data-ws-pick="100002"]')!.click();
  await settle(); await new Promise((r) => setTimeout(r, 0)); await settle();
  expect(router.currentRoute.value.path).toMatch(/\/mine\/workshops\/new$/);
  expect(router.currentRoute.value.query.card).toBe("100002");
});

const counts = (over = {}) => ({ dlcPublished: 2, dlcDrafts: 1, lorebookPublished: 5, lorebookDrafts: 0, joinCount: 320, ...over });
it("owner switch: off by default; turning it on saves right away and shows both layers", async () => {
  ws.fetchPolicy.mockResolvedValue({ allowNew: false, revision: 3, items: [], counts: counts({ dlcPublished: 0, dlcDrafts: 0, lorebookPublished: 0, joinCount: 0 }) });
  ws.savePolicy.mockImplementation(async (_r: string, allowNew: boolean, rev: number) => ({ allowNew, revision: rev + 1, items: [], counts: counts({ dlcPublished: 0, dlcDrafts: 0, lorebookPublished: 0, joinCount: 0 }) }));
  await mount(OwnerWorkshopBlock, { roleId: "role-1", cardId: "100001" });
  const sw = () => document.querySelector<HTMLButtonElement>("[data-ws-owner-switch]")!;
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector("[data-ws-owner-layers]")).toBeNull();
  expect(document.querySelector("[data-ws-owner-kept]")).toBeNull();
  sw().click();
  await settle();
  expect(confirmState.current).toBeNull();
  expect(ws.savePolicy).toHaveBeenCalledWith("100001", true, 3, "tok");
  expect(sw().getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector("[data-ws-owner-dlc]")?.textContent).toContain("還沒有 DLC");
  expect(document.querySelector("[data-ws-owner-ext]")?.textContent).toContain("還沒有玩家擴充");
  expect(document.querySelector<HTMLAnchorElement>("[data-ws-owner-create]")?.getAttribute("href")).toBe("/mine/workshops/new?card=100001");
  expect(document.querySelector<HTMLAnchorElement>("[data-ws-owner-go]")?.getAttribute("href")).toBe("/cards/100001?tab=workshop");
});

it("owner switch: turning off with published content asks first (focus on cancel); without any it saves right away", async () => {
  ws.fetchPolicy.mockResolvedValue({ allowNew: true, revision: 3, items: [], counts: counts() });
  ws.savePolicy.mockImplementation(async (_r: string, allowNew: boolean, rev: number) => ({ allowNew, revision: rev + 1, items: [], counts: counts() }));
  await mount(OwnerWorkshopBlock, { roleId: "role-1", cardId: "100001" });
  const sw = () => document.querySelector<HTMLButtonElement>("[data-ws-owner-switch]")!;
  expect(document.querySelector("[data-ws-owner-dlc]")?.textContent).toContain("已發布 2・草稿 1");
  expect(document.querySelector("[data-ws-owner-ext]")?.textContent).toContain("5 個・共 320 人加入");
  sw().click();
  await settle();
  expect(confirmState.current?.title).toBe("關閉工坊？");
  expect(confirmState.current?.message).toContain("2 個 DLC 與 5 個玩家擴充停用");
  expect(confirmState.current?.focusCancel).toBe(true);
  settleConfirm(false);
  await settle();
  expect(ws.savePolicy).not.toHaveBeenCalled();
  sw().click();
  await settle();
  settleConfirm(true);
  await settle();
  expect(ws.savePolicy).toHaveBeenCalledWith("100001", false, 3, "tok");
  expect(sw().getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector("[data-ws-owner-kept]")?.textContent).toContain("2 個 DLC 與 5 個玩家擴充的內容保留");

  app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks();
  const none = counts({ dlcPublished: 0, dlcDrafts: 1, lorebookPublished: 0, joinCount: 0 });
  ws.fetchPolicy.mockResolvedValue({ allowNew: true, revision: 1, items: [], counts: none });
  ws.savePolicy.mockResolvedValue({ allowNew: false, revision: 2, items: [], counts: none });
  await mount(OwnerWorkshopBlock, { roleId: "role-1", cardId: "100001" });
  sw().click();
  await settle();
  expect(confirmState.current).toBeNull();
  expect(ws.savePolicy).toHaveBeenCalledWith("100001", false, 1, "tok");
});

it("owner switch: a failed save re-reads the server state; retry sends the same intent again", async () => {
  const empty = counts({ dlcPublished: 0, dlcDrafts: 0, lorebookPublished: 0, joinCount: 0 });
  ws.fetchPolicy.mockResolvedValue({ allowNew: false, revision: 3, items: [], counts: empty });
  ws.savePolicy.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce({ allowNew: true, revision: 4, items: [], counts: empty });
  await mount(OwnerWorkshopBlock, { roleId: "role-1", cardId: "100001" });
  document.querySelector<HTMLButtonElement>("[data-ws-owner-switch]")!.click();
  await settle();
  expect(ws.fetchPolicy).toHaveBeenCalledTimes(2);
  expect(document.querySelector("[data-ws-owner-switch]")?.getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector("[data-ws-owner-error]")?.textContent).toContain("設定未儲存");
  document.querySelector<HTMLButtonElement>("[data-ws-owner-error] button")!.click();
  await settle();
  expect(ws.savePolicy).toHaveBeenLastCalledWith("100001", true, 3, "tok");
  expect(document.querySelector("[data-ws-owner-switch]")?.getAttribute("aria-checked")).toBe("true");
  expect(document.querySelector("[data-ws-owner-error]")).toBeNull();
});

it("owner switch: if the failed save actually landed, the re-read clears the error and retry never flips it back", async () => {
  ws.fetchPolicy.mockResolvedValueOnce({ allowNew: true, revision: 3, items: [], counts: counts() })
    .mockResolvedValueOnce({ allowNew: false, revision: 4, items: [], counts: counts() });
  ws.savePolicy.mockRejectedValue(new Error("response lost"));
  await mount(OwnerWorkshopBlock, { roleId: "role-1", cardId: "100001" });
  document.querySelector<HTMLButtonElement>("[data-ws-owner-switch]")!.click();
  await settle();
  settleConfirm(true);
  await settle();
  expect(document.querySelector("[data-ws-owner-switch]")?.getAttribute("aria-checked")).toBe("false");
  expect(document.querySelector("[data-ws-owner-error]")).toBeNull();
  expect(confirmState.current).toBeNull();
  expect(ws.savePolicy).toHaveBeenCalledTimes(1);
});

it("owner switch waits for the real role id (the editor starts with the card number)", async () => {
  ws.fetchPolicy.mockResolvedValue({ allowNew: true, revision: 1, items: [] });
  await mount(OwnerWorkshopBlock, { roleId: "100001" });
  expect(ws.fetchPolicy).not.toHaveBeenCalled();
});

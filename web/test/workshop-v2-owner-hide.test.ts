/**
 * 工坊 v2：原卡作者在卡片頁工坊分頁隱藏／取消隱藏玩家擴充，以及對話資訊面板在工坊關閉時的暫停顯示。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App, type Component } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";
import type { CardWorkshopPage, ExtensionSummary } from "../src/lib/workshop";
import type { WorkshopConversationView } from "../src/lib/play-social";

const ws = vi.hoisted(() => ({ ownerAction: vi.fn(), fetchCardWorkshop: vi.fn(), fetchWorkshopsByIds: vi.fn() }));
vi.mock("../src/lib/workshop", async (original) => ({ ...(await original<object>()), ...ws }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => "tok" }) }));
import WorkshopTab from "../src/components/workshop/WorkshopTab.vue";
import PlayInfoWorkshop from "../src/components/workshop/PlayInfoWorkshop.vue";

let app: App | undefined;
const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve(); } };
beforeEach(() => { i18n.global.locale.value = "zh-Hant"; });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); if (confirmState.current) settleConfirm(false); });

async function mount(component: Component, props: Record<string, unknown>) {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: "/:rest(.*)*", component: { render: () => null } }] });
  await router.push("/cards/100001?tab=workshop");
  await router.isReady();
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(component, props) }); app.use(i18n); app.use(router); app.mount(root);
  await settle();
  return root;
}
const ext = (id: string, over: Partial<ExtensionSummary> = {}): ExtensionSummary => ({
  id, cardId: "100001", name: `擴充${id}`, summary: "", coverUrl: "", author: { handle: null, name: "阿柚" }, joinCount: 12,
  kind: "lorebook", loreCount: 12, version: 1, updatedAt: 0, kinds: ["lore"], rating: "G", adult: false, ownerState: "visible", ...over,
});
const page = (items: ExtensionSummary[]): CardWorkshopPage => ({ tabVisible: true, allowNew: true, viewerIsOwner: true, total: items.length, page: 1, hasMore: false, items });

it("the card author hides a player extension after a confirm with no reason field, then can unhide it directly", async () => {
  ws.ownerAction.mockImplementation(async (_id: string, action: string) => ({ ownerState: action === "hide" ? "hidden" : "visible" }));
  const root = await mount(WorkshopTab, { cardId: "100001", cardNum: "100001", initial: page([ext("a")]), state: null, joinBusy: null });
  const tile = () => root.querySelector<HTMLElement>("[data-ext-kind=lorebook]")!;
  tile().querySelector<HTMLButtonElement>("[data-ext-hide]")!.click();
  await settle();
  expect(confirmState.current?.title).toBe("隱藏「擴充a」？");
  expect(confirmState.current?.field).toBeUndefined();
  expect(confirmState.current?.focusCancel).toBe(true);
  settleConfirm(false);
  await settle();
  expect(ws.ownerAction).not.toHaveBeenCalled();

  tile().querySelector<HTMLButtonElement>("[data-ext-hide]")!.click();
  await settle();
  settleConfirm(true);
  await settle();
  expect(ws.ownerAction).toHaveBeenCalledWith("a", "hide", "tok");
  expect(tile().classList.contains("ext-tile--hidden")).toBe(true);
  expect(tile().querySelector("[data-ext-hidden]")?.textContent).toBe("已隱藏");
  expect(tile().querySelector("[data-ext-hide]")).toBeNull();
  expect(document.querySelector(".ws-toast")?.textContent).toContain("已隱藏「擴充a」");

  tile().querySelector<HTMLButtonElement>("[data-ext-unhide]")!.click();
  await settle();
  expect(confirmState.current).toBeNull();
  expect(ws.ownerAction).toHaveBeenLastCalledWith("a", "restore", "tok");
  expect(tile().classList.contains("ext-tile--hidden")).toBe(false);
});

it("author DLC tiles never offer hide", async () => {
  const root = await mount(WorkshopTab, { cardId: "100001", cardNum: "100001", initial: page([ext("d", { kind: "dlc", kinds: ["lore", "display"] })]), state: null, joinBusy: null });
  expect(root.querySelector("[data-ext-kind=dlc]")).not.toBeNull();
  expect(root.querySelector("[data-ext-hide]")).toBeNull();
});

const view = (over: Partial<WorkshopConversationView> = {}): WorkshopConversationView => ({
  selectionRevision: 1, manifestHash: "h", openingSource: null, triggeredCount: 0,
  items: [
    { workshopId: "d", name: "雨夜篇", coverUrl: "", kind: "dlc", kinds: ["lore", "display"], residentChars: 0, status: "resident" },
    { workshopId: "a", name: "月下書房", coverUrl: "", kind: "lorebook", kinds: ["lore"], residentChars: 120, status: "resident" },
  ],
  ...over,
});

it("conversation panel: rows say which layer they come from", async () => {
  const root = await mount(PlayInfoWorkshop, { view: view(), cardId: "100001" });
  const rows = [...root.querySelectorAll(".pip-ws__row")].map((r) => r.textContent ?? "");
  expect(rows[0]).toContain("作者 DLC");
  expect(rows[1]).toContain("玩家擴充");
  expect(root.querySelector("[data-pip-closed]")).toBeNull();
});

it("conversation panel: when the author turns the workshop off, a line explains and every row is paused", async () => {
  const items = view().items.map((i) => ({ ...i, status: "disabled" as const, reason: "workshop_closed" }));
  const root = await mount(PlayInfoWorkshop, { view: view({ workshopClosed: true, manifestHash: "", items }), cardId: "100001" });
  expect(root.querySelector("[data-pip-closed]")?.textContent).toContain("原作者已關閉這張卡的工坊");
  expect(root.querySelectorAll("[data-pip-paused]").length).toBe(2);
  expect(root.querySelectorAll(".pip-ws__row--off").length).toBe(2);
  // 工坊頁不在了，不給到工坊管理的連結
  expect(root.querySelector(".pip-ws__manage")).toBeNull();
});

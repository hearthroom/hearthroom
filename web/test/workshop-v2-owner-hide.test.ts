/**
 * 工坊管理分頁入口與遊玩視窗的存檔設定。
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App, type Component } from "vue";
import { createMemoryHistory, createRouter } from "vue-router";
import { i18n } from "../src/lib/i18n";
import type { CardWorkshopPage, ExtensionSummary } from "../src/lib/workshop";
import type { ConversationMods } from "../src/lib/workshop-mods";

const ws = vi.hoisted(() => ({ listUniversalMods: vi.fn(), fetchPlayerShares: vi.fn(), fetchCardWorkshop: vi.fn(), fetchWorkshopsByIds: vi.fn(), fetchConversationMods: vi.fn(), applyConversationMod: vi.fn() }));
vi.mock("../src/lib/workshop", async (original) => ({ ...(await original<object>()), ...ws }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => "tok" }) }));
import WorkshopTab from "../src/components/workshop/WorkshopTab.vue";
import PlayModWindow from "../src/components/workshop/PlayModWindow.vue";

let app: App | undefined;
const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve(); } };
beforeEach(() => { i18n.global.locale.value = "zh-Hant"; ws.listUniversalMods.mockResolvedValue({ items: [] }); ws.fetchPlayerShares.mockResolvedValue({ items: [] }); });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); });

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

it("the card author manages visibility from the filtered management page", async () => {
  ws.fetchPlayerShares.mockResolvedValue({ items: [{ new: true }] });
  const root = await mount(WorkshopTab, { cardId: "100001", cardNum: "100001", roleId: "role-a", initial: page([ext("a")]), state: null, joinBusy: null });
  expect(root.querySelector('[data-ext-kind=lorebook]')).not.toBeNull();
  expect(root.querySelector('[data-ext-hide]')).toBeNull();
  const manage = [...root.querySelectorAll("a")].find((link) => link.textContent?.includes("到工坊管理"));
  expect(manage?.href).toContain("tab=workshop-management&card=100001");
  expect(root.textContent).toContain("有 1 個新的玩家擴充");
});

it("author DLC tiles never offer hide", async () => {
  const root = await mount(WorkshopTab, { cardId: "100001", cardNum: "100001", initial: page([ext("d", { kind: "dlc", kinds: ["lore", "display"] })]), state: null, joinBusy: null });
  expect(root.querySelector("[data-ext-kind=dlc]")).not.toBeNull();
  expect(root.querySelector("[data-ext-hide]")).toBeNull();
});

const view = (over: Partial<ConversationMods> = {}): ConversationMods => ({
  version: "rev1", triggeredCount: 0, availableCount: 0, workshopClosed: false, privateEntryCount: 0, activePrivateEntryCount: 0,
  items: [
    { workshopId: "d", name: "雨夜篇", kind: "dlc", residentChars: 0, status: "resident", enabled: true },
    { workshopId: "a", name: "月下書房", kind: "lorebook", residentChars: 120, status: "resident", enabled: true },
  ],
  ...over,
});

async function mountWindow(value: ConversationMods) {
  ws.fetchConversationMods.mockResolvedValue(value);
  await mount(PlayModWindow, {
    open: true, conversationId: "one-save", token: async () => "tok", acceptedTurn: 0,
    settingsChanged: 0, browseHref: "/cards/100001?tab=workshop",
  });
  const dialog = document.querySelector<HTMLDialogElement>("dialog.mod-window");
  expect(dialog?.open).toBe(true);
  return dialog!;
}

it("the conversation workshop identifies each layer and waits for a successful toggle", async () => {
  const current = view();
  const dialog = await mountWindow(current);
  const rows = [...dialog.querySelectorAll(".mod-window__row")].map(row => row.textContent);
  expect(rows[0]).toContain("作者 DLC");
  expect(rows[1]).toContain("玩家擴充");
  let finish!: (next: ConversationMods) => void;
  ws.applyConversationMod.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const toggle = dialog.querySelector<HTMLButtonElement>('[role="switch"]')!;
  toggle.click();
  await settle();
  expect(toggle.getAttribute("aria-checked")).toBe("true");
  expect(toggle.disabled).toBe(true);
  expect(ws.applyConversationMod).toHaveBeenCalledWith("one-save", "rev1", { action: "toggle", workshopId: "d", enabled: false }, "tok");
  finish(view({ version: "rev2", items: [{ ...current.items[0]!, enabled: false, status: "disabled" }, current.items[1]!] }));
  await settle();
  expect(toggle.getAttribute("aria-checked")).toBe("false");
  expect(dialog.querySelector('[role="status"]')?.textContent).toContain("從下一句起生效");
});

it("closing the workshop suspends switches and private entries and hides the browse link", async () => {
  const items = view().items.map(item => ({ ...item, status: "disabled" as const, reason: "workshop_closed" }));
  items.push({ workshopId: "off", name: "自己關掉的", kind: "lorebook", residentChars: 0, status: "disabled", reason: "player_disabled", enabled: false });
  const dialog = await mountWindow(view({ items, workshopClosed: true }));
  expect(dialog.querySelector("[data-mod-paused]")?.textContent).toContain("原作者已關閉這張卡的工坊");
  const rows = [...dialog.querySelectorAll(".mod-window__row")];
  expect(rows.every(row => row.querySelector<HTMLButtonElement>('[role="switch"]')?.disabled)).toBe(true);
  expect(rows[2]?.textContent).toContain("已關閉");
  expect(dialog.querySelector<HTMLButtonElement>('[data-mod-private]')?.disabled).toBe(true);
  expect(dialog.querySelector('a[href="/cards/100001?tab=workshop"]')).toBeNull();
});

it("joins an owned universal extension from the current save and waits for confirmation", async () => {
  ws.listUniversalMods.mockResolvedValue({ items: [{ id: "universal", name: "旅行備忘", summary: "", entryCount: 1, residentChars: 20, joined: false }] });
  const current = view();
  ws.applyConversationMod.mockResolvedValue(view({ version: "rev2", items: [...current.items, {
    workshopId: "universal", name: "旅行備忘", kind: "universal", residentChars: 20, status: "resident", enabled: true,
  }] }));
  const dialog = await mountWindow(current);
  dialog.querySelector<HTMLButtonElement>("[data-mod-universal]")!.click();
  await settle();
  expect(dialog.querySelector("#play-universal-title")?.textContent).toBe("加入通用擴充");
  dialog.querySelector<HTMLButtonElement>(".mod-window__universal-join")!.click();
  await settle();
  expect(ws.applyConversationMod).toHaveBeenCalledWith("one-save", "rev1", { action: "join_universal", workshopId: "universal" }, "tok");
  expect(dialog.querySelector(".mod-window__universal-join")).toBeNull();
  dialog.querySelector<HTMLButtonElement>("[data-universal-back]")!.click();
  await settle();
  expect([...dialog.querySelectorAll(".mod-window__row")].find((row) => row.textContent?.includes("旅行備忘"))?.textContent).toContain("通用");
});

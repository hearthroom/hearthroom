import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App, type Component } from "vue";
import { createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { confirmState, settleConfirm } from "../src/lib/confirm";
import type { ExtensionSummary, MineItem, WorkshopCardChoice } from "../src/lib/workshop";

const ws = vi.hoisted(() => ({
  fetchMyWorkshops: vi.fn(), appealWorkshop: vi.fn(), fetchWorkshopCards: vi.fn(),
  fetchPolicy: vi.fn(), savePolicy: vi.fn(), ownerAction: vi.fn(),
}));
const api = vi.hoisted(() => ({ fetchCard: vi.fn() }));
vi.mock("../src/lib/workshop", async (original) => ({ ...(await original<object>()), ...ws }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), ...api }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => "tok" }) }));
import MineExtensions from "../src/components/workshop/MineExtensions.vue";
import CardPickerDialog from "../src/components/workshop/CardPickerDialog.vue";
import OwnerWorkshopBlock from "../src/components/workshop/OwnerWorkshopBlock.vue";
import CardWorkshopManagePage from "../src/pages/CardWorkshopManagePage.vue";

let app: App | undefined;
const settle = async () => { for (let i = 0; i < 8; i++) { await nextTick(); await Promise.resolve(); } };
beforeEach(() => { i18n.global.locale.value = "zh-Hant"; });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); if (confirmState.current) settleConfirm(false); });

const Blank = { render: () => null };
async function mount(component: Component, props: Record<string, unknown> = {}, at = "/mine"): Promise<Router> {
  const router = createRouter({ history: createMemoryHistory(), routes: [
    { path: "/mine/cards/:cardId/workshop", component: Blank },
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
  joinCount: 12, version: 2, updatedAt: 0, kinds: ["lore"], rating: "G", adult: false, ownerState: "visible", ownerReason: null, appeal: null, ...over,
});
const mine = (id: string, over: Partial<MineItem> = {}): MineItem => ({
  ...summary(id), card: { id: "100001", num: 100001, name: "霧港燈塔", roleId: "role-1" },
  status: "live", rejectNote: null, ownerState: "visible", ownerReason: null, appeal: null, ...over,
});

it("owner explicitly chooses closed/self/open; opening requires confirmation and self never grants third-party access", async () => {
  ws.fetchPolicy.mockResolvedValue({ mode:"closed", allowNew:false, revision:1, hasThirdParty:false, items:[] });
  ws.savePolicy.mockResolvedValue({ mode:"self", allowNew:false, revision:2, hasThirdParty:false, items:[] });
  await mount(OwnerWorkshopBlock,{roleId:"role-1",cardId:"100001"});
  const radios=()=>Array.from(document.querySelectorAll<HTMLInputElement>('[data-ws-policy-mode]'));
  expect(radios()).toHaveLength(3);
  expect(radios().find(input=>input.checked)?.value).toBe("closed");
  radios().find(input=>input.value==="self")!.click();
  await settle();
  expect(ws.savePolicy).toHaveBeenCalledWith("role-1","self",1,"tok");
  expect(radios().find(input=>input.checked)?.value).toBe("self");
  radios().find(input=>input.value==="open")!.click();
  await settle();
  expect(confirmState.current).not.toBeNull();
  expect(ws.savePolicy).toHaveBeenCalledTimes(1);
  settleConfirm(false);
  await settle();
  expect(radios().find(input=>input.checked)?.value).toBe("self");
});
const row = (id: string) => document.querySelector<HTMLElement>(`[data-ws-mine="${id}"]`)!;

it("my extensions: review feedback and the author's reason stay on the row, not only in a toast", async () => {
  ws.fetchMyWorkshops.mockResolvedValue({ items: [
    mine("rej", { status: "rejected", rejectNote: "封面含有文字浮水印。" }),
    mine("ret", { ownerState: "returned", ownerReason: "介面規則會蓋掉原卡的狀態列。" }),
    mine("ok"),
  ] });
  await mount(MineExtensions);
  expect(row("rej").querySelector("[data-ws-status]")?.textContent).toBe("審核未通過");
  expect(row("rej").querySelector("[data-ws-reason]")?.textContent).toContain("封面含有文字浮水印。");
  expect(row("ret").querySelector("[data-ws-status]")?.textContent).toBe("已被原作者退回");
  expect(row("ret").querySelector("[data-ws-reason]")?.textContent).toContain("介面規則會蓋掉原卡的狀態列。");
  expect(row("ok").querySelector("[data-ws-reason]")).toBeNull();
  // 只有被原作者處理過的才能申訴
  expect(row("ret").querySelector("[data-ws-appeal]")).not.toBeNull();
  expect(row("ok").querySelector("[data-ws-appeal]")).toBeNull();
});

it("appealing needs a reason; once sent the button is gone and the row says 申訴中", async () => {
  ws.fetchMyWorkshops.mockResolvedValue({ items: [mine("hid", { ownerState: "hidden", ownerReason: "跟主線衝突。" })] });
  ws.appealWorkshop.mockResolvedValue({ appeal: "pending" });
  await mount(MineExtensions);
  row("hid").querySelector<HTMLButtonElement>("[data-ws-appeal]")!.click();
  await settle();
  expect(confirmState.current?.field?.required).toBe(true);
  settleConfirm(true, "", "   ");
  await settle();
  expect(ws.appealWorkshop).not.toHaveBeenCalled();
  settleConfirm(true, "", "沒有違反卡片設定。");
  await settle();
  expect(ws.appealWorkshop).toHaveBeenCalledWith("hid", "沒有違反卡片設定。", "tok");
  expect(row("hid").querySelector("[data-ws-appeal]")).toBeNull();
  expect(row("hid").querySelector("[data-ws-appealing]")?.textContent).toBe("申訴中");
  // 理由仍常駐
  expect(row("hid").querySelector("[data-ws-reason]")?.textContent).toContain("跟主線衝突。");
});

it("card picker: a card closed to extensions is greyed out with its reason and cannot be picked", async () => {
  const cards: WorkshopCardChoice[] = [
    { cardId: "100003", num: 100003, name: "封閉的圖書館", author: { name: "鹽與帆" }, roleId: "r3", allowNew: false },
    { cardId: "100002", num: 100002, name: "星砂旅店", author: { name: "Kai" }, roleId: "r2", allowNew: true },
  ];
  ws.fetchWorkshopCards.mockResolvedValue({ items: cards });
  const router = await mount(CardPickerDialog);
  const closed = document.querySelector<HTMLButtonElement>('[data-ws-pick="100003"]')!;
  expect(closed.getAttribute("aria-disabled")).toBe("true");
  expect(closed.textContent).toContain("原作者沒有開放其他人建立擴充");
  closed.click();
  await settle(); await new Promise((r) => setTimeout(r, 0)); await settle();
  expect(router.currentRoute.value.path).toBe("/mine");
  document.querySelector<HTMLButtonElement>('[data-ws-pick="100002"]')!.click();
  await settle(); await new Promise((r) => setTimeout(r, 0)); await settle();
  expect(router.currentRoute.value.path).toMatch(/\/mine\/workshops\/new$/);
  expect(router.currentRoute.value.query.card).toBe("100002");
});

it("restricting a card with third-party drafts confirms consequences, and every reopening asks again", async () => {
  ws.fetchPolicy.mockResolvedValue({mode:"open",allowNew:true,revision:3,hasThirdParty:true,items:[]});
  ws.savePolicy.mockImplementation(async (_r:string,mode:string,rev:number)=>({mode,allowNew:mode==="open",revision:rev+1,hasThirdParty:true,items:[]}));
  await mount(OwnerWorkshopBlock,{roleId:"role-1",cardId:"100001"});
  const radio=(mode:string)=>document.querySelector<HTMLInputElement>(`[data-ws-policy-mode][value="${mode}"]`)!;
  radio("closed").click(); await settle();
  expect(confirmState.current?.focusCancel).toBe(true);
  expect(confirmState.current?.bullets).toHaveLength(2);
  expect(ws.savePolicy).not.toHaveBeenCalled();
  settleConfirm(true); await settle();
  expect(ws.savePolicy).toHaveBeenCalledWith("role-1","closed",3,"tok");
  expect(radio("closed").checked).toBe(true);
  radio("open").click(); await settle();
  expect(confirmState.current?.title).toBe("開放給其他人？");
  expect(confirmState.current?.bullets?.[0]).toContain("正則與開場暫停中");
  expect(ws.savePolicy).toHaveBeenCalledTimes(1);
  settleConfirm(true); await settle();
  expect(ws.savePolicy).toHaveBeenLastCalledWith("role-1","open",4,"tok");
  expect(radio("open").checked).toBe(true);
});

it("a failed response reads back the policy and never leaves a fictitious selected mode", async () => {
  ws.fetchPolicy.mockResolvedValue({mode:"closed",allowNew:false,revision:1,items:[]});
  ws.savePolicy.mockRejectedValue(new Error("network result unknown"));
  await mount(OwnerWorkshopBlock,{roleId:"role-1",cardId:"100001"});
  document.querySelector<HTMLInputElement>('[data-ws-policy-mode][value="self"]')!.click(); await settle();
  expect(ws.fetchPolicy).toHaveBeenCalledTimes(2);
  expect(document.querySelector<HTMLInputElement>('[data-ws-policy-mode][value="closed"]')!.checked).toBe(true);
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("設定未儲存");
});

it("owner switch waits for the real role id (the editor starts with the card number)", async () => {
  ws.fetchPolicy.mockResolvedValue({ allowNew: true, revision: 1, items: [] });
  await mount(OwnerWorkshopBlock, { roleId: "100001" });
  expect(ws.fetchPolicy).not.toHaveBeenCalled();
});

it("returning an extension needs a reason before it is sent, then the row keeps the state and reason", async () => {
  api.fetchCard.mockResolvedValue({ id: "100001", roleId: "role-1", name: "霧港燈塔" });
  ws.fetchPolicy.mockResolvedValue({ allowNew: true, revision: 1, items: [summary("live")] });
  ws.ownerAction.mockResolvedValue({ ownerState: "returned", ownerReason: "請改掉狀態列。" });
  await mount(CardWorkshopManagePage, {}, "/mine/cards/100001/workshop");
  expect(ws.fetchPolicy).toHaveBeenCalledWith("role-1", "tok");
  const owned = () => document.querySelector<HTMLElement>('[data-ws-owned="live"]')!;
  owned().querySelector<HTMLButtonElement>('[data-ws-act="return"]')!.click();
  await settle();
  expect(confirmState.current?.title).toBe("退回「擴充live」？");
  expect(confirmState.current?.field?.required).toBe(true);
  expect(confirmState.current?.field?.maxlength).toBe(200);
  expect(confirmState.current?.focusCancel).toBe(true);
  settleConfirm(true, "", "  ");
  await settle();
  expect(ws.ownerAction).not.toHaveBeenCalled();
  settleConfirm(true, "", "請改掉狀態列。");
  await settle();
  expect(ws.ownerAction).toHaveBeenCalledWith("live", "return", "請改掉狀態列。", "tok");
  expect(owned().querySelector("[data-ws-state]")?.textContent).toBe("已退回");
  expect(owned().querySelector("[data-ws-reason]")?.textContent).toContain("請改掉狀態列。");
  // 退回後的動作只剩「撤回退回」，直接送、不問理由
  owned().querySelector<HTMLButtonElement>('[data-ws-act="restore"]')!.click();
  await settle();
  expect(confirmState.current).toBeNull();
  expect(ws.ownerAction).toHaveBeenLastCalledWith("live", "restore", "", "tok");
});

it("the manage page explains a missing permission instead of an empty list", async () => {
  const { ApiError } = await import("../src/lib/api");
  api.fetchCard.mockResolvedValue({ id: "100009", roleId: "role-9", name: "別人的卡" });
  ws.fetchPolicy.mockRejectedValue(new ApiError(403, "forbidden", "forbidden"));
  await mount(CardWorkshopManagePage, {}, "/mine/cards/100009/workshop");
  expect(document.querySelector("[data-ws-forbidden]")?.textContent).toContain("只有這張卡的原作者可以管理它的擴充。");
  expect(document.querySelector("[data-ws-owned]")).toBeNull();
});

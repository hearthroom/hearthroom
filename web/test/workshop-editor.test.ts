import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { ApiError } from "../src/lib/api";
import type { MineItem, MineStatus, OwnerState, WorkshopDraft } from "../src/lib/workshop";

const api = vi.hoisted(() => ({
  fetchDraft: vi.fn(), saveDraft: vi.fn(), fetchMyWorkshops: vi.fn(), submitWorkshop: vi.fn(), withdrawWorkshop: vi.fn(),
  appealWorkshop: vi.fn(), deleteWorkshop: vi.fn(), createWorkshop: vi.fn(), fetchWorkshopCards: vi.fn(),
}));
const dialogs = vi.hoisted(() => ({ confirmDialog: vi.fn(), confirmForm: vi.fn() }));
const cards = vi.hoisted(() => ({ fetchCard: vi.fn() }));
vi.mock("../src/lib/api", async (original) => ({ ...(await original<object>()), ...cards }));
vi.mock("../src/lib/workshop", async (original) => ({ ...(await original<object>()), ...api }));
vi.mock("../src/lib/confirm", async (original) => ({ ...(await original<object>()), ...dialogs }));
vi.mock("../src/lib/session", () => ({ useSession: () => ({ me: { accountNumId: 7 }, accessToken: async () => "tok" }) }));
import ExtensionEditorPage from "../src/pages/ExtensionEditorPage.vue";
import PublishPane from "../src/components/workshop/editor/PublishPane.vue";
import { publishChecklist, publishState } from "../src/lib/workshop";

const t = (key: string, params: Record<string, unknown> = {}) => i18n.global.t(key, params);
let app: App | undefined;
let router: Router;
const settle = async () => { for (let i = 0; i < 10; i++) { await nextTick(); await Promise.resolve(); } };
const until = async (ok: () => boolean) => { for (let i = 0; i < 40 && !ok(); i++) await settle(); };
beforeEach(() => { i18n.global.locale.value = "zh-Hant"; });
afterEach(() => { app?.unmount(); app = undefined; document.body.innerHTML = ""; vi.clearAllMocks(); try { localStorage.clear(); } catch { /* ignore */ } });

const entry = (content: string, isConstant = true) => ({ name: "雪", content, keywords: ["雪"], secondaryKeywords: [], isEnabled: true, isConstant });
function makeDraft(over: Partial<WorkshopDraft> = {}): WorkshopDraft {
  return {
    workshopId: "w1", revision: 3,
    card: { roleId: "r1", cardId: "100001", num: 100001, name: "雪國", ownerIsMe: false },
    name: "雪夜篇", summary: "一場雪", readme: "", coverUrl: "https://img/c.png",
    rating: "G", ratingAnswers: null,
    worldbook: [entry("短短的常駐")],
    rules: { version: 1, rules: [], statusbar: "", lowered: false },
    opening: { mode: "greeting", welcome: "雪夜裡你推開門", alternates: ["第二個開場"], prologue: [], openingPage: "" },
    updateNote: "", published: null, changedSincePublish: false,
    ...over,
  } as WorkshopDraft;
}
const mineItem = (status: MineStatus, over: Partial<MineItem> = {}): MineItem => ({
  id: "w1", cardId: "100001", name: "雪夜篇", summary: "", coverUrl: "", author: { handle: null, name: "我" }, joinCount: 12,
  version: 3, updatedAt: 0, kinds: ["lore"], rating: "G", adult: false,
  card: { id: "100001", num: 100001, name: "雪國", roleId: "r1" },
  status, rejectNote: null, ownerState: "visible", ownerReason: null, appeal: null, ...over,
} as MineItem);

async function mountAt(path: string) {
  router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: "/mine/workshops/new", component: ExtensionEditorPage },
      { path: "/mine/workshops/:id/edit", component: ExtensionEditorPage },
      { path: "/mine", component: { render: () => h("p", "mine") } },
      { path: "/cards/:id", component: { render: () => h("p", "card") } },
      { path: "/play/:roleId", component: { render: () => h("p", "play") } },
    ],
  });
  await router.push(path);
  await router.isReady();
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(RouterView) });
  app.use(router); app.use(i18n); app.mount(root);
  await settle();
  return root;
}
const button = (sel: string) => document.querySelector<HTMLButtonElement>(sel);
function type(el: HTMLInputElement | HTMLTextAreaElement, value: string) { el.value = value; el.dispatchEvent(new Event("input")); }

it("blocks submission while resident lore is over the 1,500-character limit", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ worldbook: [entry("雪".repeat(1200)), entry("夜".repeat(301)), entry("不算".repeat(900), false)] }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  await mountAt("/mine/workshops/w1/edit?section=world");
  expect(document.querySelector("[data-resident-count]")?.textContent).toContain("1,501 / 1,500");
  expect(document.querySelector("[data-resident]")?.classList.contains("is-over")).toBe(true);
  expect(document.querySelector("[data-resident-over]")?.textContent).toBe(t("workshop.editor.resident.over"));

  await router.replace({ query: { section: "publish" } }); await settle();
  expect(document.querySelector("[data-check=constant]")?.getAttribute("data-ok")).toBe("false");
  const submit = button("[data-pub-submit]")!;
  expect(submit.textContent).toContain(t("workshop.publish.action.submit"));
  expect(submit.disabled).toBe(true);
  submit.click(); await settle();
  expect(api.submitWorkshop).not.toHaveBeenCalled();
});

// 九種狀態：主按鈕與狀態字（publishState 用真的）
const STATES: [string, MineStatus, OwnerState, { title: string; submit?: string; withdraw?: boolean; appeal?: boolean; note?: boolean; reason?: boolean }][] = [
  ["draft", "draft", "visible", { title: t("workshop.status.draft"), submit: "workshop.publish.action.submit" }],
  ["review", "pending", "visible", { title: t("workshop.status.inReview"), withdraw: true }],
  ["rejected", "rejected", "visible", { title: t("workshop.status.rejected"), submit: "workshop.publish.action.resubmit", reason: true }],
  ["live", "live", "visible", { title: t("workshop.publish.published.title", { ver: "v3" }) }],
  ["livechg", "live_changed", "visible", { title: t("workshop.publish.dirty.title", { ver: "v3" }), submit: "workshop.publish.action.submitUpdate", note: true }],
  ["liveup", "live_pending", "visible", { title: t("workshop.publish.updateInReview.title", { ver: "v4" }), withdraw: true }],
  ["liverej", "live_rejected", "visible", { title: t("workshop.publish.updateRejected.title", { ver: "v4" }), submit: "workshop.publish.action.resubmit", note: true, reason: true }],
  ["returned", "live", "returned", { title: t("workshop.status.returned"), submit: "workshop.publish.action.resubmit", appeal: true, note: true, reason: true }],
  ["hidden", "live", "hidden", { title: t("workshop.status.hidden"), appeal: true, reason: true }],
];
it.each(STATES)("publish state %s: status text and actions", (state, status, owner, want) => {
  const pubState = publishState(status, owner);
  expect(pubState).toBe(state);
  const published = status === "draft" || status === "pending" || status === "rejected" ? null : { version: 3 };
  const draft = makeDraft({ published, updateNote: "這次加了三條雪夜的條目" });
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(PublishPane, {
    state: pubState, draft, checklist: publishChecklist(draft), rejectNote: "介面規則超出分級", ownerReason: "跟原作設定衝突",
    appeal: null, tried: false, busy: false,
  }) });
  app.use(i18n); app.mount(root);
  expect(root.querySelector("[data-pub-title]")?.textContent).toBe(want.title);
  const submit = root.querySelector<HTMLButtonElement>("[data-pub-submit]");
  if (want.submit) { expect(submit?.textContent).toBe(t(want.submit)); expect(submit?.disabled).toBe(false); }
  else expect(submit).toBeNull();
  expect(Boolean(root.querySelector("[data-pub-withdraw]"))).toBe(Boolean(want.withdraw));
  expect(Boolean(root.querySelector("[data-pub-appeal-btn]"))).toBe(Boolean(want.appeal));
  expect(Boolean(root.querySelector("#ws-update-note"))).toBe(Boolean(want.note));
  const reasons = root.querySelector("[data-pub-reject]") ?? root.querySelector("[data-pub-owner-reason]");
  expect(Boolean(reasons)).toBe(Boolean(want.reason));
  // 每種狀態最多一個主按鈕
  expect(root.querySelectorAll(".btn--primary").length).toBeLessThanOrEqual(1);
});

it("published with changes: an update note under 10 characters cannot be submitted; a valid one saves first, then submits", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ published: { version: 3 }, changedSincePublish: true }));
  // 伺服器的狀態跟著送審走：送出前是有修改，送出後是新版審核中
  api.fetchMyWorkshops.mockImplementation(async () => ({ items: [mineItem(api.submitWorkshop.mock.calls.length ? "live_pending" : "live_changed")] }));
  api.saveDraft.mockResolvedValue({ revision: 4, errors: [] });
  api.submitWorkshop.mockResolvedValue({ status: "live_pending" });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  const submit = () => button("[data-pub-submit]")!;
  expect(submit().textContent).toBe(t("workshop.publish.action.submitUpdate"));
  expect(submit().disabled).toBe(true);
  type(document.querySelector<HTMLTextAreaElement>("#ws-update-note")!, "修了錯字");
  await settle();
  expect(submit().disabled).toBe(true);
  submit().click(); await settle();
  expect(api.submitWorkshop).not.toHaveBeenCalled();

  type(document.querySelector<HTMLTextAreaElement>("#ws-update-note")!, "新增三條雪夜的世界書條目");
  await settle();
  expect(submit().disabled).toBe(false);
  submit().click(); await settle();
  expect(api.saveDraft).toHaveBeenCalledTimes(1);
  expect(api.saveDraft.mock.calls[0][1]).toBe(3);
  expect(api.saveDraft.mock.calls[0][3].updateNote).toBe("新增三條雪夜的世界書條目");
  expect(api.submitWorkshop).toHaveBeenCalledWith("w1", "新增三條雪夜的世界書條目", "tok");
  expect(document.querySelector("[data-pub-title]")?.textContent).toBe(t("workshop.publish.updateInReview.title", { ver: "v4" }));
});

it("hidden by the card author: no submit button, the reason stays visible, and an appeal replaces the appeal button with a pending chip", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ published: { version: 3 } }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("live", { ownerState: "hidden", ownerReason: "跟原作設定衝突" })] });
  dialogs.confirmForm.mockResolvedValue({ text: "設定都有出處" });
  api.appealWorkshop.mockResolvedValue({ appeal: "pending" });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(document.querySelector("[data-pub-title]")?.textContent).toBe(t("workshop.status.hidden"));
  expect(button("[data-pub-submit]")).toBeNull();
  expect(document.querySelector("[data-pub-owner-reason]")?.textContent).toBe(t("workshop.publish.ownerReason", { reason: "跟原作設定衝突" }));
  button("[data-pub-appeal-btn]")!.click(); await settle();
  expect(dialogs.confirmForm.mock.calls[0][0].field.required).toBe(true);
  expect(api.appealWorkshop).toHaveBeenCalledWith("w1", "設定都有出處", "tok");
  expect(button("[data-pub-appeal-btn]")).toBeNull();
  expect(document.querySelector("[data-pub-appeal]")?.textContent).toBe(t("workshop.status.appeal"));
  expect(document.body.textContent).toContain(t("workshop.publish.appeal.pending"));
});

it("draft_stale keeps the edits, stops saving, and reloads only when asked", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft());
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  api.saveDraft.mockRejectedValue(new ApiError(409, "stale", "draft_stale"));
  await mountAt("/mine/workshops/w1/edit?section=basic");
  const name = document.querySelector<HTMLInputElement>("#ws-name")!;
  type(name, "雪夜篇・改");
  await settle();
  button("[data-save]")!.click(); await settle();
  expect(api.saveDraft).toHaveBeenCalledTimes(1);
  expect(document.querySelector("[data-stale]")?.textContent).toContain(t("workshop.editor.stale"));
  expect(document.querySelector<HTMLInputElement>("#ws-name")!.value).toBe("雪夜篇・改");
  expect(button("[data-save]")!.disabled).toBe(true);
  expect(api.fetchDraft).toHaveBeenCalledTimes(1);
  // 鍵盤存檔也不再送
  window.dispatchEvent(new KeyboardEvent("keydown", { key: "s", ctrlKey: true })); await settle();
  expect(api.saveDraft).toHaveBeenCalledTimes(1);
  // 作者自己按重新載入才換成伺服器那份
  api.fetchDraft.mockResolvedValue(makeDraft({ name: "別處改的名字", revision: 5 }));
  [...document.querySelectorAll<HTMLButtonElement>("[data-stale] button")][0].click(); await settle();
  expect(api.fetchDraft).toHaveBeenCalledTimes(2);
  expect(document.querySelector<HTMLInputElement>("#ws-name")!.value).toBe("別處改的名字");
  expect(document.querySelector("[data-stale]")).toBeNull();
});

it("new: creates for the card, moves to the edit URL, and the leave guard still asks about unsaved edits", async () => {
  api.fetchWorkshopCards.mockResolvedValue({ items: [{ cardId: "100001", num: 100001, name: "雪國", author: { name: "原作者" }, roleId: "r1", allowNew: true }] });
  api.createWorkshop.mockResolvedValue({ workshopId: "w1" });
  api.fetchDraft.mockResolvedValue(makeDraft({ name: "" }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [] });
  dialogs.confirmDialog.mockResolvedValue(false);
  await mountAt("/mine/workshops/new?card=100001");
  await until(() => Boolean(document.querySelector("#ws-name")));
  expect(api.createWorkshop).toHaveBeenCalledTimes(1);
  expect(api.createWorkshop).toHaveBeenCalledWith("r1", "tok");
  expect(router.currentRoute.value.path).toBe("/mine/workshops/w1/edit");
  expect(document.querySelector("[data-for-card]")?.textContent).toContain(t("workshop.editor.forChip", { card: "雪國" }));
  type(document.querySelector<HTMLInputElement>("#ws-name")!, "雪夜篇");
  await settle();
  await router.push("/mine"); await settle();
  expect(dialogs.confirmDialog).toHaveBeenCalledTimes(1);
  expect(router.currentRoute.value.path).toBe("/mine/workshops/w1/edit");
});

it("new: a card closed to extensions explains why and links back to the card", async () => {
  api.fetchWorkshopCards.mockResolvedValue({ items: [] });
  api.createWorkshop.mockRejectedValue(new ApiError(403, "closed", "workshop_closed"));
  cards.fetchCard.mockResolvedValue({ id: "100002", num: 100002, roleId: "r2", name: "x" });
  await mountAt("/mine/workshops/new?card=100002");
  await until(() => Boolean(document.querySelector("[data-closed]")));
  expect(document.querySelector("[data-closed]")?.textContent).toContain(t("workshop.mine.pick.closed"));
  expect(api.createWorkshop).toHaveBeenCalledWith("r2", "tok");
  expect(document.querySelector<HTMLAnchorElement>("[data-closed] a")?.getAttribute("href")).toBe("/cards/100002");
});

it("trial: options use the base opening, welcome and alt-<n>, and starting marks the checklist", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft());
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  button("[data-trial-open]")!.click(); await settle();
  const keys = [...document.querySelectorAll<HTMLInputElement>("[data-trial-option]")].map((i) => i.value);
  expect(keys).toEqual(["base", "welcome", "alt-1"]);
  document.querySelector<HTMLInputElement>("[data-trial-option=alt-1]")!.click(); await settle();
  const start = document.querySelector<HTMLAnchorElement>("[data-trial-start]")!;
  expect(start.getAttribute("href")).toBe("/play/100001?wsTrial=w1&wsOpening=alt-1");
  expect(start.target).toBe("_blank");
  start.addEventListener("click", (e) => e.preventDefault());
  start.click(); await settle();
  expect(document.querySelector("[data-trial-start]")).toBeNull();
  expect(document.querySelector("[data-check=tried]")?.classList.contains("ok")).toBe(true);
});

it("published: editing makes it submittable as a new version, and it stays so after saving even if the list still says live", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ published: { version: 3 } }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("live")] });
  api.saveDraft.mockResolvedValue({ revision: 4, errors: [] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(button("[data-pub-submit]")).toBeNull();
  await router.replace({ query: { section: "basic" } }); await settle();
  type(document.querySelector<HTMLInputElement>("#ws-name")!, "雪夜篇二");
  await router.replace({ query: { section: "publish" } }); await settle();
  expect(button("[data-pub-submit]")?.textContent).toBe(t("workshop.publish.action.submitUpdate"));
  expect(document.querySelector("#ws-update-note")).not.toBeNull();
  button("[data-save]")!.click(); await settle();
  expect(api.saveDraft).toHaveBeenCalledTimes(1);
  expect(button("[data-pub-submit]")?.textContent).toBe(t("workshop.publish.action.submitUpdate"));
});

it("a name over 16 characters leaves the basics unchecked and blocks submission", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ name: "雪".repeat(17) }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(document.querySelector("[data-check=basics]")?.getAttribute("data-ok")).toBe("false");
  expect(button("[data-pub-submit]")!.disabled).toBe(true);
});

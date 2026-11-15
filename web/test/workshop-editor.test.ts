import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, type App } from "vue";
import { RouterView, createMemoryHistory, createRouter, type Router } from "vue-router";
import { i18n } from "../src/lib/i18n";
import { ApiError } from "../src/lib/api";
import type { MineItem, MineStatus, WorkshopDraft } from "../src/lib/workshop";

const api = vi.hoisted(() => ({
  fetchDraft: vi.fn(), saveDraft: vi.fn(), fetchMyWorkshops: vi.fn(), publishWorkshop: vi.fn(), unpublishWorkshop: vi.fn(),
  discardWorkshopChanges: vi.fn(), deleteWorkshop: vi.fn(), createWorkshop: vi.fn(), fetchWorkshopCards: vi.fn(),
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
    workshopId: "w1", revision: 3, kind: "dlc",
    card: { roleId: "r1", cardId: "100001", num: 100001, name: "雪國", ownerIsMe: true },
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
  version: 3, updatedAt: 0, kinds: ["lore"], rating: "G", adult: false, kind: "dlc",
  card: { id: "100001", num: 100001, name: "雪國", roleId: "r1" },
  status, ownerState: "visible", workshopClosed: false, ...over,
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

it("blocks publishing while resident lore is over the 1,500-character limit", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ worldbook: [entry("雪".repeat(1200)), entry("夜".repeat(301)), entry("不算".repeat(900), false)] }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  await mountAt("/mine/workshops/w1/edit?section=world");
  expect(document.querySelector("[data-resident-count]")?.textContent).toContain("1,501 / 1,500");
  expect(document.querySelector("[data-resident]")?.classList.contains("is-over")).toBe(true);

  await router.replace({ query: { section: "publish" } }); await settle();
  expect(document.querySelector("[data-check=constant]")?.getAttribute("data-ok")).toBe("false");
  const publish = button("[data-pub-publish]")!;
  expect(publish.textContent?.trim()).toBe(t("workshop.publish.action.publish"));
  expect(publish.disabled).toBe(true);
  publish.click(); await settle();
  expect(api.publishWorkshop).not.toHaveBeenCalled();
});

// 三種狀態：主按鈕與狀態字（publishState 用真的）
const STATES: [string, MineStatus, { publish?: string; unpublish?: boolean; discard?: boolean; note?: boolean; changed?: boolean }][] = [
  ["draft", "draft", { publish: "workshop.publish.action.publish" }],
  ["live", "live", { unpublish: true }],
  ["livechg", "live_changed", { publish: "workshop.publish.action.publishUpdate", discard: true, note: true, changed: true }],
];
it.each(STATES)("publish state %s: status text and actions", (state, status, want) => {
  const pubState = publishState(status);
  expect(pubState).toBe(state);
  const published = status === "draft" ? null : { version: 3 };
  const draft = makeDraft({ published });
  const root = document.createElement("div"); document.body.append(root);
  app = createApp({ render: () => h(PublishPane, {
    state: pubState, kind: "dlc", draft, checklist: publishChecklist(draft), ownerState: "visible", workshopClosed: false, busy: false,
  }) });
  app.use(i18n); app.mount(root);
  expect(root.querySelector("[data-pub-title]")?.textContent?.trim()).toBe(state === "draft" ? t("workshop.status.draft") : `${t("workshop.status.published")} · v3`);
  const publish = root.querySelector<HTMLButtonElement>("[data-pub-publish]");
  if (want.publish) { expect(publish?.textContent?.trim()).toBe(t(want.publish)); expect(publish?.disabled).toBe(false); }
  else expect(publish).toBeNull();
  expect(Boolean(root.querySelector("[data-pub-unpublish]"))).toBe(Boolean(want.unpublish));
  expect(Boolean(root.querySelector("[data-pub-discard]"))).toBe(Boolean(want.discard));
  expect(Boolean(root.querySelector("#ws-update-note"))).toBe(Boolean(want.note));
  expect(Boolean(root.querySelector("[data-pub-changed]"))).toBe(Boolean(want.changed));
  // 沒有審核、申訴的殘留
  expect(root.textContent).not.toMatch(/審核|申訴|分潤/);
  expect(root.querySelectorAll(".btn--primary").length).toBeLessThanOrEqual(1);
});

it("draft: publishing saves pending edits first, then publishes with the saved revision and a fresh operation id", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft());
  api.fetchMyWorkshops.mockImplementation(async () => ({ items: [mineItem(api.publishWorkshop.mock.calls.length ? "live" : "draft")] }));
  api.saveDraft.mockResolvedValue({ revision: 4, errors: [] });
  api.publishWorkshop.mockResolvedValue({ workshopId: "w1", releaseId: "rel1", status: "published", kind: "dlc", version: 1 });
  await mountAt("/mine/workshops/w1/edit?section=basic");
  type(document.querySelector<HTMLInputElement>("#ws-name")!, "雪夜篇・改");
  await router.replace({ query: { section: "publish" } }); await settle();
  button("[data-pub-publish]")!.click(); await settle();
  expect(api.saveDraft).toHaveBeenCalledTimes(1);
  expect(api.publishWorkshop).toHaveBeenCalledTimes(1);
  const [id, body] = api.publishWorkshop.mock.calls[0];
  expect(id).toBe("w1");
  expect(body.expectedRevision).toBe(4);
  expect(typeof body.operationId).toBe("string");
  expect(document.querySelector("[data-pub-title]")?.textContent?.trim()).toBe(`${t("workshop.status.published")} · v1`);
  expect(button("[data-pub-unpublish]")).not.toBeNull();
});

it("a failed publish retried for the same draft revision reuses the operation id", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft());
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  api.publishWorkshop.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ workshopId: "w1", releaseId: "rel1", status: "published", kind: "dlc", version: 1 });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  button("[data-pub-publish]")!.click(); await settle();
  expect(document.querySelector("[data-error]")?.textContent).toBe("network");
  button("[data-pub-publish]")!.click(); await settle();
  expect(api.publishWorkshop).toHaveBeenCalledTimes(2);
  expect(api.publishWorkshop.mock.calls[1][1].operationId).toBe(api.publishWorkshop.mock.calls[0][1].operationId);
});

it("published: unpublish asks first and moves back to draft", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ published: { version: 3 } }));
  api.fetchMyWorkshops.mockImplementation(async () => ({ items: [mineItem(api.unpublishWorkshop.mock.calls.length ? "draft" : "live")] }));
  api.unpublishWorkshop.mockResolvedValue({ workshopId: "w1", status: "draft", draftRevision: 4 });
  dialogs.confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
  await mountAt("/mine/workshops/w1/edit?section=publish");
  button("[data-pub-unpublish]")!.click(); await settle();
  expect(api.unpublishWorkshop).not.toHaveBeenCalled();
  expect(dialogs.confirmDialog.mock.calls[0][0].message).toBe(t("workshop.unpublish.body"));
  button("[data-pub-unpublish]")!.click(); await settle();
  expect(api.unpublishWorkshop).toHaveBeenCalledWith("w1", expect.objectContaining({ expectedRevision: 3 }), "tok");
  expect(document.querySelector("[data-pub-title]")?.textContent?.trim()).toBe(t("workshop.status.draft"));
});

it("published with edits: the update note is optional, and discard restores the published draft", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ published: { version: 3 }, changedSincePublish: true, name: "雪夜篇改" }));
  api.fetchMyWorkshops.mockImplementation(async () => ({ items: [mineItem(api.discardWorkshopChanges.mock.calls.length ? "live" : "live_changed")] }));
  api.discardWorkshopChanges.mockResolvedValue(makeDraft({ published: { version: 3 }, revision: 5, name: "雪夜篇" }));
  dialogs.confirmDialog.mockResolvedValue(true);
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(button("[data-pub-publish]")?.textContent?.trim()).toBe(t("workshop.publish.action.publishUpdate"));
  expect(button("[data-pub-publish]")!.disabled).toBe(false);
  button("[data-pub-discard]")!.click(); await settle();
  expect(api.discardWorkshopChanges).toHaveBeenCalledWith("w1", expect.objectContaining({ expectedRevision: 3 }), "tok");
  expect(button("[data-pub-unpublish]")).not.toBeNull();
  await router.replace({ query: { section: "basic" } }); await settle();
  expect(document.querySelector<HTMLInputElement>("#ws-name")!.value).toBe("雪夜篇");
});

it("player extension: only basics, lorebook and publish; saving never sends regex or openings", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ kind: "lorebook", card: { roleId: "r1", cardId: "100001", num: 100001, name: "雪國", ownerIsMe: false } }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft", { kind: "lorebook" })] });
  api.saveDraft.mockResolvedValue({ revision: 4, errors: [] });
  await mountAt("/mine/workshops/w1/edit?section=regex");
  const tabs = [...document.querySelectorAll<HTMLElement>("[data-section-tab]")].map((el) => el.dataset.sectionTab);
  expect(tabs).toEqual(["basic", "world", "publish"]);
  // 舊連結指到正則：落回基本資料，不畫正則與開局
  expect(document.querySelector("[data-section=basic]")).not.toBeNull();
  expect(document.querySelector("[data-section=regex]")).toBeNull();
  expect(document.querySelector("[data-layer-chip]")?.textContent).toBe(t("workshop.layer.extChip"));
  type(document.querySelector<HTMLInputElement>("#ws-name")!, "雪夜篇・玩家");
  await settle();
  button("[data-save]")!.click(); await settle();
  const payload = api.saveDraft.mock.calls[0][3];
  expect(payload).not.toHaveProperty("rules");
  expect(payload).not.toHaveProperty("opening");
  await router.replace({ query: { section: "publish" } }); await settle();
  expect(document.querySelector("[data-check=content]")?.textContent?.trim()).toBe(t("workshop.publish.check.contentLore"));
  expect(document.body.textContent).not.toContain(t("workshop.editor.section.regex"));
});

it("player extension hidden by the card author, or a closed card workshop: a chip and a line, no appeal", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ kind: "lorebook", published: { version: 3 }, card: { roleId: "r1", cardId: "100001", num: 100001, name: "雪國", ownerIsMe: false } }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("live", { kind: "lorebook", ownerState: "hidden", workshopClosed: true })] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(document.querySelector("[data-pub-hidden]")?.textContent).toBe(t("workshop.status.hiddenByOwner"));
  expect(document.querySelector("[data-pub-hidden-note]")?.textContent).toBe(t("workshop.mine.row.hiddenByOwner"));
  expect(document.querySelector("[data-pub-closed]")?.textContent).toBe(t("workshop.status.cardWorkshopClosed"));
  expect(button("[data-pub-unpublish]")).not.toBeNull();
});

it("publishing into a closed workshop explains it and keeps the draft", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ kind: "lorebook", card: { roleId: "r1", cardId: "100001", num: 100001, name: "雪國", ownerIsMe: false } }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft", { kind: "lorebook" })] });
  api.publishWorkshop.mockRejectedValue(new ApiError(409, "closed", "workshop_closed"));
  await mountAt("/mine/workshops/w1/edit?section=publish");
  button("[data-pub-publish]")!.click(); await settle();
  expect(document.querySelector("[data-error]")?.textContent).toBe(t("workshop.editor.error.workshopClosed"));
  expect(button("[data-pub-publish]")).toBeNull();
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

it("trial: a DLC offers the base opening, welcome and alt-<n>; a player extension only the base opening", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft());
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  button("[data-trial-open]")!.click(); await settle();
  const keys = () => [...document.querySelectorAll<HTMLInputElement>("[data-trial-option]")].map((i) => i.value);
  expect(keys()).toEqual(["base", "welcome", "alt-1"]);
  document.querySelector<HTMLInputElement>("[data-trial-option=alt-1]")!.click(); await settle();
  const start = document.querySelector<HTMLAnchorElement>("[data-trial-start]")!;
  expect(start.getAttribute("href")).toBe("/play/100001?wsTrial=w1&wsOpening=alt-1");
  expect(start.target).toBe("_blank");
  start.addEventListener("click", (e) => e.preventDefault());
  start.click(); await settle();
  expect(document.querySelector("[data-trial-start]")).toBeNull();
  app?.unmount(); app = undefined; document.body.innerHTML = "";
  api.fetchDraft.mockResolvedValue(makeDraft({ kind: "lorebook" }));
  await mountAt("/mine/workshops/w1/edit?section=publish");
  button("[data-trial-open]")!.click(); await settle();
  expect(keys()).toEqual(["base"]);
});

it("published: editing makes it publishable as an update, and it stays so after saving even if the list still says live", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ published: { version: 3 } }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("live")] });
  api.saveDraft.mockResolvedValue({ revision: 4, errors: [] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(button("[data-pub-publish]")).toBeNull();
  await router.replace({ query: { section: "basic" } }); await settle();
  type(document.querySelector<HTMLInputElement>("#ws-name")!, "雪夜篇二");
  await router.replace({ query: { section: "publish" } }); await settle();
  expect(button("[data-pub-publish]")?.textContent?.trim()).toBe(t("workshop.publish.action.publishUpdate"));
  expect(document.querySelector("#ws-update-note")).not.toBeNull();
  button("[data-save]")!.click(); await settle();
  expect(api.saveDraft).toHaveBeenCalledTimes(1);
  expect(button("[data-pub-publish]")?.textContent?.trim()).toBe(t("workshop.publish.action.publishUpdate"));
});

it("a name over 16 characters leaves the basics unchecked and blocks publishing", async () => {
  api.fetchDraft.mockResolvedValue(makeDraft({ name: "雪".repeat(17) }));
  api.fetchMyWorkshops.mockResolvedValue({ items: [mineItem("draft")] });
  await mountAt("/mine/workshops/w1/edit?section=publish");
  expect(document.querySelector("[data-check=basics]")?.getAttribute("data-ok")).toBe("false");
  expect(button("[data-pub-publish]")!.disabled).toBe(true);
});

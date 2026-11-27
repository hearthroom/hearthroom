import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { applyLocale, i18n } from "../src/lib/i18n";
import { siteLinksKey } from "../src/lib/site-links";
import { ApiError } from "../src/lib/api";

const tracked = vi.hoisted(() => [] as { event: string; data: Record<string, unknown> }[]);
vi.mock("../src/lib/track", () => ({
  track: (event: string, data: Record<string, unknown> = {}) => tracked.push({ event, data }),
  currentSurface: () => "test",
  setSurface: () => {},
}));

const sessionMock = vi.hoisted(() => ({
  me: { accountNumId: 22, nickName: "Author", avatar: "" } as { accountNumId: number; nickName: string; avatar: string } | null,
  profile: { identities: [{ provider: "harbor", externalId: 22 }] } as { identities: Array<{ provider: string; externalId: number }> } | null,
  ready: true,
  accessToken: vi.fn(async () => "tok-author"),
}));
vi.mock("../src/lib/session", () => ({ useSession: () => sessionMock }));

const apiMocks = vi.hoisted(() => ({
  fetchMyCards: vi.fn(),
  fetchDraftState: vi.fn(),
  registerCard: vi.fn(),
  fetchRatingDraft: vi.fn(),
  saveRatingDraft: vi.fn(),
  fetchRewardProgress: vi.fn(),
  communityRequest: vi.fn(),
  accountToken: vi.fn(),
  confirm: vi.fn(),
  ask: vi.fn(),
  readVisibility: vi.fn(),
}));

vi.mock("../src/lib/api", async (original) => ({
  ...(await original<typeof import("../src/lib/api")>()),
  fetchMyCards: apiMocks.fetchMyCards,
  fetchDraftState: apiMocks.fetchDraftState,
  registerCard: apiMocks.registerCard,
  fetchRatingDraft: apiMocks.fetchRatingDraft,
  saveRatingDraft: apiMocks.saveRatingDraft,
}));
vi.mock("../src/lib/campaign", async (original) => ({
  ...(await original<typeof import("../src/lib/campaign")>()),
  fetchRewardProgress: apiMocks.fetchRewardProgress,
}));
vi.mock("../src/lib/community", async (original) => ({
  ...(await original<typeof import("../src/lib/community")>()),
  communityRequest: apiMocks.communityRequest,
}));
vi.mock("../src/lib/connections", async (original) => ({
  ...(await original<typeof import("../src/lib/connections")>()),
  accountToken: apiMocks.accountToken,
}));
vi.mock("../src/lib/confirm", () => ({
  confirmDialog: apiMocks.confirm,
  confirmForm: apiMocks.confirm,
  confirmPublication: apiMocks.confirm,
}));
vi.mock("../src/lib/rating", async (original) => ({
  ...(await original<typeof import("../src/lib/rating")>()),
  askRating: apiMocks.ask,
}));
vi.mock("../src/lib/work-visibility", async (original) => ({
  ...(await original<typeof import("../src/lib/work-visibility")>()),
  fetchWorkVisibility: apiMocks.readVisibility,
}));
vi.mock("../src/lib/work-visibility-capability", async () => {
  const { ref: vref } = await import("vue");
  return { useWorkVisibilityCapability: () => vref(true) };
});
vi.mock("../src/lib/share-ref", async (original) => ({
  ...(await original<typeof import("../src/lib/share-ref")>()),
  currentReferralCode: async () => null,
  ownReferralCode: async () => null,
}));

import QuotaDeviceHelp from "../src/components/QuotaDeviceHelp.vue";
import CreatorSeason from "../src/components/CreatorSeason.vue";
import AuthorVisibility from "../src/components/AuthorVisibility.vue";
import VisibilityPicker from "../src/components/VisibilityPicker.vue";
import CardOwnerActions from "../src/components/CardOwnerActions.vue";
import MyCardsPage from "../src/pages/MyCardsPage.vue";
import { lastShown } from "../src/lib/mine-memory";
import type { CardRewardCampaign } from "../src/lib/campaign";

let app: App | null = null;
let root: HTMLElement | null = null;
const settle = async () => {
  for (let i = 0; i < 12; i++) {
    await Promise.resolve();
    await nextTick();
  }
};

const EFFECTIVE_AT = Date.UTC(2026, 10, 30, 0, 0, 0);
const baseCampaign = (extra: Partial<CardRewardCampaign> = {}): CardRewardCampaign => ({
  kind: "card_reward",
  slug: "creator-season",
  title: { "zh-Hant": "創作季" },
  phase: "open",
  startsAt: Date.UTC(2026, 10, 1),
  endsAt: Date.UTC(2026, 11, 15),
  timezone: "Asia/Taipei",
  bannerUrl: null,
  intro: { "zh-Hant": "" },
  reward: 3000,
  weeklyLimit: 6,
  normalWeeklyLimit: 3,
  deviceCapEffectiveAt: EFFECTIVE_AT,
  ...extra,
});

const baseQuota = (extra: Record<string, unknown> = {}) => ({
  used: 4,
  limit: 6,
  weekStart: Date.UTC(2026, 10, 30, 0, 0, 0),
  weekEnd: Date.UTC(2026, 11, 7, 0, 0, 0),
  packRemaining: 0,
  ...extra,
});

const baseVisibility = {
  access: "private",
  effectiveAccess: "owner",
  review: "none",
  update: "none",
  everPublic: false,
  revisionState: "unknown",
  restorable: false,
  restoreReason: "no_approval",
  draftChanged: false,
  restriction: "none",
  policyRevision: "1",
  approvalRevision: "0",
  actions: ["set_private", "set_unlisted", "submit_review"],
  syncState: "complete",
} as any;

beforeEach(async () => {
  vi.clearAllMocks();
  tracked.length = 0;
  lastShown.clear();
  await applyLocale("zh-Hant");
  sessionMock.me = { accountNumId: 22, nickName: "Author", avatar: "" };
  sessionMock.profile = { identities: [{ provider: "harbor", externalId: 22 }] };
  sessionMock.ready = true;
  apiMocks.accountToken.mockResolvedValue("tok-author");
  apiMocks.communityRequest.mockResolvedValue({ invite: "https://discord.gg/hearthroom" });
  apiMocks.fetchRatingDraft.mockResolvedValue({ answers: { version: 1, topics: { romance: "romance.dating" }, other: "other.none" }, ratingFloor: null });
  apiMocks.ask.mockImplementation(async (a: unknown) => a);
  apiMocks.saveRatingDraft.mockResolvedValue(undefined);
  apiMocks.confirm.mockImplementation(async (opts: any) => {
    await opts.onConfirm?.({ text: "", update: { updateKind: "minor", updateNote: "" } });
    return true;
  });
  apiMocks.readVisibility.mockResolvedValue({ workVisibility: baseVisibility });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "Content-Type": "application/json" } })));
});

afterEach(() => {
  app?.unmount();
  app = null;
  root?.remove();
  root = null;
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
});

async function mountWithRouter(
  render: () => ReturnType<typeof h>,
  options: { discordInvite?: string | null; provideSiteLinks?: boolean; path?: string } = {},
) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }],
  });
  await router.push(options.path ?? "/");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render }).use(pinia).use(i18n).use(router);
  if (options.provideSiteLinks !== false) {
    app.provide(siteLinksKey, ref({ discordInvite: options.discordInvite === undefined ? "https://discord.gg/hearthroom" : options.discordInvite }));
  }
  app.mount(root);
  await settle();
}

it("QuotaDeviceHelp uses siteLinks invite, tracks CTA click, falls back to /community/config, and hides when absent", async () => {
  await mountWithRouter(() => h(QuotaDeviceHelp, { align: "center" }));
  const link = root!.querySelector<HTMLAnchorElement>("[data-quota-device-help]")!;
  expect(link).not.toBeNull();
  expect(link.getAttribute("href")).toBe("https://discord.gg/hearthroom");
  expect(link.getAttribute("target")).toBe("_blank");
  expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  expect(link.classList.contains("quota-device-help--center")).toBe(true);
  link.addEventListener("click", (e) => e.preventDefault());
  link.click();
  expect(tracked).toContainEqual({ event: "cta", data: { detail: "discord", subject: "quota-device" } });

  app!.unmount();
  root!.remove();
  await mountWithRouter(() => h(QuotaDeviceHelp), { discordInvite: null });
  expect(root!.querySelector("[data-quota-device-help]")).toBeNull();

  app!.unmount();
  root!.remove();
  apiMocks.communityRequest.mockResolvedValueOnce({ invite: "https://discord.gg/fallback" });
  await mountWithRouter(() => h(QuotaDeviceHelp), { provideSiteLinks: false });
  expect(root!.querySelector<HTMLAnchorElement>("[data-quota-device-help]")?.getAttribute("href")).toBe("https://discord.gg/fallback");
});

it("CreatorSeason renders states 1-4 for deviceCapEffectiveAt and deviceShared, and hides them when absent or ended", async () => {
  apiMocks.fetchRewardProgress.mockResolvedValue({
    quota: baseQuota({ used: 6, limit: 6, deviceShared: true }),
    approvedCount: 1,
    pendingCount: 0,
    creditsPaid: 3000,
    items: [],
  });
  await mountWithRouter(() => h(CreatorSeason, { campaign: baseCampaign(), loginTo: "/login" }));
  // State 1: rule row as 2nd item in creator__list
  const listItems = [...root!.querySelectorAll(".creator__list > li")];
  expect(listItems[1]?.hasAttribute("data-rule-device-cap")).toBe(true);
  expect(listItems[1]?.textContent).toContain("11月30日");
  // State 2: 6th note and count 6
  expect(root!.querySelector("[data-note-device-cap]")?.textContent).toBe(i18n.global.t("creator.notes.6"));
  expect(root!.querySelector("[data-notes] summary")?.textContent).toContain(i18n.global.t("campaign.page.notes.count", { n: 6 }));
  // State 3: progress deviceShared note
  expect(root!.querySelector("[data-device-shared]")?.textContent).toContain(i18n.global.t("creator.mine.deviceShared"));
  // State 4: quotaFullDevice + centered help link
  expect(root!.querySelector("[data-quota-full]")?.textContent).toContain("這台裝置本週額度已用完");
  expect(root!.querySelector("[data-quota-device-help]")?.classList.contains("quota-device-help--center")).toBe(true);

  // When deviceCapEffectiveAt is null and deviceShared is false -> ordinary behavior
  app!.unmount();
  root!.remove();
  apiMocks.fetchRewardProgress.mockResolvedValue({
    quota: baseQuota({ used: 6, limit: 6, deviceShared: false }),
    approvedCount: 1,
    pendingCount: 0,
    creditsPaid: 3000,
    items: [],
  });
  await mountWithRouter(() => h(CreatorSeason, { campaign: baseCampaign({ deviceCapEffectiveAt: null }), loginTo: "/login" }));
  expect(root!.querySelector("[data-rule-device-cap]")).toBeNull();
  expect(root!.querySelector("[data-note-device-cap]")).toBeNull();
  expect(root!.querySelector("[data-notes] summary")?.textContent).toContain(i18n.global.t("campaign.page.notes.count", { n: 5 }));
  expect(root!.querySelector("[data-device-shared]")).toBeNull();
  expect(root!.querySelector("[data-quota-full]")?.textContent).toContain("本週額度已用完");
  expect(root!.querySelector("[data-quota-full]")?.textContent).not.toContain("這台裝置");
  expect(root!.querySelector("[data-quota-device-help]")).toBeNull();

  // When campaign ended -> hides rule row, 6th note, and progress shared note
  app!.unmount();
  root!.remove();
  apiMocks.fetchRewardProgress.mockResolvedValue({
    quota: baseQuota({ used: 6, limit: 6, deviceShared: true }),
    approvedCount: 1,
    pendingCount: 0,
    creditsPaid: 3000,
    items: [],
  });
  await mountWithRouter(() => h(CreatorSeason, { campaign: baseCampaign({ phase: "ended" }), loginTo: "/login" }));
  expect(root!.querySelector("[data-rule-device-cap]")).toBeNull();
  expect(root!.querySelector("[data-note-device-cap]")).toBeNull();
  expect(root!.querySelector("[data-device-shared]")).toBeNull();
});

it("MyCardsPage renders State 5 deviceShared segment between reset and packs only when deviceShared is true", async () => {
  apiMocks.fetchMyCards.mockResolvedValue({
    items: [],
    total: 0,
    quota: baseQuota({ used: 4, limit: 6, packRemaining: 2, deviceShared: true }),
  });
  await mountWithRouter(() => h(MyCardsPage), { path: "/mine" });
  const quotaEl = root!.querySelector(".quota")!;
  const children = [...quotaEl.children];
  const resetIdx = children.findIndex((el) => el.classList.contains("quota__reset"));
  const sharedIdx = children.findIndex((el) => el.hasAttribute("data-quota-shared"));
  const packsIdx = children.findIndex((el) => el.hasAttribute("data-quota-packs"));
  expect(sharedIdx).toBeGreaterThan(resetIdx);
  expect(packsIdx).toBeGreaterThan(sharedIdx);
  expect(children[sharedIdx]?.textContent).toBe(i18n.global.t("mine.quota.deviceShared"));

  app!.unmount();
  root!.remove();
  lastShown.clear();
  apiMocks.fetchMyCards.mockResolvedValue({
    items: [],
    total: 0,
    quota: baseQuota({ used: 4, limit: 6, packRemaining: 2 }),
  });
  await mountWithRouter(() => h(MyCardsPage), { path: "/mine" });
  expect(root!.querySelector("[data-quota-shared]")).toBeNull();
});

it("VisibilityPicker shows State 6 exceededDevice and places QuotaDeviceHelp outside disabled radiogroup", async () => {
  await mountWithRouter(() => h(VisibilityPicker, { value: baseVisibility, phase: "ready", quotaFull: true, quotaShared: true }));
  const publicLabel = root!.querySelector<HTMLInputElement>('input[value="public"]')!.closest("label")!;
  expect(publicLabel.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
  const help = root!.querySelector("[data-quota-device-help]")!;
  expect(help).not.toBeNull();
  expect(help.closest("label")).toBeNull();
  expect(help.closest('[role="radiogroup"]')).toBeNull();

  // Not shared -> keeps normal exceeded message and no help link
  app!.unmount();
  root!.remove();
  await mountWithRouter(() => h(VisibilityPicker, { value: baseVisibility, phase: "ready", quotaFull: true, quotaShared: false }));
  expect(root!.textContent).toContain(i18n.global.t("mine.quota.exceeded"));
  expect(root!.querySelector("[data-quota-device-help]")).toBeNull();

  // Higher-priority dirty blocker suppresses quota reason and help link
  app!.unmount();
  root!.remove();
  await mountWithRouter(() => h(VisibilityPicker, { value: baseVisibility, phase: "ready", dirty: true, quotaFull: true, quotaShared: true }));
  expect(root!.querySelector("[data-quota-device-help]")).toBeNull();
});

it("AuthorVisibility reads quota via fetchMyCards when quotaFull/quotaShared props are omitted and renders State 6", async () => {
  apiMocks.fetchMyCards.mockResolvedValue({
    items: [],
    total: 0,
    quota: baseQuota({ used: 6, limit: 6, packRemaining: 0, deviceShared: true }),
  });
  await mountWithRouter(() =>
    h(AuthorVisibility, {
      id: "draft-1",
      provider: "harbor",
      actor: "22",
      name: "Synthetic Card",
      token: async () => "tok-author",
      inline: true,
      editor: true,
    }),
  );
  expect(apiMocks.fetchMyCards).toHaveBeenCalled();
  expect(root!.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
  const help = root!.querySelector("[data-quota-device-help]")!;
  expect(help).not.toBeNull();
  expect(help.closest('[role="radiogroup"]')).toBeNull();
});

it("MyCardsPage can resubmit a rejected card on the same exhausted account that blocks a new card", async () => {
  const rejected = { ...baseVisibility, review: "rejected", reviewNote: "Please revise the opening." };
  const card = { provider: "harbor", zone: "all", summary: "", avatarUrl: null, visibility: "private", talkNum: 0 };
  apiMocks.fetchMyCards.mockResolvedValue({
    items: [
      { ...card, roleId: "rejected", name: "Returned card", registered: true, status: "rejected", workVisibility: rejected },
      { ...card, roleId: "new", name: "New card", registered: false, workVisibility: baseVisibility },
    ],
    total: 2,
    quota: baseQuota({ used: 6, limit: 6, packRemaining: 0, deviceShared: true }),
  });
  apiMocks.readVisibility.mockImplementation(async (id: string) => ({ workVisibility: id === "rejected" ? rejected : baseVisibility }));
  await mountWithRouter(() => h(MyCardsPage), { path: "/mine" });

  async function openVisibility(name: string) {
    const tile = [...root!.querySelectorAll("article")].find((item) => item.querySelector("h3")?.textContent === name)!;
    tile.querySelector<HTMLButtonElement>('[aria-haspopup="menu"]')!.click();
    await nextTick();
    tile.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click();
    await settle();
    return document.querySelector<HTMLElement>(".visibility-dialog")!;
  }

  const fresh = await openVisibility("New card");
  expect(fresh.querySelector<HTMLInputElement>('input[value="public"]')!.disabled).toBe(true);
  expect(fresh.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
  fresh.querySelector<HTMLButtonElement>("header button")!.click();
  await nextTick();

  const retry = await openVisibility("Returned card");
  const option = retry.querySelector<HTMLInputElement>('input[value="public"]')!;
  expect(option.disabled).toBe(false);
  expect(retry.textContent).not.toContain(i18n.global.t("mine.quota.exceededDevice"));
  expect(retry.querySelector("[data-quota-device-help]")).toBeNull();
  option.click();
  await nextTick();
  const send = retry.querySelector<HTMLButtonElement>("[data-visibility-apply]")!;
  expect(send.disabled).toBe(false);
  send.click();
  await settle();
  expect(apiMocks.registerCard).toHaveBeenCalledTimes(1);
  expect(apiMocks.registerCard.mock.calls[0]?.[0]).toBe("rejected");
});

it("AuthorVisibility skips account quota for a previously registered private draft with no visible review", async () => {
  apiMocks.readVisibility.mockResolvedValue({ workVisibility: { ...baseVisibility, firstRegistrationRequired: false } });
  apiMocks.fetchMyCards.mockResolvedValue({ items: [], total: 0, quota: baseQuota({ used: 6, limit: 6, packRemaining: 0 }) });
  const submitted = vi.fn();
  await mountWithRouter(() => h(AuthorVisibility, {
    id: "registered-draft",
    provider: "harbor",
    actor: "22",
    name: "Previously registered",
    token: async () => "tok-author",
    inline: true,
    editor: true,
    onSubmit: submitted,
  }));
  expect(apiMocks.fetchMyCards).not.toHaveBeenCalled();
  expect(root!.textContent).not.toContain(i18n.global.t("mine.quota.exceeded"));
  const option = root!.querySelector<HTMLInputElement>('input[value="public"]')!;
  expect(option.disabled).toBe(false);
  option.click();
  await nextTick();
  root!.querySelector<HTMLButtonElement>("[data-visibility-apply]")!.click();
  expect(submitted).toHaveBeenCalledTimes(1);
});

it("CardOwnerActions distinguishes device_shared weekly_quota_exceeded from normal weekly_quota_exceeded", async () => {
  apiMocks.readVisibility.mockResolvedValue({
    workVisibility: { ...baseVisibility, access: "public", draftChanged: true, actions: ["set_private", "set_unlisted", "submit_update"] },
  });
  apiMocks.registerCard.mockRejectedValueOnce(new ApiError(403, "Weekly quota exceeded", "weekly_quota_exceeded", undefined, "device_shared"));
  const card = { id: "100021", num: 100021, name: "Synthetic Card", provider: "harbor", roleId: "sealed", sourceRoleId: "draft", status: "approved", author: { accountNumId: 22, name: "Author" } } as any;
  await mountWithRouter(() => h(CardOwnerActions, { card }));
  const submitBtn = [...root!.querySelectorAll("button")].find((b) => b.textContent?.trim() === i18n.global.t("card.owner.submitUpdate"))!;
  submitBtn.click();
  await settle();
  const alert = root!.querySelector('[role="alert"]')!;
  expect(alert.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
  expect(alert.querySelector("[data-quota-device-help]")).not.toBeNull();

  // Normal weekly_quota_exceeded -> no help link
  apiMocks.registerCard.mockRejectedValueOnce(new ApiError(403, "Weekly quota exceeded", "weekly_quota_exceeded"));
  submitBtn.click();
  await settle();
  const alert2 = root!.querySelector('[role="alert"]')!;
  expect(alert2.textContent).toContain(i18n.global.t("mine.quota.exceeded"));
  expect(alert2.querySelector("[data-quota-device-help]")).toBeNull();
});

/**
 * 真實 ConfirmDialog（不 mock confirm.ts）端到端驗證：
 * 送審被 403 weekly_quota_exceeded + reason:"device_shared" 擋下時，確認彈層留住並顯示
 * mine.quota.exceededDevice 與 QuotaDeviceHelp 求助連結；一般額度用完顯示 mine.quota.exceeded
 * 且不出現求助連結；並在真實 Chrome 檢查五語 × 手機/桌機 × 深淺色幾何與點擊命中。
 */
import { readNativeFixture } from "../../stage/src/test-support/native-fixture";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp, h, nextTick, ref, type App } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyLocale, i18n, LOCALE_CODES } from "../src/lib/i18n";
import { siteLinksKey } from "../src/lib/site-links";
import { confirmForm, confirmState, settleConfirm } from "../src/lib/confirm";
import { json } from "../src/lib/api";
import ConfirmDialog from "../src/components/ConfirmDialog.vue";
import CardOwnerActions from "../src/components/CardOwnerActions.vue";

vi.mock("../src/lib/track", () => ({ track: vi.fn(), currentSurface: () => "test", setSurface: () => {} }));
vi.mock("../src/lib/work-visibility-capability", async () => {
  const { ref: vref } = await import("vue");
  return { useWorkVisibilityCapability: () => vref(true) };
});
vi.mock("../src/lib/share-ref", async (original) => ({
  ...(await original<typeof import("../src/lib/share-ref")>()),
  currentReferralCode: async () => null,
  ownReferralCode: async () => null,
}));

const sessionMock = vi.hoisted(() => ({
  me: { accountNumId: 22, nickName: "Author", avatar: "" },
  profile: { identities: [{ provider: "harbor", externalId: 22 }] },
  ready: true,
  accessToken: vi.fn(async () => "tok-author"),
}));
vi.mock("../src/lib/session", () => ({ useSession: () => sessionMock }));

const apiMocks = vi.hoisted(() => ({
  registerCard: vi.fn(),
  fetchRatingDraft: vi.fn(),
  saveRatingDraft: vi.fn(),
  accountToken: vi.fn(),
  ask: vi.fn(),
  readVisibility: vi.fn(),
}));
vi.mock("../src/lib/api", async (original) => ({
  ...(await original<typeof import("../src/lib/api")>()),
  registerCard: apiMocks.registerCard,
  fetchRatingDraft: apiMocks.fetchRatingDraft,
  saveRatingDraft: apiMocks.saveRatingDraft,
}));
vi.mock("../src/lib/connections", async (original) => ({
  ...(await original<typeof import("../src/lib/connections")>()),
  accountToken: apiMocks.accountToken,
}));
vi.mock("../src/lib/rating", async (original) => ({
  ...(await original<typeof import("../src/lib/rating")>()),
  askRating: apiMocks.ask,
}));
vi.mock("../src/lib/work-visibility", async (original) => ({
  ...(await original<typeof import("../src/lib/work-visibility")>()),
  fetchWorkVisibility: apiMocks.readVisibility,
}));

let app: App | null = null;
let root: HTMLElement | null = null;
const settle = async () => {
  for (let i = 0; i < 16; i++) {
    await Promise.resolve();
    await nextTick();
  }
};

beforeEach(async () => {
  vi.clearAllMocks();
  settleConfirm(false);
  confirmState.current = null;
  await applyLocale("zh-Hant");
  apiMocks.accountToken.mockResolvedValue("tok-author");
  apiMocks.fetchRatingDraft.mockResolvedValue({ answers: { version: 1, topics: { romance: "romance.dating" }, other: "other.none" }, ratingFloor: null });
  apiMocks.ask.mockImplementation(async (a: unknown) => a);
  apiMocks.saveRatingDraft.mockResolvedValue(undefined);
  apiMocks.readVisibility.mockResolvedValue({
    workVisibility: {
      access: "public",
      effectiveAccess: "public",
      review: "none",
      update: "none",
      everPublic: false,
      revisionState: "unknown",
      restorable: false,
      restoreReason: "no_approval",
      draftChanged: true,
      restriction: "none",
      policyRevision: "1",
      approvalRevision: "0",
      actions: ["set_private", "set_unlisted", "submit_update"],
      syncState: "complete",
    },
  });
});

afterEach(() => {
  settleConfirm(false);
  confirmState.current = null;
  app?.unmount();
  app = null;
  root?.remove();
  root = null;
  document.body.innerHTML = "";
});

async function mountDialogHost(children: () => ReturnType<typeof h>[], discordInvite: string | null = "https://discord.gg/hearthroom") {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/:p(.*)*", component: { template: "<div />" } }],
  });
  await router.push("/cards/100021");
  await router.isReady();
  const pinia = createPinia();
  setActivePinia(pinia);
  root = document.createElement("div");
  document.body.append(root);
  app = createApp({ render: () => h("div", children()) })
    .use(pinia)
    .use(i18n)
    .use(router);
  app.provide(siteLinksKey, ref({ discordInvite }));
  app.mount(root);
  await settle();
}

const rejectFromHttp = (body: Record<string, unknown>) =>
  json(new Response(JSON.stringify(body), { status: 403, headers: { "Content-Type": "application/json" } }));

it("shows localized exceededDevice + QuotaDeviceHelp inside real ConfirmDialog on 403 device_shared, and plain exceeded on ordinary quota", async () => {
  for (const loc of LOCALE_CODES) {
    await applyLocale(loc);
    await mountDialogHost(() => [h(ConfirmDialog)]);
    const pending = confirmForm({
      title: i18n.global.t("mine.consent.title"),
      message: i18n.global.t("workspace.reviewConsent"),
      confirmText: i18n.global.t("mine.consent.confirm"),
      field: { label: i18n.global.t("editor.fandom.label"), placeholder: "" },
      onConfirm: async () => {
        await rejectFromHttp({ error: "weekly_quota_exceeded", reason: "device_shared" });
      },
    });
    await settle();
    document.querySelector<HTMLButtonElement>("[data-confirm]")!.click();
    await settle();

    const alert = document.querySelector<HTMLElement>('.dlg [role="alert"]')!;
    expect(alert, `${loc}: alert shown`).not.toBeNull();
    expect(alert.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
    expect(alert.textContent).not.toContain("weekly_quota_exceeded");
    const link = alert.querySelector<HTMLAnchorElement>("[data-quota-device-help]")!;
    expect(link, `${loc}: help link`).not.toBeNull();
    expect(link.getAttribute("href")).toBe("https://discord.gg/hearthroom");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");

    settleConfirm(false);
    expect(await pending).toBeNull();
    app!.unmount();
    root!.remove();
  }

  // Ordinary per-account 403 weekly_quota_exceeded -> mine.quota.exceeded, NO help link
  await applyLocale("zh-Hant");
  await mountDialogHost(() => [h(ConfirmDialog)]);
  const plain = confirmForm({
    title: i18n.global.t("mine.consent.title"),
    message: i18n.global.t("workspace.reviewConsent"),
    field: { label: i18n.global.t("editor.fandom.label"), placeholder: "" },
    onConfirm: async () => {
      await rejectFromHttp({ error: "weekly_quota_exceeded" });
    },
  });
  await settle();
  document.querySelector<HTMLButtonElement>("[data-confirm]")!.click();
  await settle();

  const alert = document.querySelector<HTMLElement>('.dlg [role="alert"]')!;
  expect(alert.textContent).toContain(i18n.global.t("mine.quota.exceeded"));
  expect(alert.textContent).not.toContain("weekly_quota_exceeded");
  expect(alert.querySelector("[data-quota-device-help]")).toBeNull();
  settleConfirm(false);
  expect(await plain).toBeNull();

  // No Discord invite -> still shows exceededDevice, hides help link cleanly
  app!.unmount();
  root!.remove();
  await mountDialogHost(() => [h(ConfirmDialog)], null);
  const noInvite = confirmForm({
    title: i18n.global.t("mine.consent.title"),
    message: i18n.global.t("workspace.reviewConsent"),
    field: { label: i18n.global.t("editor.fandom.label"), placeholder: "" },
    onConfirm: async () => {
      await rejectFromHttp({ error: "weekly_quota_exceeded", reason: "device_shared" });
    },
  });
  await settle();
  document.querySelector<HTMLButtonElement>("[data-confirm]")!.click();
  await settle();
  const alertNoInvite = document.querySelector<HTMLElement>('.dlg [role="alert"]')!;
  expect(alertNoInvite.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
  expect(alertNoInvite.querySelector("[data-quota-device-help]")).toBeNull();
  settleConfirm(false);
  expect(await noInvite).toBeNull();
});

it("CardOwnerActions with real ConfirmDialog displays device_shared error + help link inside the dialog, then clears link on ordinary quota error", async () => {
  apiMocks.registerCard.mockImplementationOnce(async () => {
    await rejectFromHttp({ error: "weekly_quota_exceeded", reason: "device_shared" });
  });
  const card = {
    id: "100021",
    num: 100021,
    name: "Synthetic Card",
    provider: "harbor",
    roleId: "sealed",
    sourceRoleId: "draft",
    status: "approved",
    author: { accountNumId: 22, name: "Author" },
  } as any;
  await mountDialogHost(() => [h(CardOwnerActions, { card }), h(ConfirmDialog)]);
  const submitBtn = [...root!.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === i18n.global.t("card.owner.submitUpdate"),
  )!;
  submitBtn.click();
  await settle();

  const confirmBtn = document.querySelector<HTMLButtonElement>("[data-confirm]")!;
  expect(confirmBtn).not.toBeNull();
  confirmBtn.click();
  await settle();

  const alert = document.querySelector<HTMLElement>('.dlg [role="alert"]')!;
  expect(alert).not.toBeNull();
  expect(alert.textContent).toContain(i18n.global.t("mine.quota.exceededDevice"));
  expect(alert.querySelector("[data-quota-device-help]")).not.toBeNull();

  // Retry returns ordinary per-account quota exceeded -> help link clears
  apiMocks.registerCard.mockImplementationOnce(async () => {
    await rejectFromHttp({ error: "weekly_quota_exceeded" });
  });
  confirmBtn.click();
  await settle();
  const alert2 = document.querySelector<HTMLElement>('.dlg [role="alert"]')!;
  expect(alert2.textContent).toContain(i18n.global.t("mine.quota.exceeded"));
  expect(alert2.querySelector("[data-quota-device-help]")).toBeNull();
});

it("renders ConfirmDialog quota-device error and help link cleanly in Chrome across all 5 locales at 390px and 1280px in light/dark modes", async () => {
  const chrome =
    process.env.CHROME_BIN ||
    ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find(existsSync);
  expect(chrome, "Chrome is required for responsive geometry").toBeTruthy();

  const readCss = (files: string[]) =>
    files
      .map((file) => {
        const src = readFileSync(file, "utf8");
        if (file.endsWith(".css")) return src;
        return [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
          .map((m) => m[1].replace(/:deep\(([^)]+)\)/g, "$1"))
          .join("\n");
      })
      .join("\n");

  const css = readCss([
    "src/styles/tokens.css",
    "src/styles/base.css",
    "src/components/ConfirmDialog.vue",
    "src/components/QuotaDeviceHelp.vue",
  ]);

  const htmlByLocale: Record<string, string> = {};
  for (const loc of LOCALE_CODES) {
    await applyLocale(loc);
    await mountDialogHost(() => [h(ConfirmDialog)]);
    const p = confirmForm({
      title: i18n.global.t("mine.consent.title"),
      message: i18n.global.t("workspace.reviewConsent"),
      confirmText: i18n.global.t("mine.consent.confirm"),
      field: { label: i18n.global.t("editor.fandom.label"), placeholder: "" },
      onConfirm: async () => {
        await rejectFromHttp({ error: "weekly_quota_exceeded", reason: "device_shared" });
      },
    });
    await settle();
    document.querySelector<HTMLButtonElement>("[data-confirm]")!.click();
    await settle();
    htmlByLocale[loc] = document.querySelector(".dlg-backdrop")!.outerHTML;
    settleConfirm(false);
    await p;
    app!.unmount();
    root!.remove();
  }

  const dir = mkdtempSync(join(tmpdir(), "confirm-quota-device-layout-"));
  let clean = false;
  try {
    const frames: string[] = [];
    for (const loc of LOCALE_CODES) {
      for (const width of [390, 1280]) {
        for (const mode of ["light", "dark"] as const) {
          const doc = `<!doctype html><html lang="${loc}" data-mode="${mode}"><head><meta charset="utf-8"><style>${css}\n.dlg-backdrop,.dlg{animation:none!important}</style></head><body>${htmlByLocale[loc]}</body></html>`;
          const escaped = doc.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
          frames.push(
            `<iframe style="border:0;width:${width}px;height:760px" srcdoc="${escaped}" onload="
              const d = this.contentDocument;
              const dlg = d.querySelector('.dlg');
              const alert = d.querySelector('.dlg__error');
              const textEl = alert.querySelector('span');
              const link = alert.querySelector('[data-quota-device-help]');
              const dr = dlg.getBoundingClientRect();
              const tr = textEl.getBoundingClientRect();
              const lr = link.getBoundingClientRect();
              const hit = d.elementFromPoint(lr.left + lr.width / 2, lr.top + lr.height / 2);
              const opacity = Number(d.defaultView.getComputedStyle(link).opacity);
              window.results.push({
                loc: '${loc}',
                width: ${width},
                mode: '${mode}',
                noOverflow: d.documentElement.scrollWidth <= d.documentElement.clientWidth + 1 && dlg.scrollWidth <= dlg.clientWidth + 1,
                inBounds: lr.left >= dr.left - 1 && lr.right <= dr.right + 1,
                belowText: lr.top >= tr.bottom - 1,
                minHeight: lr.height >= 30,
                hitSelf: hit === link || link.contains(hit),
                fullOpacity: opacity === 1,
              });
              document.querySelector('#result').textContent = JSON.stringify(window.results);
            "></iframe>`,
          );
        }
      }
    }

    const fixture = join(dir, "fixture.html");
    writeFileSync(fixture, `<!doctype html><meta charset="utf-8"><script>window.results=[]</script>${frames.join("")}<pre id="result"></pre>`);
    const run = await readNativeFixture(chrome!, fixture, {
      profile: join(dir, "profile"),
      ready: "(()=>{try{return JSON.parse(document.querySelector('#result')?.textContent||'[]').length>=20}catch{return false}})()",
      timeout: 30000,
    });
    clean = true;
    expect(run.error, run.stderr).toBeUndefined();
    expect(run.status, run.stderr).toBe(0);
    const jsonText = run.stdout.match(/<pre id="result">([^<]+)<\/pre>/)?.[1];
    expect(jsonText, "Expected geometry results from Chrome").toBeTruthy();
    const results = JSON.parse(jsonText!) as Array<Record<string, unknown>>;
    expect(results).toHaveLength(LOCALE_CODES.length * 2 * 2);
    for (const row of results) {
      const label = `${row.loc} ${row.width}px ${row.mode}`;
      expect(row.noOverflow, `${label}: noOverflow`).toBe(true);
      expect(row.inBounds, `${label}: inBounds`).toBe(true);
      expect(row.belowText, `${label}: belowText`).toBe(true);
      expect(row.minHeight, `${label}: minHeight`).toBe(true);
      expect(row.hitSelf, `${label}: hitSelf`).toBe(true);
      expect(row.fullOpacity, `${label}: fullOpacity`).toBe(true);
    }
  } finally {
    if (clean) rmSync(dir, { recursive: true, force: true });
    await applyLocale("zh-Hant");
  }
}, 60000);

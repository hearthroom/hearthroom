/**
 * 「我的卡片」不等身分那一趟（約 0.6 s）：這個瀏覽器上次是登入的就先開頁、畫上次那份，
 * 身分在背景確認；確認不是登入狀態就換到登入頁。上次那份重新整理後還在（sessionStorage）。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("上次那份重新整理後還在", () => {
  beforeEach(() => { sessionStorage.clear(); vi.resetModules(); });
  it("寫進 sessionStorage：重新載入之後讀得回來；只留最近 10 頁", async () => {
    const first = (await import("../src/lib/mine-memory")).lastShown;
    for (let i = 0; i < 12; i++) first.set(`k${i}`, { rows: {}, totals: { harbor: i }, quota: null });
    vi.resetModules();
    const reloaded = (await import("../src/lib/mine-memory")).lastShown;
    expect(reloaded.get("k11")?.totals.harbor).toBe(11);
    expect(reloaded.get("k1")).toBeUndefined();
    reloaded.clear();
    vi.resetModules();
    expect((await import("../src/lib/mine-memory")).lastShown.get("k11")).toBeUndefined();
  });
});

const mocks = vi.hoisted(() => ({ session: { ready: false, me: null as null | { accountNumId: number }, restore: vi.fn() } }));
vi.mock("../src/lib/stage-preload", () => ({ preloadStage: async () => {} }));
vi.mock("../src/lib/session", () => ({ useSession: () => mocks.session }));
vi.mock("../src/lib/track", () => ({ track: () => {}, currentSurface: () => "", setSurface: () => {} }));
vi.mock("../src/lib/i18n", () => ({ LOCALE_CODES: ["zh-Hant", "zh-Hans", "en", "ja", "ko"], SOURCE_LOCALE: "zh-Hant", applyLocale: async () => {}, detectLocale: () => "zh-Hant", pageTitle: () => "Fixture", updateHreflang: () => {} }));
vi.mock("../src/pages/BoardPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/MyCardsPage.vue", () => ({ default: { template: "<div />" } }));
vi.mock("../src/pages/LoginPage.vue", () => ({ default: { template: "<div />" } }));

describe("先開頁、身分在背景確認", () => {
  let finish!: () => void;
  beforeEach(() => {
    localStorage.clear();
    mocks.session.ready = false;
    mocks.session.me = null;
    mocks.session.restore.mockReset().mockImplementation(() => new Promise<void>((r) => { finish = () => { mocks.session.ready = true; r(); }; }));
  });
  afterEach(() => localStorage.clear());

  it("上次是登入的：不等身分就開「我的卡片」；確認沒登入就換到登入頁", async () => {
    const { rememberSignedIn } = await import("../src/lib/signin-hint");
    rememberSignedIn(22);
    const { router } = await import("../src/router");
    await router.push("/");
    await router.push("/mine");
    expect(router.currentRoute.value.path).toBe("/mine");
    finish();
    await vi.waitFor(() => expect(router.currentRoute.value.path).toBe("/login"));
    expect(router.currentRoute.value.query.returnTo).toBe("/mine");
  });

  it("沒有登入過的紀錄：照舊等身分確認完才決定", async () => {
    vi.resetModules();
    const { router } = await import("../src/router");
    await router.push("/");
    const navigation = router.push("/mine");
    for (let i = 0; i < 20; i++) await Promise.resolve();
    expect(router.currentRoute.value.path).not.toBe("/mine");
    mocks.session.me = { accountNumId: 22 };
    finish();
    await navigation;
    expect(router.currentRoute.value.path).toBe("/mine");
  });
});

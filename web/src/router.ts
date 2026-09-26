import { nextTick } from "vue";
import { preloadStage } from "./lib/stage-preload";
import { createRouter, createWebHistory, type RouteRecordRaw } from "vue-router";
import { LOCALE_CODES, SOURCE_LOCALE, applyLocale, detectLocale, pageTitle, updateHreflang } from "./lib/i18n";
import { useSession } from "./lib/session";
import { can } from "./lib/provider";
import { isPlayHost } from "./lib/site";
import { setSurface } from "./lib/track";

/**
 * 語言放在網址路徑裡，不是 localStorage。
 *
 * 這是個靠分享與搜尋被發現的社群站：連結要能帶著語言傳給別人，搜尋引擎要能把
 * 每個語言各自收錄（配 hreflang）。存在 localStorage 的話，別人打開你分享的連結
 * 看到的還是他自己的預設語言，而 Google 只會看到一種。
 *
 * 預設語言不帶前綴（/ 而不是 /zh-Hant/），其餘是 /en/、/ja/⋯⋯
 * 這是多數多語言站的做法：預設語言的網址保持乾淨，也不必為了上線而做一次全站轉址。
 */
import BoardPage from "./pages/BoardPage.vue";

const PREFIXED = LOCALE_CODES.filter((c) => c !== SOURCE_LOCALE);

const pages: RouteRecordRaw[] = [
  // 首頁直接打包進主程式：它是大多數人的第一頁。拆成一包的話，冷開要等主程式跑完才去抓
  // 九個小檔（合計約 15 KB），實測白白多一波 0.57 s（2026-09-26）。
  { path: "", component: BoardPage },
  { path: "search", component: () => import("./pages/SearchPage.vue") },
  { path: "cards/:id", component: () => import("./pages/CardPage.vue") },
  { path: "cards/:roleId/edit", component: () => import("./pages/CardEditorPage.vue"), meta: { auth: true, feature: "editor" } },
  { path: "authors/:handle", component: () => import("./pages/AuthorPage.vue") },
  { path: "library", component: () => import("./pages/LibraryPage.vue"), meta: { auth: true } },
  { path: "me/badges", component: () => import("./pages/BadgesPage.vue"), meta: { auth: true } },
  { path: "me/community", component: () => import("./pages/CommunityPage.vue"), meta: { auth: true } },
  { path: "me", component: () => import("./pages/MePage.vue"), meta: { auth: true } },
  { path: "login", component: () => import("./pages/LoginPage.vue") },
  { path: "mine", component: () => import("./pages/MyCardsPage.vue"), meta: { auth: true } },
  // 建立與編輯是同一頁：差別只有有沒有 roleId。
  { path: "create", component: () => import("./pages/CardEditorPage.vue"), meta: { auth: true, feature: "editor" } },
  { path: "wallet", component: () => import("./pages/WalletPage.vue"), meta: { auth: true } },
  // 我的資源：作者的素材圖庫（上游圖床），拿網址寫進正則規則用
  { path: "resources", component: () => import("./pages/ResourcesPage.vue"), meta: { auth: true, feature: "library" } },
  { path: "settings", component: () => import("./pages/SettingsPage.vue"), meta: { auth: true } },
  { path: "developers", component: () => import("./pages/DevelopersPage.vue") },
  { path: "download", component: () => import("./pages/DownloadPage.vue") },
  { path: "guide", component: () => import("./pages/GuidePage.vue") },
  // 站內玩卡：舞台整頁接管（bare = 不套站台頁首頁尾），對話要登入
  { path: "play/:roleId", component: () => import("./pages/PlayPage.vue"), meta: { auth: true, bare: true, preloadStage: true } },
  // 遊戲模式：同一張卡，回覆拆成敘事＋舞台狀態。開場白是公開的，遊客可看第一幕；行動時才要登入。
  { path: "game/:roleId", component: () => import("./pages/GamePage.vue"), meta: { bare: true } },
  // 社群管理共用工作台；資格與個別操作的權限由服務端檢查。
  {
    path: "review", component: () => import("./pages/CommunityManagementLayout.vue"), meta: { auth: true },
    children: [
      { path: "", component: () => import("./pages/ReviewQueuePage.vue"), meta: { managementTab: "reviews" } },
      { path: "cases", component: () => import("./pages/ModerationPage.vue"), meta: { managementTab: "cases" } },
      { path: "cards", component: () => import("./pages/ModerationPage.vue"), meta: { managementTab: "cards" } },
      { path: "history", component: () => import("./pages/ModerationPage.vue"), meta: { managementTab: "history" } },
      { path: "manage", redirect: (to) => ({ path: withLocale("/review/cases", localeOf(to)), query: to.query, hash: to.hash }) },
      { path: ":id", component: () => import("./pages/ReviewDetailPage.vue"), meta: { managementTab: "reviews" } },
    ],
  },
  { path: "auth/callback", component: () => import("./pages/CallbackPage.vue") },
  // 404 也在語言前綴底下：/en/nope 要看到英文的 404，而不是被換回預設語言
  { path: ":pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue") },
];

/**
 * 卡片 App 網域（lib/site.ts 的 isPlayHost）只有三種頁：/<roleId>/ 是那張卡的對話頁，加上登入與回調。
 * 沒有語言前綴——每張卡 App 的範圍是 /<roleId>/，前綴會把頁面推出範圍；語言放 ?lang=。
 * 全部 bare：這裡沒有站台的頁首頁尾可去。
 */
const playAppPages = [
  { path: "/login", component: () => import("./pages/LoginPage.vue"), meta: { bare: true } },
  { path: "/auth/callback", component: () => import("./pages/CallbackPage.vue"), meta: { bare: true } },
  { path: "/:roleId([^/]+)", component: () => import("./pages/PlayPage.vue"), meta: { auth: true, bare: true, playApp: true, preloadStage: true } },
  { path: "/:pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue"), meta: { bare: true } },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: isPlayHost()
    ? playAppPages
    : [
        {
          // 前綴用列舉而不是萬用參數：不然 /cards/xxx 的 cards 會被當成語言代碼。
          path: `/:locale(${PREFIXED.join("|")})?`,
          children: pages,
        },
      ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

const isLocaleCode = (v: unknown): v is string => typeof v === "string" && LOCALE_CODES.includes(v);

/** 目前路徑的語言。主站看前綴，沒有就是預設語言；卡片 App 網域看 ?lang=，沒有就照瀏覽器偏好。 */
export const localeOf = (route: { params: Record<string, unknown>; query?: Record<string, unknown> }) => {
  if (isPlayHost()) return isLocaleCode(route.query?.lang) ? route.query.lang : detectLocale();
  return (route.params.locale as string) || SOURCE_LOCALE;
};

/** 組出帶目前語言的路徑。所有站內連結都要經過它，否則點一下就掉回預設語言。主站是前綴，卡片 App 網域是 ?lang=。 */
export function withLocale(path: string, locale: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  if (isPlayHost()) return `${clean}${clean.includes("?") ? "&" : "?"}lang=${encodeURIComponent(locale)}`;
  return locale === SOURCE_LOCALE ? clean : `/${locale}${clean === "/" ? "" : clean}`;
}

let firstNavigation = true;

router.beforeEach(async (to) => {
  const locale = localeOf(to);

  // 卡片 App 網域：/<roleId> 補上結尾斜線——App 的範圍是 /<roleId>/，少了斜線就在範圍外
  if (isPlayHost() && to.meta.playApp && !to.path.endsWith("/")) {
    return { path: `${to.path}/`, query: to.query, replace: true };
  }

  // 第一次進站且沒指定語言時，照瀏覽器偏好轉一次。之後不再自動轉——
  // 使用者手動選了語言，網址就是他的選擇，不該被偵測結果蓋掉。
  if (firstNavigation) {
    firstNavigation = false;
    if (!isPlayHost() && !to.params.locale) {
      const detected = detectLocale();
      if (detected !== SOURCE_LOCALE) {
        return { path: withLocale(to.path, detected), query: to.query, replace: true };
      }
    }
  }

  // Static assets are public. Start before locale/session waits; the auth gate and
  // player installation still run in their original order.
  if (to.meta.preloadStage) void preloadStage();
  // 這一頁的程式碼跟語言包同時下載。原本要等語言包與整串守衛跑完，vue-router 才開始抓頁面，
  // 冷開首頁時頁面程式碼晚了約 0.6 s 才出發（2026-09-26 實測）。同一個 import 之後再呼叫會拿到同一份。
  for (const record of to.matched) {
    const view = record.components?.default;
    if (typeof view === "function") void (view as () => Promise<unknown>)().catch(() => {});
  }
  await applyLocale(locale);
  // 去掉語言前綴的路徑，才是各語言版本共同的那一頁（卡片 App 網域不進搜尋，沒有各語言版本）
  if (!isPlayHost()) updateHreflang(locale === SOURCE_LOCALE ? to.path : to.path.replace(`/${locale}`, "") || "/");
  // 每次導航先給一個跟著語言走的預設標題；有自己標題的頁面（卡片、作者）掛載後會覆寫。
  // 少了這行，分頁標題會一直停在 index.html 裡那個寫死的中文。
  document.title = pageTitle();

  // 這一家沒有的功能就沒有那一頁。擋在登入之前——不該為了一個進不去的頁先要人登入。
  // 入口本身也會依能力隱藏；這裡守的是直接貼網址與舊書籤。
  if (to.meta.feature && !can(to.meta.feature as Parameters<typeof can>[0])) {
    return { path: isPlayHost() ? "/" : withLocale("/", locale), replace: true };
  }

  if (!to.meta.auth) return true;
  const session = useSession();
  await session.restore();
  if (session.me) return true;
  // 先到本站的登入頁，不直接跳去供應商：登入方式是這個站的事，供應商只是其中一種。
  // query 要分開給：物件位置的 path 不帶查詢字串（vue-router 只讀 path 本身），塞在 path 裡會被丟掉
  const query: Record<string, string> = to.fullPath === "/" ? {} : { returnTo: to.fullPath };
  // 卡片 App 網域的語言在查詢字串裡，不在路徑上：得放進 query 物件，放在 path 裡會被丟掉
  if (isPlayHost()) return { path: "/login", query: { ...query, lang: locale }, replace: true };
  return { path: withLocale("/login", locale), query, replace: true };
});

/**
 * 換頁後把焦點放到主內容上。鍵盤與讀屏使用者點了連結，焦點不該留在上一頁那顆
 * 已經不存在的按鈕上；main 有 tabindex=-1，能接焦點但不進 Tab 順序。
 */
/** 路由 → 來源標記。API 請求帶著它，服務端才知道這次瀏覽是從哪一頁走過來的。 */
function surfaceOf(path: string): string {
  if (isPlayHost()) return path.startsWith("/login") || path.startsWith("/auth") ? "login" : "play";
  const bare = "/" + path.replace(/^\/(zh-Hans|en|ja|ko)(?=\/|$)/, "").replace(/^\//, "");
  if (bare === "/") return "board";
  if (bare.startsWith("/search")) return "search";
  if (bare.startsWith("/cards")) return "card";
  if (bare.startsWith("/authors")) return "author";
  if (bare.startsWith("/mine")) return "mine";
  if (bare.startsWith("/create")) return "create";
  if (bare.startsWith("/wallet")) return "wallet";
  if (bare.startsWith("/play")) return "play";
  if (bare.startsWith("/game")) return "game";
  if (bare.startsWith("/review")) return "review";
  return "404";
}

// 先於任何 API 請求設好：beforeEach 的下游就是頁面元件的 setup，那裡才開始 fetch
router.beforeEach((to) => { setSurface(surfaceOf(to.path)); });

router.afterEach((to, from) => {
  if (to.path === from.path) return;
  void nextTick(() => document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true }));
});

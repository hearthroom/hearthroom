import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { LOCALE_CODES, SOURCE_LOCALE, applyLocale, detectLocale, pageTitle, updateHreflang } from "./lib/i18n";
import { useSession } from "./lib/session";
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
const PREFIXED = LOCALE_CODES.filter((c) => c !== SOURCE_LOCALE);

const pages = [
  { path: "", component: () => import("./pages/BoardPage.vue") },
  { path: "search", component: () => import("./pages/SearchPage.vue") },
  { path: "cards/:id", component: () => import("./pages/CardPage.vue") },
  { path: "cards/:roleId/edit", component: () => import("./pages/CardEditorPage.vue"), meta: { auth: true } },
  { path: "authors/:accountNumId", component: () => import("./pages/AuthorPage.vue") },
  { path: "mine", component: () => import("./pages/MyCardsPage.vue"), meta: { auth: true } },
  // 建立與編輯是同一頁：差別只有有沒有 roleId。
  { path: "create", component: () => import("./pages/CardEditorPage.vue"), meta: { auth: true } },
  { path: "wallet", component: () => import("./pages/WalletPage.vue"), meta: { auth: true } },
  // 我的資源：作者的素材圖庫（上游圖床），拿網址寫進正則規則用
  { path: "resources", component: () => import("./pages/ResourcesPage.vue"), meta: { auth: true } },
  // 站內玩卡：舞台整頁接管（bare = 不套站台頁首頁尾），對話要登入
  { path: "play/:roleId", component: () => import("./pages/PlayPage.vue"), meta: { auth: true, bare: true } },
  { path: "auth/callback", component: () => import("./pages/CallbackPage.vue") },
  // 404 也在語言前綴底下：/en/nope 要看到英文的 404，而不是被換回預設語言
  { path: ":pathMatch(.*)*", component: () => import("./pages/NotFoundPage.vue") },
];

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      // 前綴用列舉而不是萬用參數：不然 /cards/xxx 的 cards 會被當成語言代碼。
      path: `/:locale(${PREFIXED.join("|")})?`,
      children: pages,
    },
  ],
  scrollBehavior: (_to, _from, saved) => saved ?? { top: 0 },
});

/** 目前路徑的語言。沒有前綴就是預設語言。 */
export const localeOf = (route: { params: Record<string, unknown> }) =>
  (route.params.locale as string) || SOURCE_LOCALE;

/** 組出帶目前語言前綴的路徑。所有站內連結都要經過它，否則點一下就掉回預設語言。 */
export function withLocale(path: string, locale: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return locale === SOURCE_LOCALE ? clean : `/${locale}${clean === "/" ? "" : clean}`;
}

let firstNavigation = true;

router.beforeEach(async (to) => {
  const locale = localeOf(to);

  // 第一次進站且沒指定語言時，照瀏覽器偏好轉一次。之後不再自動轉——
  // 使用者手動選了語言，網址就是他的選擇，不該被偵測結果蓋掉。
  if (firstNavigation) {
    firstNavigation = false;
    if (!to.params.locale) {
      const detected = detectLocale();
      if (detected !== SOURCE_LOCALE) {
        return { path: withLocale(to.path, detected), query: to.query, replace: true };
      }
    }
  }

  await applyLocale(locale);
  // 去掉語言前綴的路徑，才是各語言版本共同的那一頁
  updateHreflang(locale === SOURCE_LOCALE ? to.path : to.path.replace(`/${locale}`, "") || "/");
  // 每次導航先給一個跟著語言走的預設標題；有自己標題的頁面（卡片、作者）掛載後會覆寫。
  // 少了這行，分頁標題會一直停在 index.html 裡那個寫死的中文。
  document.title = pageTitle();

  if (!to.meta.auth) return true;
  const session = useSession();
  await session.restore();
  if (session.me) return true;
  await session.login(to.fullPath);
  return false;
});

/**
 * 換頁後把焦點放到主內容上。鍵盤與讀屏使用者點了連結，焦點不該留在上一頁那顆
 * 已經不存在的按鈕上；main 有 tabindex=-1，能接焦點但不進 Tab 順序。
 */
/** 路由 → 來源標記。API 請求帶著它，服務端才知道這次瀏覽是從哪一頁走過來的。 */
function surfaceOf(path: string): string {
  const bare = "/" + path.replace(/^\/(zh-Hans|en|ja|ko)(?=\/|$)/, "").replace(/^\//, "");
  if (bare === "/") return "board";
  if (bare.startsWith("/search")) return "search";
  if (bare.startsWith("/cards")) return "card";
  if (bare.startsWith("/authors")) return "author";
  if (bare.startsWith("/mine")) return "mine";
  if (bare.startsWith("/create")) return "create";
  if (bare.startsWith("/wallet")) return "wallet";
  if (bare.startsWith("/play")) return "play";
  return "404";
}

// 先於任何 API 請求設好：beforeEach 的下游就是頁面元件的 setup，那裡才開始 fetch
router.beforeEach((to) => { setSurface(surfaceOf(to.path)); });

router.afterEach((to, from) => {
  if (to.path === from.path) return;
  void nextTick(() => document.querySelector<HTMLElement>("main")?.focus({ preventScroll: true }));
});

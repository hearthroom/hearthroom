<script setup lang="ts">
import SearchSuggest from "@/components/SearchSuggest.vue";
import SessionConnectionGate from "@/components/SessionConnectionGate.vue";
import { communityRequest } from "./lib/community";
import CommunityIcon from "@/components/CommunityIcon.vue";
import ReviewBadge from "@/components/ReviewBadge.vue";
import { computed, provide, reactive, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import CheckinHint from "@/components/CheckinHint.vue";
import SiteLink from "@/components/SiteLink.vue";
import SiteMenu from "@/components/SiteMenu.vue";
import { siteLinksKey, boardEndKey, boardListEndKey, headerOverlaysKey, petMenuKey } from "@/lib/site-links";
import AccountMenu from "@/components/AccountMenu.vue";
import NotificationBell from "@/components/NotificationBell.vue";
import { useNotifications } from "@/lib/notifications";
import AdultToggle from "@/components/AdultToggle.vue";
import AppearanceMenu from "@/components/AppearanceMenu.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import RatingDialog from "@/components/RatingDialog.vue";
import InstallToast from "@/components/InstallToast.vue";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useAppearance } from "@/lib/appearance";
import { useLocalePath } from "@/lib/use-locale";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";
import { siteLockup, siteName } from "../../shared/site-name";
import { installPrompt, openInstall } from "@/lib/pwa";
import { shouldShowDownloadEntry } from "@/lib/download";
import { isPlayHost } from "@/lib/site";
import { loginPath } from "@/lib/login-return";
import NewMark from "@/components/NewMark.vue";
import CoachTour from "@/components/CoachTour.vue";
import NewcomerTour from "@/components/NewcomerTour.vue";
import SukiPet from "@/components/SukiPet.vue";
import { watchCheckinNudges } from "@/lib/checkin-nudges";
import { useUpdates } from "@/lib/updates";
import { footerSupport, type FooterContext } from "@/lib/footer-nav";
import { watchCampaignShareBinding, watchShareRefBinding } from "@/lib/share-ref";
import { refreshGa4Account } from "@/lib/ga4";
import { fetchMe } from "@/lib/api";
import RoutesLayer from "@/components/routes/RoutesLayer.vue";
import RouteArrivalNotice from "@/components/routes/RouteArrivalNotice.vue";
import SignalBars from "@/components/routes/SignalBars.vue";
import { currentLine, headerSignalVisible, openRoutesDialog, routesAvailable, routesState } from "@/lib/routes";
import { SILENT_LOGIN_ENABLED, trySilentLogin } from "@/lib/silent-login";
import { safeReturnTo } from "@/lib/login-return";

const { lp, locale } = useLocalePath();
// 頁首與頁尾的品牌名跟著語言走（shared/site-name.ts）：中文介面是綺夢社，其他語言是 Hearthroom。副標只進分頁標題。
const brandName = computed(() => siteName(String(locale.value)));
/** 頁尾寫品牌全名（中文是「綺夢社・AI寢物語」），頁首空間小只放主名 */
const footerName = computed(() => siteLockup(String(locale.value)) ?? brandName.value);
// iOS 與我們自己的 App 裡不需要「下載 App」入口（lib/download.ts）。
const showDownloadEntry = shouldShowDownloadEntry({ ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints || 0 });
const session = useSession();
function refreshAnalytics() {
  void refreshGa4Account(session.me?.accountNumId ?? null, async () => {
    const token = await session.accessToken();
    return token ? (await fetchMe(token)).analytics : null;
  });
}
watch(() => session.me?.accountNumId ?? null, refreshAnalytics, { immediate: true });
onMounted(() => window.addEventListener("focus", refreshAnalytics));
onBeforeUnmount(() => window.removeEventListener("focus", refreshAnalytics));
const reviewerStore = useReviewer();
const route = useRoute();
const router = useRouter();
watchCheckinNudges(router, (p) => lp(p));

const discordInvite = ref<string|null>(null);
/** 線路：官方站的平時入口；TWA 用網站清單，具備橋接的 WebView 用原生清單。 */
const routesOn = routesAvailable();
const hereLine = currentLine();
/** 頁首的訊號圖示只在「目前慢、而且有更快的」時出現，提示卡收掉後當持久落點；遊玩頁不放 */
const showRouteSignal = computed(() => routesOn && !route.meta.preloadStage && headerSignalVisible());
const hereDown = computed(() => !!hereLine && routesState.results[hereLine.n]?.state === "down");
const footerCtx = computed<FooterContext>(() => ({
  repoUrl: SITE.repoUrl, license: SITE.license, discordInvite: discordInvite.value, showDownloadEntry,
  canInstallSite: installPrompt.available && installPrompt.target === "site",
  routeLine: routesOn && hereLine ? { name: `routes.name.${hereLine.n}`, host: hereLine.host } : null,
}));
provide(siteLinksKey, footerCtx);
const headerOverlays = reactive(new Set<symbol>());
provide(headerOverlaysKey, headerOverlays);
const boardEnded = ref(false);
provide(boardEndKey, boardEnded);
const boardListEnd = ref(false);
provide(boardListEndKey, boardListEnd);
const onBoardPage = computed(() => route.path.replace(/\/+$/, '') === lp('/').replace(/\/+$/, ''));
const compactHeader = ref(typeof window.matchMedia === "function" ? window.matchMedia('(max-width: 1079px)').matches : false);
provide(petMenuKey, computed(() => !route.meta.bare && !route.meta.readingNotice && !route.meta.petAway && !isPlayHost()));
const headerElement = ref<HTMLElement | null>(null);
let headerObserver: ResizeObserver | undefined;
function measureHeader() {
  compactHeader.value = window.innerWidth < 1080;
  const h = headerElement.value?.getBoundingClientRect().height;
  if (h) document.documentElement.style.setProperty('--site-header-h', `${h}px`);
}
onMounted(() => {
  measureHeader(); window.addEventListener('resize', measureHeader);
  if (typeof ResizeObserver !== 'undefined' && headerElement.value) { headerObserver = new ResizeObserver(measureHeader); headerObserver.observe(headerElement.value); }
});
onBeforeUnmount(() => { window.removeEventListener('resize', measureHeader); headerObserver?.disconnect(); });
const supportNav = computed(() => footerSupport(footerCtx.value));
onMounted(()=>{void communityRequest<{invite:string|null}>("/community/config").then(r=>{discordInvite.value=r.invite;}).catch(()=>{});});
const notifications = useNotifications();
// 更新說明的摘要：首頁提示列與「新」標記用。閒置時才讀，不跟第一屏搶；換語言重讀。
const updates = useUpdates();
const idle = (cb: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1200));
// 等第一次導航把介面語言定下來再讀：路由還沒套用網址上的語言時，locale 是預設的繁體，
// 會先讀一份繁體摘要、馬上又讀一份簡體（卡片頁實測 2026-10-22）
void router.isReady().then(() => {
  watch(locale, (l) => { if (!isPlayHost()) idle(() => { void updates.load(l); }); }, { immediate: true });
});
// 到了某則說明「去試試」的那一頁，就當作用過它的入口，那裡的「新」收起來
router.afterEach((to) => { updates.visited(to.path); });
let reviewTimer: ReturnType<typeof setInterval> | undefined;
// 審核待辦與通知未讀數同一個節奏：每分鐘一次，回到分頁再一次。通知那一趟順便告訴伺服器目前的介面語言。
function refreshReview(){ if(session.me && document.visibilityState==='visible') { void reviewerStore.refresh(); void notifications.refresh(locale.value); } }
watch(() => session.me?.accountNumId ?? null, (id) => { if (id) void notifications.refresh(locale.value); });
// 點了分享連結之後在這裡註冊的人：登入後替他帶入分享者的推薦碼（lib/share-ref.ts）。
watchShareRefBinding();
// 點了活動分享連結的人：登入後送一次歸因綁定，伺服器決定算不算新玩家。
watchCampaignShareBinding();
/**
 * 直接開另一個網域、這裡還沒登入：Harbor 那邊已登入的會員自動登回來（lib/silent-login.ts 把關快慢、頻率與登出）。
 * 過場頁與回呼頁不做；開關在 Harbor 支援之前是關的。
 */
if (SILENT_LOGIN_ENABLED) void router.isReady().then(() => watch(() => session.ready && !session.me && !session.restoreError, (signedOut) => {
  if (!signedOut || /\/auth\//.test(route.path)) return;
  const returnTo = /\/login$/.test(route.path) ? safeReturnTo(route.query.returnTo) : route.fullPath;
  void trySilentLogin({ immersive: !!route.meta.preloadStage, returnTo, locale: String(locale.value) }).catch(() => {});
}, { immediate: true }));
onMounted(() => { session.restore(); useAppearance().init(); reviewTimer=setInterval(refreshReview,60000); window.addEventListener('focus',refreshReview); document.addEventListener('visibilitychange',refreshReview); });
onBeforeUnmount(()=>{clearInterval(reviewTimer);window.removeEventListener('focus',refreshReview);document.removeEventListener('visibilitychange',refreshReview);document.removeEventListener('keydown',onSlash);});

/** 搜尋放在頁首，全站都搜得到；結果落在搜尋頁。按 / 直接聚焦。搜尋頁自己有一個大的，頁首那個就收起來。 */
const q = ref((route.query.q as string) ?? "");
const box = ref<InstanceType<typeof SearchSuggest> | null>(null);
const onSearchPage = computed(() => route.path === lp("/search"));
/**
 * 手機的第二排分頁（榜單／對話與收藏／我的卡片／生圖）只在這四頁出現：它是這幾個頂層頁之間的切換，
 * 進到卡片頁、編輯頁這類內頁就不該還掛著（owner 2026-10-11），想回去走返回或品牌鍵，跟桌機一樣。
 */
const onTabPage = computed(() => [lp("/"), lp("/library"), lp("/mine"), lp("/studio")].map((p) => p.replace(/\/+$/, "")).includes(route.path.replace(/\/+$/, "")));
watch(() => route.query.q, (v) => { q.value = (v as string) ?? ""; });

function search() {
  const term = q.value.trim();
  if (!term) return;
  if (/^#?[1-9]\d{0,11}$/.test(term)) { router.push(lp(`/cards/${term.replace(/^#/, "")}`)); return; }
  router.push({ path: lp("/search"), query: { q: term } });
}
function onSlash(e: KeyboardEvent) {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  if ((box.value?.$el as HTMLElement | undefined)?.offsetParent) box.value?.focus();
  else if (onSearchPage.value) document.querySelector<HTMLInputElement>("main input[type=search]")?.focus();
  else router.push(lp("/search"));
}
onMounted(() => document.addEventListener("keydown", onSlash));
</script>

<template>
  <a class="skip" href="#main">{{ $t("nav.skip") }}</a>

  <a v-if="onBoardPage && !compactHeader" class="skip skip-info" href="#home-site-info">{{ $t("home.skipInfo") }}</a>

  <header v-if="!route.meta.bare" ref="headerElement" class="header" :lang="locale">
    <div class="header__inner" :class="{ 'header__inner--nosearch': onSearchPage, 'header__inner--reviewer': reviewerStore.likely || reviewerStore.blogWriter, 'header__inner--signal': showRouteSignal }">
      <RouterLink :to="lp('/')" class="brand" :aria-label="brandName">
        <!-- 看板娘蘇綺的頭像（docs/design/hearthroom-mascot）；固定配色，不跟主題換色 -->
        <img class="brand__mark" src="/mascot/suki-mark.webp" alt="" width="28" height="28" decoding="async" />
        <span class="brand__name">{{ brandName }}</span>
      </RouterLink>

      <nav class="nav">
        <RouterLink :to="lp('/')" class="nav__item" :class="{ 'nav__item--on': route.path === lp('/') }">{{ $t("nav.board") }}</RouterLink>
        <RouterLink :to="lp('/library')" data-tour="library" class="nav__item" active-class="nav__item--on">{{ $t("library.title") }}</RouterLink>
        <RouterLink v-if="session.me" :to="lp('/mine')" class="nav__item" active-class="nav__item--on">{{ $t("nav.mine") }}</RouterLink>
        <RouterLink v-if="session.me" :to="lp('/studio')" class="nav__item" active-class="nav__item--on">{{ $t("nav.studio") }}</RouterLink>
        <!-- 只有審核人看得到這顆：是不是審核人由本站決定，登入後問一次 -->
        <RouterLink v-if="reviewerStore.likely || reviewerStore.blogWriter" :to="lp(reviewerStore.likely ? '/review' : '/review/blog')" class="nav__item" active-class="nav__item--on">{{ $t("nav.review") }}<ReviewBadge /></RouterLink>
      </nav>

      <form v-if="!onSearchPage" class="search" role="search" @submit.prevent="search">
        <svg class="search__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <SearchSuggest ref="box" v-model="q" input-class="search__input" :placeholder="$t('board.search.placeholder')" :label="$t('board.search.submit')" @submit="search" />
        <kbd class="search__kbd" aria-hidden="true">/</kbd>
      </form>

      <div class="account">
        <!-- 手機沒有那一排搜尋框：一顆圖示進搜尋頁，那裡有大的 -->
        <RouterLink v-if="!onSearchPage" :to="lp('/search')" class="search-go" :aria-label="$t('board.search.submit')"><NewMark k="header.search" dot />
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
        </RouterLink>
        <!-- 連線慢、而且有更快的線路：一顆訊號圖示，點了直接預選推薦的那條（ui.md §3.2） -->
        <button v-if="showRouteSignal" type="button" class="gh route-signal" data-route-signal :aria-label="$t(hereDown ? 'routes.headerDownLabel' : 'routes.headerLabel')" :title="$t(hereDown ? 'routes.headerDownLabel' : 'routes.headerLabel')" @click="openRoutesDialog(routesState.recommended)">
          <SignalBars :level="1" :down="hereDown" />
        </button>
        <!-- R18 開關只在首頁：它管的是榜單列出什麼，看卡片、寫卡片的時候不該在頁首晃（owner 2026-10-02） -->
        <AdultToggle v-if="route.path.replace(/\/+$/, '') === lp('/').replace(/\/+$/, '')" />
        <!-- 頁首放 Discord：玩家要找的是社群，不是程式碼；GitHub 留在頁尾的社群欄（owner 2026-10-17）。
             邀請連結跟頁尾「加入 Discord」同一條，讀不到就不顯示 -->
        <a v-if="discordInvite && !compactHeader" :href="discordInvite" target="_blank" rel="noopener noreferrer" class="gh" data-header-discord :aria-label="$t('community.join')" :title="$t('community.join')">
          <CommunityIcon name="discord" />
        </a>
        <AppearanceMenu v-if="!compactHeader" />
        <LocaleSwitch v-if="!compactHeader" />
        <NotificationBell v-if="session.me" />
        <AccountMenu v-if="session.me" :compact="compactHeader" />
        <button v-else-if="session.restoreError && !route.meta.auth" type="button" class="btn btn--lg" :disabled="!session.ready" :aria-busy="!session.ready" :title="$t('state.serverBusy')" @click="session.retryRestore()">{{ $t('linked.retry') }}</button>
        <RouterLink v-else-if="session.ready && !session.restoreError" class="btn btn--primary btn--sm" :to="lp(loginPath(route.fullPath))">
          {{ $t("nav.login") }}
        </RouterLink>
        <SiteMenu v-if="!session.me" />
      </div>
    </div>
  </header>

  <nav v-if="!route.meta.bare && onTabPage" class="mobile-library-nav" :inert="headerOverlays.size > 0" :aria-label="$t('library.navigation')">
    <RouterLink :to="lp('/')" :aria-current="route.path === lp('/') ? 'page' : undefined">{{ $t('nav.board') }}</RouterLink>
    <RouterLink :to="lp('/library')" data-tour="library" :aria-current="route.path === lp('/library') ? 'page' : undefined">{{ $t('library.title') }}</RouterLink>
    <RouterLink :to="lp('/mine')" :aria-current="route.path === lp('/mine') ? 'page' : undefined">{{ $t('nav.mine') }}</RouterLink>
    <RouterLink :to="lp('/studio')" :aria-current="route.path === lp('/studio') ? 'page' : undefined">{{ $t('nav.studio') }}</RouterLink>
  </nav>
  <CheckinHint v-if="onBoardPage && session.me && !route.meta.bare" />
  <RouteArrivalNotice v-if="routesOn && !route.meta.bare" />
  <main id="main" tabindex="-1" :inert="headerOverlays.size > 0" :class="{ 'site-main': !route.meta.bare, 'site-main--workspace': route.meta.workspace, 'main--bare': route.meta.bare }"><SessionConnectionGate><RouterView /></SessionConnectionGate></main>
  <CoachTour />
  <NewcomerTour />
  <!-- 桌寵兼嚮導：玩卡頁與沙盒（bare、卡片 App 網域）不出現，其他每一頁都在 -->
  <SukiPet :list-end-allowed="!onBoardPage || ['following', 'authors'].includes(String(route.query.mode)) || boardListEnd" :inert="headerOverlays.size > 0" v-if="!route.meta.bare && !isPlayHost() && !route.meta.readingNotice" />
  <ConfirmDialog />
  <RatingDialog />
  <!-- 裝到主畫面的提示：對話與遊戲頁是全螢幕的，不在那裡打擾 -->
  <!-- 卡片 App 網域的頁全是 bare，但「加到主畫面」的提示卡就在那裡 -->
  <InstallToast v-if="(!route.meta.bare || isPlayHost()) && !route.meta.readingNotice" :defer="route.meta.workspace === true || (route.meta.managementTab === 'reviews' && typeof route.params.id === 'string')" />
  <RoutesLayer v-if="routesOn" />

  <!--
    社群維護的開源站：頁尾照開源專案的慣例，把人導去倉庫——回報問題、看原始碼、看授權都在那裡。
    連結分組放在 lib/footer-nav.ts：新入口先決定屬於哪一組，不再往同一排後面接。
  -->
  <footer v-if="SITE.repoUrl && !route.meta.bare && !route.meta.workspace && (!onBoardPage || boardEnded || route.query.mode === 'following' || route.query.mode === 'authors')" class="footer" :inert="headerOverlays.size > 0" :lang="locale">
    <div class="footer__inner">
      <div class="footer__about">
        <p class="footer__name">{{ footerName }}</p>
      </div>
      <nav class="footer__support" :aria-label="$t('footer.links')"><SiteLink v-for="link in supportNav" :key="link.id" :link="link" /></nav>
    </div>
  </footer>
</template>

<style scoped>
/*
 * 內容區至少一整個螢幕高：頁尾永遠不在第一屏。不然頁面程式碼到之前頁尾在畫面底部，
 * 骨架一出現把它推走、空狀態又拉回來，手機上實測版面位移 0.46（2026-09-26，首頁）。
 */
.skip-info { left: auto; right: var(--s-2); }
.site-main { min-height: 100vh; min-height: 100dvh; padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); }
.site-main--workspace { min-height: 0; height: calc(100vh - var(--site-header-h, var(--header-h))); height: calc(100dvh - var(--site-header-h, var(--header-h))); }
.header {
  padding-top: env(safe-area-inset-top, 0px);
  padding-left: env(safe-area-inset-left, 0px);
  padding-right: env(safe-area-inset-right, 0px);
  position: sticky; top: 0; z-index: 30;
  /* 半透明加模糊：捲動時內容從底下滑過去，頁首有厚度而不是一條實心的橫桿 */
  background: color-mix(in srgb, var(--surface) 84%, transparent);
  backdrop-filter: blur(14px) saturate(1.5);
  -webkit-backdrop-filter: blur(14px) saturate(1.5);
  box-shadow: 0 1px 0 var(--line);
}
.header__inner {
  max-width: var(--page); margin: 0 auto; min-height: var(--header-h);
  padding: 0 var(--s-5);
  display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center; gap: var(--s-5);
}
.header__inner--nosearch { grid-template-columns: auto minmax(0, 1fr) auto; }

.brand { display: inline-flex; align-items: center; gap: 8px; min-width: 0; }
.brand__mark { width: 28px; height: 28px; flex: none; }
.brand__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }

.nav { display: flex; gap: 2px; }
.nav__item {
  display: inline-flex; align-items: center; height: 34px; padding: 0 12px;
  border-radius: var(--r-pill);
  font-size: 14px; font-weight: 500; color: var(--text-2);
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.nav__item:hover { color: var(--text); background: var(--surface-2); }
.nav__item--on { color: var(--text); background: var(--surface-2); }

.search { position: relative; justify-self: center; width: 100%; max-width: 440px; }
.search__icon {
  position: absolute; left: 12px; top: 50%; width: 16px; height: 16px;
  transform: translateY(-50%); color: var(--text-3); pointer-events: none;
}
/* 輸入框住在 SearchSuggest 裡：scoped 規則要用 :deep 才打得到 */
.search :deep(.search__input) {
  width: 100%; height: var(--h-md); padding: 0 var(--s-4) 0 36px;
  font: inherit; font-size: 14px; color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent; border-radius: var(--r-pill);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.search :deep(.search__input)::placeholder { color: var(--text-3); }
.search :deep(.search__input):focus { outline: none; background: var(--surface); border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search :deep(.search__input)::-webkit-search-cancel-button { -webkit-appearance: none; }
.search__kbd {
  position: absolute; right: 10px; top: 50%; transform: translateY(-50%);
  padding: 1px 6px; border-radius: 5px;
  font: 500 11px/1.5 var(--font); color: var(--text-3);
  background: var(--surface); box-shadow: 0 0 0 1px var(--line);
  pointer-events: none;
}
.search:focus-within .search__kbd { display: none; }

/* 登入鈕晚一點才出現（要先問過 session）：先把位置留好，頁首才不會跳 */
.account { display: flex; align-items: center; justify-content: flex-end; gap: var(--s-1); min-width: 150px; }
.account > .btn { margin-left: var(--s-1); }
.search-go {
  position: relative; display: none; align-items: center; justify-content: center; flex: none;
  width: 34px; height: 34px; border-radius: var(--r-pill); color: var(--text-2);
}
.search-go:hover { background: var(--surface-2); color: var(--text); }
.search-go svg { width: 18px; height: 18px; }
.gh { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 34px; height: 34px; border-radius: var(--r-pill); color: var(--text-2); }
.gh:hover { background: var(--surface-2); color: var(--text); }
.gh :deep(svg), .gh svg { width: 18px; height: 18px; }
/* 訊號圖示借 .gh 的尺寸與樣子，但頁首擠的時候不跟 Discord 一起走：連線慢的時候它比 Discord 重要。
   沒有圓點：它只在看過並收掉提示卡之後才出現，出現本身就是訊號（美術總監 2026-10-22 #5） */
.route-signal { padding: 0; border: 0; background: none; cursor: pointer; color: var(--text); }
.footer__detail { color: var(--text-2); }
.footer__host { color: var(--text-3); }
/* 手機上訊號圖示出現時，字標整個收起只留頭像：被截成「S」「綺..」像畫面壞了（走查 2026-10-22）。
   圖示只在連線慢的時候短暫出現，品牌頭像仍在 */
@media (max-width: 430px) {
  .header__inner--signal .brand__name { display: none; }
}

/* 精簡站務：品牌與四個支援／法律入口；完整導覽留在網站與帳號選單。 */
.footer { padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); border-top: 1px solid var(--border); margin-top: var(--s-7); }
.footer__inner {
  max-width: var(--page); margin: 0 auto; padding: var(--s-6) var(--s-5) var(--s-4);
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--s-5) var(--s-6);
  font-size: 13px; color: var(--text-3);
}
.footer__support { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-4); font-size: 12px; }
.footer__support :deep(a) { min-height: var(--h-sm); display: inline-flex; align-items: center; color: var(--text-3); }
.footer__about { min-width: 0; }
.footer__name { margin: 0 0 var(--s-2); font-weight: 600; color: var(--text); font-size: 14px; }
@media (max-width: 720px) {
  .footer__inner { grid-template-columns: minmax(0, 1fr); padding: var(--s-5) var(--s-4) var(--s-3); }
}

/* 平板（iPad 直放 744–834）跟桌機一樣：導覽留在頁首那一排，搜尋收成圖示讓出位置（owner 2026-10-11）。
   只有手機寬度才把導覽拆成第二排分頁。 */
@media (min-width: 701px) and (max-width: 1079px) {
  .header__inner { grid-template-columns: auto auto minmax(0, 1fr); column-gap: var(--s-4); padding: 0 var(--s-4); }
  .search { display: none; }
  .search-go { display: inline-flex; }
  .account { min-width: 0; }
}
.account :deep(.acct__credits) { white-space: nowrap; }

/* 站務入口較長；窄桌面將導覽放第二列，避免擠壓搜尋與帳號控制項。 */
.header__inner--reviewer .nav__item { white-space: nowrap; }
@media (min-width: 701px) and (max-width: 1280px) {
  .header__inner--reviewer { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0; }
  .header__inner--reviewer .brand, .header__inner--reviewer .account { min-height: var(--header-h); }
  .header__inner--reviewer .nav { grid-column: 1 / -1; grid-row: 2; justify-content: center; padding-bottom: var(--s-2); }
  .header__inner--reviewer .search { display: none; }
  .header__inner--reviewer .search-go { display: inline-flex; }
}

/* 手機：一排收完。品牌與榜單同一個目的地，榜單那顆省掉；搜尋收成圖示。
   右邊那排（搜尋、外觀、語言、餘額、頭像）寬度由內容決定、不能疊；擠不下時讓位的是字標——
   品牌欄用 minmax(0, 1fr) 才會真的縮（grid 的 auto 欄不會低於內容寬），字標以省略號收尾，圖標永遠在。 */
@media (max-width: 700px) {
  .header__inner { grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--s-3); padding: 0 var(--s-3); min-height: var(--header-h); }
  .nav, .search { display: none; }
  .search-go { display: inline-flex; }
  .account { min-width: 0; }
  .account > * { flex: none; }
}
/* 頁首擠的時候誰先讓位（owner 2026-10-11）：社群連結（現在是 Discord）第一個走——頁尾每頁都有同一條連結，少它不少功能。
   平板以下就收起來，把位置留給導覽與餘額。 */
@media (max-width: 860px) {
  .gh:not(.route-signal) { display: none; }
}
/* 再擠才輪到餘額（帳號選單與積分頁都還看得到它）。門檻由實測定：字標＋搜尋、外觀、語言、
   五位數餘額、頭像一排要 418px，六位數多 8px；百萬以上已縮寫，不會更寬。 */
@media (max-width: 430px) {
  .account :deep(.acct__credits) { display: none; }
}
.mobile-library-nav { display:none; }
@media(max-width:700px) {
  .mobile-library-nav { display:flex; justify-content:center; gap:var(--s-2); padding:var(--s-2) var(--s-4); border-bottom:1px solid var(--border); }
  .mobile-library-nav a { display:flex; align-items:center; justify-content:center; min-height:44px; flex:1; border-radius:var(--r-pill); font-size:.875rem; text-align:center; }
  .mobile-library-nav a[aria-current=page] { color:var(--accent-text); background:var(--accent-tint); font-weight:600; }
}
</style>

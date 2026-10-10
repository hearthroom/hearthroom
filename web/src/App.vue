<script setup lang="ts">
import SearchSuggest from "@/components/SearchSuggest.vue";
import { communityRequest } from "./lib/community";
import CommunityIcon from "@/components/CommunityIcon.vue";
import ReviewBadge from "@/components/ReviewBadge.vue";
import { computed, onMounted, onBeforeUnmount, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import AccountMenu from "@/components/AccountMenu.vue";
import NotificationBell from "@/components/NotificationBell.vue";
import { useNotifications } from "@/lib/notifications";
import AdultToggle from "@/components/AdultToggle.vue";
import AppearanceMenu from "@/components/AppearanceMenu.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import InstallToast from "@/components/InstallToast.vue";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useAppearance } from "@/lib/appearance";
import { useLocalePath } from "@/lib/use-locale";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";
import { siteName } from "../../shared/site-name";
import { installPrompt, openInstall } from "@/lib/pwa";
import { shouldShowDownloadEntry } from "@/lib/download";
import { isPlayHost } from "@/lib/site";
import { loginPath } from "@/lib/login-return";
import NewMark from "@/components/NewMark.vue";
import CoachTour from "@/components/CoachTour.vue";
import { useUpdates } from "@/lib/updates";
import { footerGroups, footerLegal, type FooterContext } from "@/lib/footer-nav";

const { lp, locale } = useLocalePath();
// 頁首與頁尾的品牌名跟著語言走（shared/site-name.ts）：中文介面是綺夢社，其他語言是 Hearthroom。副標只進分頁標題。
const brandName = computed(() => siteName(String(locale.value)));
// iOS 與我們自己的 App 裡不需要「下載 App」入口（lib/download.ts）。
const showDownloadEntry = shouldShowDownloadEntry({ ua: navigator.userAgent, touchPoints: navigator.maxTouchPoints || 0 });
const session = useSession();
const reviewerStore = useReviewer();
const route = useRoute();
const router = useRouter();

const discordInvite = ref<string|null>(null);
const footerCtx = computed<FooterContext>(() => ({
  repoUrl: SITE.repoUrl, license: SITE.license, discordInvite: discordInvite.value, showDownloadEntry,
  canInstallSite: installPrompt.available && installPrompt.target === "site",
}));
const footerNav = computed(() => footerGroups(footerCtx.value));
const legalNav = computed(() => footerLegal(footerCtx.value));
onMounted(()=>{void communityRequest<{invite:string|null}>("/community/config").then(r=>{discordInvite.value=r.invite;}).catch(()=>{});});
const notifications = useNotifications();
// 更新說明的摘要：首頁提示列與「新」標記用。閒置時才讀，不跟第一屏搶；換語言重讀。
const updates = useUpdates();
const idle = (cb: () => void) => (typeof requestIdleCallback === "function" ? requestIdleCallback(cb, { timeout: 3000 }) : setTimeout(cb, 1200));
watch(locale, (l) => { if (!isPlayHost()) idle(() => { void updates.load(l); }); }, { immediate: true });
// 到了某則說明「去試試」的那一頁，就當作用過它的入口，那裡的「新」收起來
router.afterEach((to) => { updates.visited(to.path); });
let reviewTimer: ReturnType<typeof setInterval> | undefined;
// 審核待辦與通知未讀數同一個節奏：每分鐘一次，回到分頁再一次。通知那一趟順便告訴伺服器目前的介面語言。
function refreshReview(){ if(session.me && document.visibilityState==='visible') { void reviewerStore.refresh(); void notifications.refresh(locale.value); } }
watch(() => session.me?.accountNumId ?? null, (id) => { if (id) void notifications.refresh(locale.value); });
onMounted(() => { session.restore(); useAppearance().init(); reviewTimer=setInterval(refreshReview,60000); window.addEventListener('focus',refreshReview); document.addEventListener('visibilitychange',refreshReview); });
onBeforeUnmount(()=>{clearInterval(reviewTimer);window.removeEventListener('focus',refreshReview);document.removeEventListener('visibilitychange',refreshReview);document.removeEventListener('keydown',onSlash);});

/** 搜尋放在頁首，全站都搜得到；結果落在搜尋頁。按 / 直接聚焦。搜尋頁自己有一個大的，頁首那個就收起來。 */
const q = ref((route.query.q as string) ?? "");
const box = ref<InstanceType<typeof SearchSuggest> | null>(null);
const onSearchPage = computed(() => route.path === lp("/search"));
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

  <header v-if="!route.meta.bare" class="header">
    <div class="header__inner" :class="{ 'header__inner--nosearch': onSearchPage, 'header__inner--reviewer': reviewerStore.likely }">
      <RouterLink :to="lp('/')" class="brand" :aria-label="brandName">
        <svg class="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7.5L7 21.5V18H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
        </svg>
        <span class="brand__name">{{ brandName }}</span>
      </RouterLink>

      <nav class="nav">
        <RouterLink :to="lp('/')" class="nav__item" :class="{ 'nav__item--on': route.path === lp('/') }">{{ $t("nav.board") }}</RouterLink>
        <RouterLink :to="lp('/library')" class="nav__item" active-class="nav__item--on">{{ $t("library.title") }}</RouterLink>
        <RouterLink v-if="session.me" :to="lp('/mine')" class="nav__item" active-class="nav__item--on">{{ $t("nav.mine") }}</RouterLink>
        <!-- 只有審核人看得到這顆：是不是審核人由本站決定，登入後問一次 -->
        <RouterLink v-if="reviewerStore.likely" :to="lp('/review')" class="nav__item" active-class="nav__item--on">{{ $t("nav.review") }}<ReviewBadge /></RouterLink>
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
        <!-- R18 開關只在首頁：它管的是榜單列出什麼，看卡片、寫卡片的時候不該在頁首晃（owner 2026-10-02） -->
        <AdultToggle v-if="route.path === lp('/')" />
        <!-- 開源站：倉庫入口放頁首，不只頁尾 -->
        <a :href="SITE.repoUrl" target="_blank" rel="noopener" class="gh" :aria-label="$t('footer.github')" :title="$t('footer.github')">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
        </a>
        <AppearanceMenu />
        <LocaleSwitch />
        <NotificationBell v-if="session.me" />
        <AccountMenu v-if="session.me" />
        <RouterLink v-else-if="session.ready" class="btn btn--primary btn--sm" :to="lp(loginPath(route.fullPath))">
          {{ $t("nav.login") }}
        </RouterLink>
      </div>
    </div>
  </header>

  <nav v-if="!route.meta.bare" class="mobile-library-nav" :aria-label="$t('library.navigation')">
    <RouterLink :to="lp('/')" :aria-current="route.path === lp('/') ? 'page' : undefined">{{ $t('nav.board') }}</RouterLink>
    <RouterLink :to="lp('/library')" :aria-current="route.path === lp('/library') ? 'page' : undefined">{{ $t('library.title') }}</RouterLink>
    <RouterLink :to="lp('/mine')" :aria-current="route.path === lp('/mine') ? 'page' : undefined">{{ $t('nav.mine') }}</RouterLink>
  </nav>
  <main id="main" tabindex="-1" :class="{ 'site-main': !route.meta.bare, 'main--bare': route.meta.bare }"><RouterView /></main>
  <CoachTour />
  <ConfirmDialog />
  <!-- 裝到主畫面的提示：對話與遊戲頁是全螢幕的，不在那裡打擾 -->
  <!-- 卡片 App 網域的頁全是 bare，但「加到主畫面」的提示卡就在那裡 -->
  <InstallToast v-if="!route.meta.bare || isPlayHost()" />

  <!--
    社群維護的開源站：頁尾照開源專案的慣例，把人導去倉庫——回報問題、看原始碼、看授權都在那裡。
    連結分組放在 lib/footer-nav.ts：新入口先決定屬於哪一組，不再往同一排後面接。
  -->
  <footer v-if="SITE.repoUrl && !route.meta.bare" class="footer">
    <div class="footer__inner">
      <div class="footer__about">
        <p class="footer__name">{{ brandName }}</p>
        <p class="footer__tagline">{{ $t("footer.tagline") }}</p>
      </div>
      <nav class="footer__groups" :aria-label="$t('footer.links')">
        <section v-for="g in footerNav" :key="g.id" class="footer__group" :aria-labelledby="`footer-${g.id}`">
          <p :id="`footer-${g.id}`" class="footer__title">{{ $t(g.title) }}</p>
          <ul>
            <li v-for="l in g.links" :key="l.id">
              <RouterLink v-if="'to' in l" :to="{ path: lp(l.to), query: l.query }">{{ $t(l.label, l.labelArgs ?? {}) }}<NewMark v-if="l.newMark" :k="l.newMark" /></RouterLink>
              <a v-else-if="'action' in l" href="#" @click.prevent="openInstall()">{{ $t(l.label) }}</a>
              <a v-else :href="l.href" target="_blank" rel="noopener noreferrer" :title="l.id === 'github' ? $t('footer.github') : undefined">
                <CommunityIcon v-if="l.icon === 'discord'" name="discord" />
                <svg v-else-if="l.icon === 'github'" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" /></svg>
                {{ $t(l.label, l.labelArgs ?? {}) }}
              </a>
            </li>
          </ul>
        </section>
      </nav>
      <div class="footer__legal">
        <a v-for="l in legalNav" :key="l.id" :href="'href' in l ? l.href : undefined" target="_blank" rel="noopener noreferrer">{{ $t(l.label, l.labelArgs ?? {}) }}</a>
      </div>
    </div>
  </footer>
</template>

<style scoped>
/*
 * 內容區至少一整個螢幕高：頁尾永遠不在第一屏。不然頁面程式碼到之前頁尾在畫面底部，
 * 骨架一出現把它推走、空狀態又拉回來，手機上實測版面位移 0.46（2026-09-26，首頁）。
 */
.site-main { min-height: 100vh; min-height: 100dvh; padding-left: env(safe-area-inset-left, 0px); padding-right: env(safe-area-inset-right, 0px); }
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
.brand__mark { width: 24px; height: 24px; flex: none; fill: var(--accent); }
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
.gh svg { width: 18px; height: 18px; fill: currentColor; }

/* 頁尾：左邊是站名與一句話，右邊是分組連結，最底下一條放授權。手機上分組排成兩欄，不摺疊——每組就幾個連結，收起來反而多點一下。 */
.footer { padding: 0 env(safe-area-inset-right, 0px) env(safe-area-inset-bottom, 0px) env(safe-area-inset-left, 0px); border-top: 1px solid var(--border); margin-top: var(--s-7); }
.footer__inner {
  max-width: var(--page); margin: 0 auto; padding: var(--s-6) var(--s-5) var(--s-4);
  display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 2fr); gap: var(--s-5) var(--s-6);
  font-size: 13px; color: var(--text-3);
}
.footer__about { min-width: 0; }
.footer__name { margin: 0 0 var(--s-2); font-weight: 600; color: var(--text); font-size: 14px; }
.footer__tagline { margin: 0; line-height: 1.6; max-width: 22rem; }
.footer__groups { display: grid; grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); gap: var(--s-4) var(--s-5); }
.footer__title { margin: 0 0 var(--s-1); font-size: 12px; font-weight: 600; color: var(--text-3); }
.footer__group ul { list-style: none; margin: 0; padding: 0; }
.footer__group a { display: inline-flex; align-items: center; gap: 6px; min-height: 36px; color: var(--text-2); }
.footer__group a:hover, .footer__legal a:hover { color: var(--text); }
.footer__group svg { width: 15px; height: 15px; flex: none; }
.footer__group svg[viewBox="0 0 16 16"] { fill: currentColor; }
.footer__legal { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); padding-top: var(--s-4); border-top: 1px solid var(--line); font-size: 12px; }
.footer__legal a { color: var(--text-3); display: inline-flex; align-items: center; min-height: 32px; }
@media (max-width: 720px) {
  .footer__inner { grid-template-columns: minmax(0, 1fr); padding: var(--s-5) var(--s-4) var(--s-3); }
  .footer__groups { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .footer__group a { min-height: 44px; }
}

/* 站務入口較長；窄桌面將導覽放第二列，避免擠壓搜尋與帳號控制項。 */
.header__inner--reviewer .nav__item { white-space: nowrap; }
@media (min-width: 861px) and (max-width: 1280px) {
  .header__inner--reviewer { grid-template-columns: minmax(0, 1fr) auto; row-gap: 0; }
  .header__inner--reviewer .brand, .header__inner--reviewer .account { min-height: var(--header-h); }
  .header__inner--reviewer .nav { grid-column: 1 / -1; grid-row: 2; justify-content: center; padding-bottom: var(--s-2); }
  .header__inner--reviewer .search { display: none; }
  .header__inner--reviewer .search-go { display: inline-flex; }
}

/* 手機：一排收完。品牌與榜單同一個目的地，榜單那顆省掉；搜尋收成圖示。
   右邊那排（搜尋、外觀、語言、餘額、頭像）寬度由內容決定、不能疊；擠不下時讓位的是字標——
   品牌欄用 minmax(0, 1fr) 才會真的縮（grid 的 auto 欄不會低於內容寬），字標以省略號收尾，圖標永遠在。 */
@media (max-width: 860px) {
  .header__inner { grid-template-columns: minmax(0, 1fr) auto; column-gap: var(--s-3); padding: 0 var(--s-3); min-height: var(--header-h); }
  .nav, .search { display: none; }
  .search-go { display: inline-flex; }
  .account { min-width: 0; }
  .account > * { flex: none; }
}
/* 窄手機：餘額讓位（九位數的餘額會把字標擠成省略號）；帳號選單與錢包頁都還看得到它。
   門檻由實測定：字標＋搜尋、外觀、語言、餘額、頭像一排要 490px 左右才放得下。 */
@media (max-width: 500px) {
  .account :deep(.acct__credits) { display: none; }
  /* GitHub 圖示也讓位：頁尾每頁都有同一條連結，少它不少功能；留著字標會被擠成「Hearthro…」 */
  .gh { display: none; }
}
.mobile-library-nav { display:none; }
@media(max-width:860px) {
  .mobile-library-nav { display:flex; justify-content:center; gap:var(--s-3); padding:var(--s-2) var(--s-4); border-bottom:1px solid var(--border); }
  .mobile-library-nav a { display:flex; align-items:center; justify-content:center; min-height:44px; flex:1; border-radius:var(--r-pill); font-size:.875rem; text-align:center; }
  .mobile-library-nav a[aria-current=page] { color:var(--accent-text); background:var(--accent-tint); font-weight:600; }
}
</style>

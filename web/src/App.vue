<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import AccountMenu from "@/components/AccountMenu.vue";
import AppearanceMenu from "@/components/AppearanceMenu.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useAppearance } from "@/lib/appearance";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";

const { lp } = useLocalePath();
const session = useSession();
const route = useRoute();
const router = useRouter();

onMounted(() => { session.restore(); useAppearance().init(); });

/** 搜尋放在頁首，全站都搜得到；結果落在搜尋頁。按 / 直接聚焦。搜尋頁自己有一個大的，頁首那個就收起來。 */
const q = ref((route.query.q as string) ?? "");
const box = ref<HTMLInputElement | null>(null);
const onSearchPage = computed(() => route.path === lp("/search"));
watch(() => route.query.q, (v) => { q.value = (v as string) ?? ""; });

function search() {
  const term = q.value.trim();
  if (!term) return;
  router.push({ path: lp("/search"), query: { q: term } });
}
function onSlash(e: KeyboardEvent) {
  if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
  if ((e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  if (box.value?.offsetParent) box.value.focus();
  else if (onSearchPage.value) document.querySelector<HTMLInputElement>("main input[type=search]")?.focus();
  else router.push(lp("/search"));
}
onMounted(() => document.addEventListener("keydown", onSlash));
</script>

<template>
  <a class="skip" href="#main">{{ $t("nav.skip") }}</a>

  <header v-if="!route.meta.bare" class="header">
    <div class="header__inner" :class="{ 'header__inner--nosearch': onSearchPage }">
      <RouterLink :to="lp('/')" class="brand" :aria-label="SITE.name">
        <svg class="brand__mark" viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 3h14a3 3 0 0 1 3 3v9a3 3 0 0 1-3 3h-7.5L7 21.5V18H5a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3z" />
        </svg>
        <span class="brand__name">{{ SITE.name }}</span>
      </RouterLink>

      <nav class="nav">
        <RouterLink :to="lp('/')" class="nav__item" :class="{ 'nav__item--on': route.path === lp('/') }">{{ $t("nav.board") }}</RouterLink>
        <RouterLink v-if="session.me" :to="lp('/mine')" class="nav__item" active-class="nav__item--on">{{ $t("nav.mine") }}</RouterLink>
      </nav>

      <form v-if="!onSearchPage" class="search" role="search" @submit.prevent="search">
        <svg class="search__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <input
          ref="box"
          v-model="q"
          class="search__input"
          type="search"
          :placeholder="$t('board.search.placeholder')"
          :aria-label="$t('board.search.submit')"
        />
        <kbd class="search__kbd" aria-hidden="true">/</kbd>
      </form>

      <div class="account">
        <!-- 手機沒有那一排搜尋框：一顆圖示進搜尋頁，那裡有大的 -->
        <RouterLink v-if="!onSearchPage" :to="lp('/search')" class="search-go" :aria-label="$t('board.search.submit')">
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
            <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
          </svg>
        </RouterLink>
        <AppearanceMenu />
        <LocaleSwitch />
        <AccountMenu v-if="session.me" />
        <button v-else-if="session.ready" class="btn btn--primary btn--sm" @click="session.login(route.fullPath)">
          {{ $t("nav.login") }}
        </button>
      </div>
    </div>
  </header>

  <main id="main" tabindex="-1" :class="{ 'main--bare': route.meta.bare }"><RouterView /></main>
  <ConfirmDialog />

  <footer v-if="SITE.repoUrl && !route.meta.bare" class="footer">
    <div class="footer__inner">
      <a :href="SITE.repoUrl" target="_blank" rel="noopener">{{ $t("footer.source") }} ↗</a>
    </div>
  </footer>
</template>

<style scoped>
.header {
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

.brand { display: inline-flex; align-items: center; gap: 8px; }
.brand__mark { width: 24px; height: 24px; fill: var(--accent); }
.brand__name { font-size: 18px; font-weight: 700; letter-spacing: -0.02em; }

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
.search__input {
  width: 100%; height: var(--h-md); padding: 0 var(--s-4) 0 36px;
  font: inherit; font-size: 14px; color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent; border-radius: var(--r-pill);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.search__input::placeholder { color: var(--text-3); }
.search__input:focus { outline: none; background: var(--surface); border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search__input::-webkit-search-cancel-button { -webkit-appearance: none; }
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
  display: none; align-items: center; justify-content: center; flex: none;
  width: 34px; height: 34px; border-radius: var(--r-pill); color: var(--text-2);
}
.search-go:hover { background: var(--surface-2); color: var(--text); }
.search-go svg { width: 18px; height: 18px; }

.footer { border-top: 1px solid var(--border); margin-top: var(--s-7); }
.footer__inner { max-width: var(--page); margin: 0 auto; padding: var(--s-5); font-size: 12.5px; color: var(--text-3); }
.footer__inner a:hover { color: var(--text-2); }

/* 手機：一排收完。品牌與榜單同一個目的地，榜單那顆省掉；搜尋收成圖示 */
@media (max-width: 860px) {
  .header__inner { grid-template-columns: auto 1fr; column-gap: var(--s-3); padding: 0 var(--s-3); min-height: 52px; }
  .nav, .search { display: none; }
  .search-go { display: inline-flex; }
  .account { min-width: 0; }
  .account > * { flex: none; }
}
/* 最窄的手機：餘額讓位給搜尋圖示；帳號選單與錢包頁都還看得到它 */
@media (max-width: 400px) {
  .account :deep(.acct__credits) { display: none; }
}
</style>

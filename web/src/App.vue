<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import AccountMenu from "@/components/AccountMenu.vue";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";

const { lp } = useLocalePath();
const session = useSession();
const route = useRoute();
const router = useRouter();

onMounted(() => session.restore());

/** 搜尋放在頁首，全站都搜得到；結果一律落在榜單。 */
const q = ref((route.query.q as string) ?? "");
watch(() => route.query.q, (v) => { q.value = (v as string) ?? ""; });

function search() {
  const term = q.value.trim();
  router.push({ path: lp("/"), query: term ? { q: term } : {} });
}
</script>

<template>
  <header class="header">
    <div class="header__inner">
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

      <form class="search" role="search" @submit.prevent="search">
        <svg class="search__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7" />
          <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" />
        </svg>
        <input
          v-model="q"
          class="search__input"
          type="search"
          :placeholder="$t('board.search.placeholder')"
          :aria-label="$t('board.search.submit')"
        />
      </form>

      <div class="account">
        <LocaleSwitch />
        <AccountMenu v-if="session.me" />
        <button v-else-if="session.ready" class="btn btn--primary btn--sm" @click="session.login(route.fullPath)">
          {{ $t("nav.login") }}
        </button>
      </div>
    </div>
  </header>

  <main><RouterView /></main>

  <footer v-if="SITE.repoUrl" class="footer">
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
  width: 100%; height: 38px; padding: 0 var(--s-4) 0 36px;
  font: inherit; font-size: 14px; color: var(--text);
  background: var(--surface-2);
  border: 1px solid transparent; border-radius: var(--r-pill);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.search__input::placeholder { color: var(--text-3); }
.search__input:focus { outline: none; background: var(--surface); border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-soft); }
.search__input::-webkit-search-cancel-button { -webkit-appearance: none; }

.account { display: flex; align-items: center; gap: var(--s-2); }

.footer { border-top: 1px solid var(--border); margin-top: var(--s-7); }
.footer__inner { max-width: var(--page); margin: 0 auto; padding: var(--s-5); font-size: 12.5px; color: var(--text-3); }
.footer__inner a:hover { color: var(--text-2); }

@media (max-width: 860px) {
  .header__inner {
    grid-template-columns: auto 1fr auto; column-gap: var(--s-3);
    padding: var(--s-2) var(--s-4);
  }
  .account { grid-row: 1; grid-column: 3; }
  .search { grid-row: 2; grid-column: 1 / -1; max-width: none; margin-top: var(--s-2); }
  .nav__item { padding: 0 10px; }
}
</style>

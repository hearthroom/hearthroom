<script setup lang="ts">
import { onMounted, ref, watch } from "vue";
import { RouterLink, RouterView, useRoute, useRouter } from "vue-router";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";

const { lp } = useLocalePath();
const session = useSession();
const route = useRoute();
const router = useRouter();

onMounted(() => session.restore());

/**
 * 搜尋放在頁首，全站都搜得到；結果一律落在榜單。
 * 在榜單上搜時保留目前的語區——搜尋不該把人從自己看得懂的那一區踢出去。
 */
const q = ref((route.query.q as string) ?? "");
watch(() => route.query.q, (v) => { q.value = (v as string) ?? ""; });

function search() {
  const query: Record<string, string> = {};
  const term = q.value.trim();
  if (term) query.q = term;
  if (typeof route.query.zone === "string") query.zone = route.query.zone;
  router.push({ path: lp("/"), query });
}
</script>

<template>
  <header class="masthead">
    <div class="masthead__inner">
      <RouterLink :to="lp('/')" class="wordmark">
        <span class="wordmark__mark">✦</span>
        <span class="wordmark__text display">{{ SITE.name }}</span>
      </RouterLink>

      <nav class="nav">
        <RouterLink :to="lp('/')" :class="{ 'router-link-active': route.path === lp('/') }">{{ $t("nav.board") }}</RouterLink>
        <RouterLink v-if="session.me" :to="lp('/mine')">{{ $t("nav.mine") }}</RouterLink>
      </nav>

      <form class="search" role="search" @submit.prevent="search">
        <svg class="search__icon" viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" stroke-width="1.6" />
          <path d="M12.8 12.8 17 17" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" />
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
        <template v-if="session.me">
          <RouterLink :to="lp(`/authors/${session.me.accountNumId}`)" class="account__me">
            <img v-if="session.me.avatar" :src="session.me.avatar" alt="" />
            <span>{{ session.me.nickName }}</span>
          </RouterLink>
          <button class="btn btn--ghost btn--sm" @click="session.logout()">{{ $t("nav.logout") }}</button>
        </template>
        <button
          v-else-if="session.ready"
          class="btn btn--primary btn--sm"
          @click="session.login(route.fullPath)"
        >
          {{ $t("nav.login") }}
        </button>
      </div>
    </div>
  </header>

  <main><RouterView /></main>

  <footer class="colophon">
    <div class="colophon__inner">
      <p>{{ $t("footer.blurb") }}</p>
      <a v-if="SITE.repoUrl" :href="SITE.repoUrl" target="_blank" rel="noopener">{{ $t("footer.source") }} ↗</a>
    </div>
  </footer>
</template>

<style scoped>
.masthead {
  position: sticky; top: 0; z-index: 30;
  border-bottom: 1px solid var(--rule);
  background: rgba(16, 14, 11, 0.86);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
}
.masthead__inner {
  max-width: var(--page); margin: 0 auto; min-height: var(--masthead-h);
  padding: 0 var(--s-5);
  display: grid; grid-template-columns: auto auto minmax(0, 1fr) auto;
  align-items: center; gap: var(--s-6);
}

.wordmark { display: inline-flex; align-items: baseline; gap: var(--s-2); }
.wordmark__mark { color: var(--gold); font-size: 12px; transform: translateY(-2px); }
.wordmark__text { font-size: 23px; letter-spacing: 0.01em; }

.nav { display: flex; gap: var(--s-5); font-size: 14px; }
.nav a { color: var(--text-faint); transition: color var(--dur) var(--ease); }
.nav a:hover { color: var(--text-dim); }
.nav a.router-link-active {
  color: var(--text);
  box-shadow: inset 0 -1px 0 0 var(--gold);
}

/* 搜尋框置中、有上限：太寬會變成一條橫貫全頁的槽，視覺上把左右兩組東西隔開 */
.search {
  position: relative; justify-self: center; width: 100%; max-width: 420px;
}
.search__icon {
  position: absolute; left: 14px; top: 50%; width: 15px; height: 15px;
  transform: translateY(-50%); color: var(--text-faint); pointer-events: none;
}
.search__input {
  width: 100%; height: 36px; padding: 0 var(--s-4) 0 38px;
  font: inherit; font-size: 13.5px; color: var(--text);
  background: var(--paper-sunken);
  border: 1px solid var(--rule); border-radius: var(--r-pill);
  transition: border-color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.search__input::placeholder { color: var(--text-faint); }
.search__input:focus { outline: none; border-color: var(--gold-deep); background: var(--paper-raised); }
.search__input::-webkit-search-cancel-button { -webkit-appearance: none; }

.account { display: flex; align-items: center; gap: var(--s-3); }
.account__me { display: inline-flex; align-items: center; gap: var(--s-2); font-size: 13px; color: var(--text-dim); }
.account__me img { width: 26px; height: 26px; border-radius: var(--r-pill); }
.account__me:hover { color: var(--text); }

.colophon { border-top: 1px solid var(--rule); margin-top: var(--s-7); }
.colophon__inner {
  max-width: var(--page); margin: 0 auto; padding: var(--s-5);
  display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: space-between; align-items: baseline;
  font-size: 12.5px; color: var(--text-faint);
}
.colophon__inner p { margin: 0; max-width: 62ch; }
.colophon__inner a:hover { color: var(--text-dim); }

@media (max-width: 860px) {
  /* 小螢幕：搜尋框退到第二行、佔滿；其餘三組擠在第一行 */
  .masthead__inner {
    grid-template-columns: auto 1fr auto; row-gap: 0; column-gap: var(--s-4);
    padding-top: var(--s-2); padding-bottom: var(--s-2);
  }
  /* 明確指定行列：不指定的話搜尋框在 DOM 裡排在帳號區前面，會把它擠到第三行 */
  .account { grid-row: 1; grid-column: 3; }
  .search { grid-row: 2; grid-column: 1 / -1; max-width: none; margin-top: var(--s-2); }
  .wordmark__text { font-size: 19px; }
  .account__me span { display: none; }
}
</style>

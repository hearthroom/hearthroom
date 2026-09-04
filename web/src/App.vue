<script setup lang="ts">
import { onMounted } from "vue";
import { RouterLink, RouterView, useRoute } from "vue-router";
import LocaleSwitch from "@/components/LocaleSwitch.vue";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";

const { lp } = useLocalePath();

const session = useSession();
const route = useRoute();

onMounted(() => session.restore());
</script>

<template>
  <header class="masthead">
    <div class="masthead__inner">
      <RouterLink :to="lp('/')" class="wordmark">
        <span class="wordmark__mark">✦</span>
        <span class="wordmark__text display">{{ SITE.name }}</span>
      </RouterLink>

      <nav class="nav">
        <RouterLink :to="lp('/')">{{ $t("nav.board") }}</RouterLink>
        <RouterLink v-if="session.me" :to="lp('/mine')">{{ $t("nav.mine") }}</RouterLink>
      </nav>

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
  background: rgba(16, 14, 11, 0.82);
  backdrop-filter: blur(16px) saturate(1.4);
  -webkit-backdrop-filter: blur(16px) saturate(1.4);
}
.masthead__inner {
  max-width: var(--page); margin: 0 auto;
  padding: var(--s-3) var(--s-5);
  display: flex; align-items: center; gap: var(--s-6);
}

.wordmark { display: inline-flex; align-items: baseline; gap: var(--s-2); flex: none; }
.wordmark__mark { color: var(--gold); font-size: 13px; transform: translateY(-1px); }
.wordmark__text { font-size: 21px; letter-spacing: 0; }

.nav { display: flex; gap: var(--s-5); margin-right: auto; font-size: 14px; }
.nav a { color: var(--text-faint); transition: color var(--dur) var(--ease); }
.nav a:hover { color: var(--text-dim); }
/* 目前所在的頁用金色下劃線標記，不換字重——換字重會讓那一項的寬度跳動 */
.nav a.router-link-active {
  color: var(--text);
  box-shadow: inset 0 -1px 0 0 var(--gold);
}

.account { display: flex; align-items: center; gap: var(--s-3); flex: none; }
.account__me { display: inline-flex; align-items: center; gap: var(--s-2); font-size: 13px; color: var(--text-dim); }
.account__me img { width: 26px; height: 26px; border-radius: var(--r-pill); }
.account__me:hover { color: var(--text); }

.colophon { border-top: 1px solid var(--rule); margin-top: var(--s-8); }
.colophon__inner {
  max-width: var(--page); margin: 0 auto; padding: var(--s-5);
  display: flex; flex-wrap: wrap; gap: var(--s-3); justify-content: space-between; align-items: baseline;
  font-size: 12.5px; color: var(--text-faint);
}
.colophon__inner p { margin: 0; max-width: 62ch; }
.colophon__inner a:hover { color: var(--text-dim); }

@media (max-width: 640px) {
  .masthead__inner { gap: var(--s-4); }
  .wordmark__text { font-size: 18px; }
  .nav { gap: var(--s-4); }
}
</style>

<script setup lang="ts">
/**
 * 換線到站但登入沒帶過來（過場頁上選了「直接進入」）：頁首與手機分頁列之下、內容流裡的一條中性說明，
 * 推開內容而不浮在上面。框內的「登入」是中性按鈕，頁首那顆仍是唯一的主行動（ui.md §6.4，美術總監 #9）。
 */
import { watch } from "vue";
import { useRoute } from "vue-router";
import { loginPath } from "@/lib/login-return";
import { routesState } from "@/lib/routes";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";

const route = useRoute();
const session = useSession();
const { lp } = useLocalePath();
watch(() => session.me, (me) => { if (me) routesState.arrivedSignedOut = false; });
</script>

<template>
  <div v-if="routesState.arrivedSignedOut && !session.me" class="arrival">
    <p class="notice arrival__box" role="status">
      <span class="arrival__text">{{ $t("routes.arrivedSignedOut") }}</span>
      <RouterLink class="btn btn--sm" :to="lp(loginPath(route.fullPath))">{{ $t("nav.login") }}</RouterLink>
      <button type="button" class="btn btn--icon btn--sm btn--ghost" :aria-label="$t('dialog.close')" @click="routesState.arrivedSignedOut = false">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
      </button>
    </p>
  </div>
</template>

<style scoped>
.arrival { max-width: var(--page); margin: var(--s-3) auto 0; padding: 0 var(--s-5); }
.arrival__box { margin: 0; display: flex; align-items: center; gap: var(--s-2); padding-block: var(--s-2); }
.arrival__text { flex: 1; min-width: 0; }
.arrival__box svg { width: 16px; height: 16px; }
@media (max-width: 640px) { .arrival { padding: 0 var(--s-4); } }
</style>

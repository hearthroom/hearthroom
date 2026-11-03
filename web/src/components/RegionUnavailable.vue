<script setup lang="ts">
/**
 * 「這張卡片在你目前的國家／地區暫不提供」（owner 2026-11-03，照 App Store／Google Play／Steam 的區域不可用提示）。
 * 卡片頁、遊玩頁（含分享連結、舊聊天連結）收到 403 region_unavailable 時畫這一頁：不是 404、不是成人內容的門。
 * 遊玩頁走到這裡時舞台不掛、不建立對話連線。
 *
 * 產品在說話，不讓蘇綺出場：限制與法規的事要準確，不要可愛（product-copy）。頁面不放她的插圖，
 * 全站的桌寵也在這一頁退場（pageAway），免得她的泡泡台詞貼在法規限制旁邊。
 * 拒絕次數由伺服器的 hearthroom_country_region_operations_total 計，這裡不另外打點。
 * href：遊玩子網域沒有站內路由，回榜單要走完整網址。
 */
import { onBeforeUnmount, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { pageAway } from "@/pet/enabled";

defineProps<{ href?: string }>();
const { lp } = useLocalePath();
const { t } = useI18n();
onMounted(() => {
  document.title = pageTitle(t("region.unavailable.title"));
  pageAway.value++;
});
onBeforeUnmount(() => { pageAway.value--; });
</script>

<template>
  <div class="page region">
    <svg class="region__icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3Z" />
    </svg>
    <h1 class="region__title">{{ $t("region.unavailable.title") }}</h1>
    <p class="region__hint muted">{{ $t("region.unavailable.hint") }}</p>
    <a v-if="href" class="btn btn--primary" :href="href">{{ $t("notFound.back") }}</a>
    <RouterLink v-else :to="lp('/')" class="btn btn--primary">{{ $t("notFound.back") }}</RouterLink>
  </div>
</template>

<style scoped>
.region { padding-top: var(--s-7); padding-bottom: var(--s-7); display: flex; flex-direction: column; align-items: center; text-align: center; }
.region__icon { width: 48px; height: 48px; color: var(--text-3); }
.region__title { margin: var(--s-4) 0 var(--s-2); max-width: 32em; font-size: 22px; font-weight: 700; text-wrap: balance; overflow-wrap: anywhere; }
/* 兩行以內的短句：balance 讓兩行等長，不留「提供。」這種孤字 */
.region__hint { margin: 0 0 var(--s-5); max-width: 32em; text-wrap: balance; overflow-wrap: anywhere; }
.region__title:lang(ko), .region__hint:lang(ko) { word-break: keep-all; }
/* 日文不在詞中間斷行（コンテ／ンツ）；不支援的瀏覽器照舊逐字斷 */
.region__title:lang(ja), .region__hint:lang(ja) { word-break: auto-phrase; }
</style>

<script setup lang="ts">
/**
 * 限時積分到期提醒（ui.md §7.1）：最早一批在今天或明天到期才出現。不是錯誤，用提醒色不用紅。
 * 簽到頁與錢包頁共用；明細在錢包頁。
 */
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { expiryNotice } from "@/lib/checkin";
import { hourMinute, whole } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ expiring: { amount: number; expiresAt: string }[]; now: number }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const notice = computed(() => expiryNotice(props.expiring, props.now));
</script>

<template>
  <div v-if="notice" class="expiry notice" role="status">
    <span class="expiry__text">{{ t(notice.key, { n: whole(notice.n), time: hourMinute(notice.at) }) }}</span>
    <RouterLink :to="lp('/library')" class="btn btn--sm">{{ t("credits.expiry.action") }}</RouterLink>
  </div>
</template>

<style scoped>
.expiry { display:flex; align-items:center; justify-content:space-between; gap:var(--s-3); color:var(--warning-text); }
.expiry__text { min-width:0; text-wrap:pretty; }
.expiry .btn { flex:none; }
</style>

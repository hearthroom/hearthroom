<script setup lang="ts">
/**
 * 送審畫面上連到創作季的一行（我的卡片額度下方、編輯器送審說明下方），整行可點到活動頁。
 * 只在活動進行中出現：以伺服器回傳的活動階段為準（openCardReward），結束後就不再出現。
 * 活動的程式碼等頁面畫好才下載；讀不到就什麼都不畫。
 */
import { computed, onMounted, shallowRef } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import type { CardRewardCampaign } from "@/lib/campaign";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ where: "mine" | "editor" }>();
const { t } = useI18n();
const { lp, locale } = useLocalePath();

const campaign = shallowRef<CardRewardCampaign | null>(null);
const format = shallowRef<((n: number) => string) | null>(null);
onMounted(async () => {
  try {
    const m = await import("@/lib/campaign");
    format.value = m.formatNumber;
    campaign.value = await m.openCardReward();
  } catch { /* 讀不到就不出現 */ }
});

const text = computed(() => {
  const c = campaign.value;
  if (!c || !format.value) return "";
  // 結束日是最後一天（結束時刻前 1 毫秒），用活動的時區
  const end = new Intl.DateTimeFormat(locale.value, { timeZone: c.timezone, month: "short", day: "numeric" }).format(c.endsAt - 1);
  const credits = format.value(c.reward);
  return props.where === "mine" ? t("mine.campaign.publishReward", { end, credits, limit: c.weeklyLimit }) : t("editor.publish.reward", { end, credits });
});
</script>

<template>
  <RouterLink v-if="campaign && text" class="entry" :class="`entry--${where}`" data-creator-entry :to="lp(`/campaign/${campaign.slug}`)">
    <span class="entry__text">{{ text }}</span>
    <span v-if="where === 'mine'" class="entry__more">{{ t("creator.entry.details") }}<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg></span>
  </RouterLink>
</template>

<style scoped>
.entry { display: inline; font-size: 12.5px; line-height: 1.6; color: var(--text-3); text-decoration: none; }
.entry:hover .entry__text { text-decoration: underline; text-underline-offset: 3px; }
.entry__more { display: inline-flex; align-items: center; margin-left: 4px; color: var(--accent-text); font-weight: 600; white-space: nowrap; }
.entry__more svg { width: 14px; height: 14px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; vertical-align: middle; }
.entry--editor { display: block; margin-top: var(--s-1); }
</style>

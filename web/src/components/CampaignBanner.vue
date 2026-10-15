<script setup lang="ts">
/**
 * 首頁的分享活動橫幅：有進行中的活動才出現，整張連到活動頁。
 *
 * 首頁每掛載一次就匿名取一次活動列表，取第一個進行中的；資料回來之前什麼都不畫（不放骨架：
 * 可能根本沒有這張橫幅）。有橫幅圖就放圖，沒有就是文字卡。關掉的記錄以活動 slug 為鍵存在這個瀏覽器，
 * 換一檔活動會再出現；儲存讀寫失敗當作沒關過。不跟下載橫幅或更新提示列互相讓位。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { fetchPublicCampaigns, formatPeriod, localized, type CampaignSummary } from "@/lib/campaign";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp, locale } = useLocalePath();
const campaign = ref<CampaignSummary | null>(null);
const closed = ref(false);

const dismissKey = (slug: string) => `hearthroom.campaignBanner.dismissed.${slug}`;
function wasDismissed(slug: string) {
  try { return localStorage.getItem(dismissKey(slug)) !== null; } catch { return false; }
}
onMounted(async () => {
  const open = (await fetchPublicCampaigns().catch(() => null))?.items?.find((c) => c.phase === "open");
  if (open && !wasDismissed(open.slug)) campaign.value = open;
});

const visible = computed(() => (campaign.value && !closed.value ? campaign.value : null));
const title = computed(() => (visible.value ? localized(visible.value.title, locale.value) || visible.value.slug : ""));
const period = computed(() => (visible.value ? formatPeriod(visible.value, locale.value) : ""));

function close() {
  closed.value = true;
  try { localStorage.setItem(dismissKey(campaign.value!.slug), String(Date.now())); } catch { /* 存不進去就只在這次載入收起來 */ }
}
const clicked = () => track("cta", { detail: "clicked", subject: campaign.value!.slug });
</script>

<template>
  <aside v-if="visible" class="campaign-banner">
    <RouterLink class="campaign-banner__link" :to="lp(`/campaign/${visible.slug}`)" @click="clicked">
      <img v-if="visible.bannerUrl" class="campaign-banner__img" :src="visible.bannerUrl" :alt="title" />
      <span v-else class="campaign-banner__text">
        <strong>{{ title }}</strong>
        <span v-if="period" class="campaign-banner__period">{{ period }}</span>
        <span class="campaign-banner__go">{{ t("campaign.banner.cta") }} →</span>
      </span>
    </RouterLink>
    <button type="button" class="btn btn--icon btn--sm btn--ghost campaign-banner__close" :aria-label="t('campaign.banner.dismiss')" @click="close">
      <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M5 5l10 10M15 5L5 15" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none" /></svg>
    </button>
  </aside>
</template>

<style scoped>
.campaign-banner { position: relative; margin-bottom: var(--s-5); border: 1px solid var(--border); border-radius: var(--r-lg); background: var(--accent-tint); overflow: hidden; }
.campaign-banner__link { display: block; color: var(--text); }
.campaign-banner__img { display: block; width: 100%; aspect-ratio: 16 / 6; object-fit: cover; background: var(--surface-2); }
.campaign-banner__text { display: grid; gap: var(--s-1); padding: var(--s-4) var(--s-5); padding-right: calc(var(--s-5) + 32px); min-height: 44px; }
.campaign-banner__text strong { font-weight: 600; }
.campaign-banner__period { color: var(--text-2); font-size: .875rem; }
.campaign-banner__go { color: var(--accent-text); font-weight: 600; font-size: .875rem; }
.campaign-banner__close { position: absolute; top: var(--s-2); right: var(--s-2); background: var(--surface); }
.campaign-banner__close svg { width: 16px; height: 16px; }
</style>

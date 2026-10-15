<script setup lang="ts">
/**
 * 文章裡的活動區塊（開頭與文末各一個）：狀態、活動期間（用活動自己的時區）、前往申請。
 * 草稿活動服務端本來就不給；這裡再擋一次。點「前往申請」記 blog_cta，subject 是文章 slug。
 */
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { useI18n } from "vue-i18n";
import { formatPeriod, localized } from "@/lib/campaign";
import type { CampaignBrief } from "@/lib/blog";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ campaign: CampaignBrief; subject: string; at: "top" | "end" }>();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const period = computed(() => formatPeriod(props.campaign, locale.value));
</script>

<template>
  <aside v-if="campaign.phase !== 'draft'" class="blog-campaign" :data-campaign-block="at">
    <div class="blog-campaign__text">
      <span class="blog-campaign__phase" :class="`blog-campaign__phase--${campaign.phase}`">{{ t(`campaign.phase.${campaign.phase}`) }}</span>
      <strong class="blog-campaign__title">{{ localized(campaign.title, locale) || campaign.slug }}</strong>
      <span v-if="period" class="blog-campaign__period">{{ t("blog.campaign.period") }} · {{ period }}</span>
    </div>
    <RouterLink class="btn btn--primary btn--sm blog-campaign__go" :to="lp(`/campaign/${campaign.slug}`)" @click="track('blog_cta', { subject })">{{ t("blog.campaign.apply") }}</RouterLink>
  </aside>
</template>

<style scoped>
.blog-campaign {
  display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: var(--s-3) var(--s-4);
  max-width: 80ch; padding: var(--s-4); border-radius: var(--r-lg); background: var(--accent-tint);
}
.blog-campaign__text { display: grid; gap: var(--s-1); min-width: 0; justify-items: start; }
.blog-campaign__title { font-size: 15px; line-height: 1.45; overflow-wrap: anywhere; }
.blog-campaign__period { font-size: 13px; color: var(--text-2); }
.blog-campaign__phase { padding: 1px 8px; border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface); color: var(--text-2); }
.blog-campaign__phase--open { background: var(--success-soft); color: var(--success); }
.blog-campaign__phase--upcoming { color: var(--accent-text); }
@media (max-width: 760px) { .blog-campaign__go { min-height: 44px; } }
</style>

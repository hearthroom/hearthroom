<script setup lang="ts">
/**
 * 活動中心 /campaigns：所有公開的活動，照階段分成進行中、即將開始、已結束三個頁籤，加上「我參加的」。
 *
 * 頁籤在網址上（?tab=），分享出去、上一頁都回得到。沒指定時看有什麼：有進行中的看進行中，沒有就看即將開始，再沒有就看已結束。
 * 每個活動一張卡，整張連到活動頁：有橫幅圖放圖，沒有就是淡淡的強調色底（跟活動頁頁頭同一個意思）。
 * 「我參加的」是原本的「我的分享申請」，訪客看得到頁籤，點進去請他登入。舊網址 /me/campaign 轉到這裡。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import CampaignMine from "@/components/CampaignMine.vue";
import { HUB_TABS, defaultHubTab, fetchPublicCampaigns, formatPeriod, hubList, localized, type CampaignSummary, type HubTab } from "@/lib/campaign";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp, locale } = useLocalePath();
const route = useRoute();

const items = ref<CampaignSummary[] | null>(null);
const failed = ref(false);
async function load() {
  failed.value = false;
  try {
    items.value = (await fetchPublicCampaigns()).items;
  } catch {
    failed.value = true;
  }
}
onMounted(load);
watch(locale, () => { document.title = pageTitle(t("campaign.hub.title")); }, { immediate: true });

const asked = computed(() => (HUB_TABS as readonly string[]).includes(String(route.query.tab)) ? (route.query.tab as HubTab) : null);
/** 網址沒指定、列表還沒回來時是 null：先放骨架，不先亮一個等一下又換掉的頁籤 */
const tab = computed<HubTab | null>(() => asked.value ?? (items.value ? defaultHubTab(items.value) : failed.value ? "open" : null));
const cards = computed(() => (items.value && tab.value && tab.value !== "mine" ? hubList(items.value, tab.value) : []).map((c) => ({
  ...c, name: localized(c.title, locale.value) || c.slug, period: formatPeriod(c, locale.value),
})));
const to = (k: HubTab) => ({ path: lp("/campaigns"), query: { ...route.query, tab: k } });
</script>

<template>
  <div class="page hub">
    <h1 class="display hub__title">{{ t("campaign.hub.title") }}</h1>

    <nav class="seg hub__tabs" :aria-label="t('campaign.hub.tabs')">
      <RouterLink
        v-for="k in HUB_TABS" :key="k" :to="to(k)" replace class="seg__item hub__tab" :class="{ 'seg__item--on': tab === k }"
        :aria-current="tab === k ? 'page' : undefined" :data-tab="k"
      >{{ t(`campaign.hub.tab.${k}`) }}</RouterLink>
    </nav>

    <CampaignMine v-if="tab === 'mine'" />

    <template v-else>
      <p v-if="failed" class="notice notice--error" role="alert">
        {{ t("campaign.hub.error") }}
        <button type="button" class="btn btn--sm" @click="load()">{{ t("campaign.page.retry") }}</button>
      </p>

      <div v-else-if="!items || !tab" class="hub__grid" aria-hidden="true">
        <div v-for="i in 2" :key="i" class="ghost hub__ghost" />
      </div>

      <p v-else-if="!cards.length" class="hub__empty" data-empty>{{ t(`campaign.hub.empty.${tab}`) }}</p>

      <ul v-else class="hub__grid">
        <li v-for="c in cards" :key="c.slug">
          <RouterLink class="panel hub__card" :class="{ 'hub__card--banner': c.bannerUrl }" :to="lp(`/campaign/${c.slug}`)" :data-campaign="c.slug">
            <img v-if="c.bannerUrl" class="hub__banner" :src="c.bannerUrl" alt="" loading="lazy" decoding="async" />
            <svg v-else class="hub__mark" viewBox="0 0 48 48" aria-hidden="true"><path d="M24 4c1.6 9.6 10.4 18.4 20 20-9.6 1.6-18.4 10.4-20 20-1.6-9.6-10.4-18.4-20-20 9.6-1.6 18.4-10.4 20-20z" /></svg>
            <span class="hub__body">
              <span class="hub__phase" :class="`hub__phase--${c.phase}`">{{ t(`campaign.phase.${c.phase}`) }}</span>
              <strong class="hub__name">{{ c.name }}</strong>
              <span v-if="c.period" class="hub__period">{{ c.period }}</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </template>
  </div>
</template>

<style scoped>
.hub { max-width: 960px; display: grid; gap: var(--s-5); align-content: start; }
.hub__title { margin: 0; font-size: 28px; line-height: 1.3; }
.hub__tabs { justify-self: start; }
.hub__tab { display: inline-flex; align-items: center; text-decoration: none; }

.hub__grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-4); }
.hub__grid > li { display: grid; min-width: 0; }
.hub__ghost { height: 220px; border-radius: var(--r-lg); }
.hub__empty { margin: 0; padding: var(--s-6) var(--s-5); border-radius: var(--r-lg); background: var(--surface-2); color: var(--text-2); font-size: 14px; text-align: center; }

.hub__card {
  position: relative; overflow: hidden; isolation: isolate; display: flex; flex-direction: column;
  min-height: 200px; color: var(--text); text-decoration: none;
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.hub__card:hover { box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md); transform: translateY(-1px); }
/* 沒有橫幅圖：卡片本身就是一塊淡淡的強調色，右上一圈淡淡的環（同活動頁頁頭） */
.hub__card:not(.hub__card--banner) {
  justify-content: flex-end;
  background:
    radial-gradient(70% 120% at 100% 0%, var(--accent-soft), transparent 70%),
    linear-gradient(180deg, var(--accent-tint), var(--surface));
}
/* 右上一組同心環加一顆星，跟首頁輪播沒有圖的那張同一套 */
.hub__card:not(.hub__card--banner)::before,
.hub__card:not(.hub__card--banner)::after { content: ""; position: absolute; z-index: -1; border-radius: var(--r-pill); pointer-events: none; }
.hub__card:not(.hub__card--banner)::before { top: -50px; right: -40px; width: 220px; height: 220px; border: 26px solid color-mix(in srgb, var(--accent) 8%, transparent); }
.hub__card:not(.hub__card--banner)::after { top: 0; right: 10px; width: 120px; height: 120px; border: 2px solid color-mix(in srgb, var(--accent) 20%, transparent); }
.hub__mark { position: absolute; z-index: -1; top: 40px; right: 50px; width: 40px; height: 40px; fill: color-mix(in srgb, var(--accent) 55%, transparent); }
.hub__banner { display: block; width: 100%; aspect-ratio: 16 / 6; object-fit: cover; background: var(--surface-2); }
.hub__body { display: grid; gap: var(--s-2); justify-items: start; padding: var(--s-5); }
.hub__phase {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
  border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2);
}
.hub__phase::before { content: ""; width: 6px; height: 6px; border-radius: var(--r-pill); background: currentColor; }
.hub__phase--open { background: var(--success-soft); color: var(--success); }
.hub__phase--upcoming { background: var(--accent-soft); color: var(--accent-text); }
.hub__name { font-size: 20px; font-weight: 700; line-height: 1.3; overflow-wrap: anywhere; }
.hub__period { font-size: 13px; color: var(--text-2); font-variant-numeric: tabular-nums; }

@media (max-width: 760px) {
  .hub { gap: var(--s-4); }
  .hub__title { font-size: 24px; }
  /* 四個頁籤平分一整列，五種語言都放得下 */
  .hub__tabs { justify-self: stretch; display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); }
  .hub__tab { justify-content: center; height: 40px; padding: 0 var(--s-2); }
  .hub__grid { grid-template-columns: 1fr; gap: var(--s-3); }
  .hub__card { min-height: 160px; }
  .hub__body { padding: var(--s-4); }
  .hub__name { font-size: 18px; }
}
</style>

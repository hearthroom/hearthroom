<script setup lang="ts">
/**
 * 公開活動頁 /campaign/:slug：頁頭（橫幅、名稱、狀態、期間與截止）、介紹、獎勵規則、參加方式、提醒、申請區、我的分享連結。
 * 訪客看得到全部規則，申請區請他登入後回到這一頁（?s= 進站時已記在瀏覽器，登入後綁定，見 lib/share-ref.ts）。只有登入且活動進行中才有申請表。
 * 金額與時間全部讀 API，時間用活動自己的時區。進頁成功記一次 campaign_view（同一個 slug 重新讀不再記）。
 */
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import CampaignApplyForm from "@/components/CampaignApplyForm.vue";
import CampaignShareLinks from "@/components/CampaignShareLinks.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import { ApiError } from "@/lib/api";
import {
  TIERS, campaignErrorText, fetchCampaign, fetchMyContents, formatNumber, formatPeriod, formatPoints, localized,
  type ApplyResult, type ContentView, type PublicCampaign,
} from "@/lib/campaign";
import { pageTitle } from "@/lib/i18n";
import { loginPath } from "@/lib/login-return";
import { renderDoc } from "@/lib/markdown-toc";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const route = useRoute();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const session = useSession();

const slug = computed(() => String(route.params.slug ?? ""));
const campaign = ref<PublicCampaign | null>(null);
const missing = ref(false);
const failed = ref(false);
const loading = ref(true);

const title = computed(() => (campaign.value ? localized(campaign.value.title, locale.value) || campaign.value.slug : ""));
const intro = computed(() => renderDoc(campaign.value ? localized(campaign.value.intro, locale.value) : "").html);
const period = computed(() => (campaign.value ? formatPeriod(campaign.value, locale.value) : ""));
// 截止時間跟活動期間同一個格式：活動自己的時區，後面帶時區名稱
const at = (ms: number) => formatPeriod({ startsAt: ms, endsAt: null, timezone: campaign.value?.timezone ?? null }, locale.value);
const tiers = computed(() => TIERS.filter((k) => typeof campaign.value?.tiers[k] === "number").map((k) => ({ key: k, amount: campaign.value!.tiers[k]! })));
const signedIn = computed(() => !!session.me);

/** 換活動時上一個的回應晚到就丟掉 */
let seq = 0;
/** 已經記過 campaign_view 的 slug */
let viewed = "";
async function load() {
  const mine = ++seq;
  loading.value = true;
  missing.value = false;
  failed.value = false;
  try {
    const res = await fetchCampaign(slug.value);
    if (mine !== seq) return;
    campaign.value = res;
    document.title = pageTitle(title.value);
    if (viewed !== res.slug) { viewed = res.slug; track("campaign_view", { subject: res.slug }); }
  } catch (err) {
    if (mine !== seq) return;
    campaign.value = null;
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else failed.value = true;
  } finally {
    if (mine === seq) loading.value = false;
  }
}
watch(slug, () => { void load(); }, { immediate: true });

// ---- 我的內容（申請表的既有內容、分享連結）-------------------------------------------
const contents = ref<ContentView[]>([]);
const contentsError = ref("");
let mineSeq = 0;
async function loadMine() {
  const mine = ++mineSeq;
  const s = campaign.value?.slug;
  if (!s || !session.me) { contents.value = []; return; }
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = await fetchMyContents(token, s);
    if (mine !== mineSeq) return;
    contents.value = res.items;
    contentsError.value = "";
  } catch (e) {
    if (mine === mineSeq) contentsError.value = campaignErrorText(e);
  }
}
watch([() => campaign.value?.slug, () => session.me?.accountNumId ?? null], () => { void loadMine(); }, { immediate: true });

// ---- 送出成功：換一張新表、說一聲、更新連結並捲過去 --------------------------------------
const formKey = ref(0);
const done = ref(false);
const shareEl = ref<HTMLElement | null>(null);
async function onDone(_result: ApplyResult) {
  formKey.value++;
  done.value = true;
  track("campaign_apply", { subject: slug.value });
  await loadMine();
  await nextTick();
  shareEl.value?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}
</script>


<template>
  <NotFoundPage v-if="missing" />
  <div v-else class="page campaign" :aria-busy="loading && !!campaign">
    <p v-if="failed" class="notice notice--error" role="alert">
      {{ t("campaign.page.error") }}
      <button type="button" class="btn btn--sm" data-action="retry" @click="load()">{{ t("campaign.page.retry") }}</button>
    </p>

    <div v-else-if="!campaign" class="campaign__skeleton" aria-hidden="true">
      <div class="ghost campaign__skeleton-hero" />
      <div v-for="i in 4" :key="i" class="ghost campaign__skeleton-line" />
    </div>

    <template v-else>
      <!-- 沒有橫幅圖時頁頭本身就是一塊淡淡的強調色，不留一個等圖的空位 -->
      <header class="panel campaign__hero" :class="{ 'campaign__hero--banner': campaign.bannerUrl }">
        <img v-if="campaign.bannerUrl" :src="campaign.bannerUrl" alt="" class="campaign__banner" />
        <div class="campaign__hero-body">
          <span class="campaign__phase" :class="`campaign__phase--${campaign.phase}`" data-phase>{{ t(`campaign.phase.${campaign.phase}`) }}</span>
          <h1 class="campaign__title">{{ title }}</h1>
          <dl class="campaign__dates">
            <div v-if="period"><dt>{{ t("campaign.page.period") }}</dt><dd>{{ period }}</dd></div>
            <div v-if="campaign.submitDeadline !== null"><dt>{{ t("campaign.field.submitDeadline") }}</dt><dd>{{ at(campaign.submitDeadline) }}</dd></div>
            <div v-if="campaign.payoutDeadline !== null"><dt>{{ t("campaign.field.payoutDeadline") }}</dt><dd>{{ at(campaign.payoutDeadline) }}</dd></div>
          </dl>
        </div>
      </header>

      <section v-if="intro" class="panel campaign__section">
        <!-- renderDoc 不吃 HTML，只有它的輸出可以 v-html -->
        <div class="campaign__intro" v-html="intro" />
      </section>

      <section class="panel campaign__section" data-rules aria-labelledby="campaign-rules-h">
        <h2 id="campaign-rules-h" class="campaign__h2">{{ t("campaign.page.rules") }}</h2>
        <ul class="campaign__tiers" :style="{ '--n': tiers.length }">
          <li v-for="(tier, i) in tiers" :key="tier.key" class="campaign__tier">
            <span class="campaign__tier-name">{{ t(`campaign.tier.${tier.key}`) }}</span>
            <strong class="campaign__tier-amount">{{ formatPoints(tier.amount) }}</strong>
            <!-- 由輕到重的檔位，一眼看出高低 -->
            <span class="campaign__tier-level" aria-hidden="true"><i v-for="n in tiers.length" :key="n" :class="{ on: n <= i + 1 }" /></span>
          </li>
        </ul>
        <ul class="campaign__rules">
          <li v-if="campaign.extraPlacementAmount">
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 6.75v6.5M6.75 10h6.5" /></svg>
            <span>{{ t("campaign.page.extra", { n: formatNumber(campaign.extraPlacementAmount) }) }}</span>
          </li>
          <li>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 13.5v-7M7 9.25l3-3 3 3" /></svg>
            <span>{{ t("campaign.page.highest") }}</span>
          </li>
        </ul>
      </section>

      <section class="panel campaign__section" aria-labelledby="campaign-how-h">
        <h2 id="campaign-how-h" class="campaign__h2">{{ t("campaign.page.how") }}</h2>
        <ol class="campaign__steps">
          <li>{{ t("campaign.page.step1") }}</li>
          <li>{{ t("campaign.page.step2") }}</li>
          <li>{{ t("campaign.page.step3") }}</li>
        </ol>
        <p class="campaign__notice">
          <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 9.25v4.25" /><circle cx="10" cy="6.6" r=".5" /></svg>
          <span>{{ t("campaign.page.notice") }}</span>
        </p>
      </section>

      <section class="panel campaign__section" aria-labelledby="campaign-apply-h">
        <h2 id="campaign-apply-h" class="campaign__h2">{{ t("campaign.apply.title") }}</h2>
        <!-- 登入狀態還在確認時先不說「請登入」，免得已登入的人看到一閃；沒開放的活動登入了也不能交，就直接說沒開放 -->
        <p v-if="campaign.phase !== 'open'" class="campaign__state">
          <svg v-if="campaign.phase === 'upcoming'" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 6.25V10l2.5 1.75" /></svg>
          <svg v-else viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M7 10.25l2 2 4-4.25" /></svg>
          <span>{{ t(`campaign.page.notOpen.${campaign.phase}`) }}</span>
        </p>
        <div v-else-if="!signedIn" class="campaign__state campaign__state--action">
          <template v-if="session.ready">
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.25" y="8.75" width="11.5" height="8" rx="2" /><path d="M7 8.75V6.5a3 3 0 0 1 6 0v2.25" /></svg>
            <span>{{ t("campaign.page.signIn") }}</span>
            <RouterLink class="btn btn--primary campaign__signin" data-signin :to="lp(loginPath(route.fullPath))">{{ t("nav.login") }}</RouterLink>
          </template>
        </div>
        <!-- @submit 落到表單根節點的原生 submit：下一次送出一開始就收掉上一次的「已收到」 -->
        <CampaignApplyForm v-else :key="formKey" :campaign="campaign" :contents="contents" @submit="done = false" @done="onDone" />
      </section>

      <section v-if="signedIn" ref="shareEl" class="panel campaign__section" data-share-links aria-labelledby="campaign-share-h">
        <div class="campaign__row">
          <h2 id="campaign-share-h" class="campaign__h2">{{ t("campaign.share.title") }}</h2>
          <RouterLink class="campaign__mine" data-mine :to="`${lp('/campaigns')}?tab=mine`">
            {{ t("campaign.page.mine") }}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg>
          </RouterLink>
        </div>
        <p v-if="done" class="notice campaign__done" role="status">{{ t("campaign.apply.done") }}</p>
        <p v-if="contentsError" class="notice notice--error" role="alert">
          {{ contentsError }}
          <button type="button" class="btn btn--sm" @click="loadMine()">{{ t("campaign.page.retry") }}</button>
        </p>
        <CampaignShareLinks v-if="contents.length" :items="contents" />
        <p v-else-if="!contentsError" class="campaign__state">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 11.5l3-3M9.25 6.25l1.1-1.1a3 3 0 0 1 4.25 4.25l-1.1 1.1M10.75 13.75l-1.1 1.1a3 3 0 0 1-4.25-4.25l1.1-1.1" /></svg>
          <span>{{ t("campaign.share.empty") }}</span>
        </p>
      </section>
    </template>
  </div>
</template>

<style scoped>
/*
 * 圓角三階：面板 --r-lg、面板裡的塊（檔位、狀態、輸入框）--r-sm、按鈕與標籤 pill。
 * 面板本身沒有內距（base.css .panel），每一塊在這裡補：桌機 24、手機 16。
 */
.campaign { max-width: 800px; display: grid; gap: var(--s-4); }
.campaign svg { flex: none; width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 1.6; stroke-linecap: round; stroke-linejoin: round; }

/* ---- 頁頭 ---- */
.campaign__hero { position: relative; overflow: hidden; isolation: isolate; }
.campaign__hero:not(.campaign__hero--banner) {
  background:
    radial-gradient(70% 120% at 100% 0%, var(--accent-soft), transparent 70%),
    linear-gradient(180deg, var(--accent-tint), var(--surface));
}
/* 右上角一圈淡淡的環，讓沒有圖的頁頭看起來是刻意的版面 */
.campaign__hero:not(.campaign__hero--banner)::after {
  content: ""; position: absolute; z-index: -1; top: -120px; right: -96px; width: 320px; height: 320px;
  border-radius: var(--r-pill); border: 32px solid color-mix(in srgb, var(--accent) 7%, transparent); pointer-events: none;
}
.campaign__banner { display: block; width: 100%; aspect-ratio: 16 / 6; object-fit: cover; background: var(--surface-2); }
.campaign__hero-body { display: grid; gap: var(--s-3); justify-items: start; padding: var(--s-6); }
.campaign__phase {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px;
  border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2);
}
.campaign__phase::before { content: ""; width: 6px; height: 6px; border-radius: var(--r-pill); background: currentColor; }
.campaign__phase--open { background: var(--success-soft); color: var(--success); }
.campaign__phase--upcoming { background: var(--accent-soft); color: var(--accent-text); }
.campaign__title { margin: 0; font-size: clamp(28px, 4vw, 40px); font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; }
/* 日期是一塊格線：期間最長，三項都在時獨佔一列，兩個截止並排 */
.campaign__dates {
  justify-self: stretch; display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1px; margin: var(--s-2) 0 0;
  overflow: hidden; border-radius: var(--r-sm); background: var(--line); box-shadow: 0 0 0 1px var(--line);
}
.campaign__dates > div { min-width: 0; display: grid; gap: 2px; align-content: start; padding: var(--s-3) var(--s-4); background: var(--surface); }
.campaign__dates > div:first-child:nth-last-child(odd) { grid-column: 1 / -1; }
.campaign__hero--banner .campaign__dates > div { background: var(--surface-2); }
.campaign__dates dt { font-size: 12px; color: var(--text-3); }
.campaign__dates dd { margin: 0; font-size: 14px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

/* ---- 區塊 ---- */
.campaign__section { display: grid; gap: var(--s-4); padding: var(--s-5); min-width: 0; }
.campaign__h2 { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.4; }
.campaign__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-4); }
.campaign__mine { display: inline-flex; align-items: center; gap: 2px; font-size: 14px; font-weight: 500; color: var(--accent-text); }
.campaign__mine svg { width: 16px; height: 16px; }
.campaign__mine:hover { text-decoration: underline; text-underline-offset: 3px; }

/* ---- 介紹 ---- */
.campaign__intro { font-size: 15px; line-height: 1.8; color: var(--text); overflow-wrap: anywhere; }
.campaign__intro :deep(h2) { margin: var(--s-6) 0 var(--s-2); font-size: 22px; font-weight: 700; line-height: 1.35; }
.campaign__intro :deep(h3) { margin: var(--s-5) 0 var(--s-2); font-size: 16px; font-weight: 650; line-height: 1.45; }
.campaign__intro :deep(> :first-child) { margin-top: 0; }
.campaign__intro :deep(> :last-child) { margin-bottom: 0; }
.campaign__intro :deep(p), .campaign__intro :deep(ul), .campaign__intro :deep(ol) { margin: 0 0 var(--s-3); }
.campaign__intro :deep(p) { color: var(--text-2); }
.campaign__intro :deep(ul), .campaign__intro :deep(ol) { padding-left: 1.25em; display: grid; gap: var(--s-2); }
.campaign__intro :deep(li) { padding-left: 2px; color: var(--text-2); }
.campaign__intro :deep(li::marker) { color: var(--accent); }
.campaign__intro :deep(strong) { color: var(--text); font-weight: 650; }
.campaign__intro :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.campaign__intro :deep(img) { display: block; max-width: 100%; height: auto; border-radius: var(--r-sm); }

/* ---- 獎勵 ---- */
.campaign__tiers { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); }
.campaign__tier {
  display: flex; flex-direction: column; gap: var(--s-1); min-width: 0; padding: var(--s-4);
  border-radius: var(--r-sm); background: var(--surface-2);
}
.campaign__tier-name { font-size: 13px; font-weight: 500; color: var(--text-2); }
/* keep-all：「3,000 ポイント」只在空格斷行，不把單位拆成兩半 */
.campaign__tier-amount { font-size: 22px; font-weight: 700; line-height: 1.3; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; word-break: keep-all; overflow-wrap: anywhere; }
/* 金額換行時檔位條仍對齊在卡片底部 */
.campaign__tier-level { display: flex; gap: 4px; margin-top: auto; padding-top: var(--s-2); }
.campaign__tier-level i { flex: 1; max-width: 20px; height: 4px; border-radius: var(--r-pill); background: var(--line-strong); }
.campaign__tier-level i.on { background: var(--accent); }
.campaign__rules { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.campaign__rules li { display: flex; align-items: flex-start; gap: var(--s-2); font-size: 14px; line-height: 1.6; color: var(--text-2); }
.campaign__rules svg { margin-top: 1px; color: var(--accent-text); }

/* ---- 參加方式 ---- */
.campaign__steps { list-style: none; margin: 0; padding: 0; counter-reset: step; display: grid; gap: var(--s-3); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.campaign__steps li {
  counter-increment: step; display: grid; gap: var(--s-3); align-content: start; padding: var(--s-4);
  border-radius: var(--r-sm); background: var(--surface-2); font-size: 14px; line-height: 1.6;
}
.campaign__steps li::before {
  content: counter(step); display: grid; place-items: center; width: 28px; height: 28px;
  border-radius: var(--r-pill); background: var(--accent-soft); color: var(--accent-text);
  font-size: 13px; font-weight: 700; font-variant-numeric: tabular-nums;
}
.campaign__notice {
  display: flex; align-items: flex-start; gap: var(--s-2); margin: 0; padding: var(--s-3) var(--s-4);
  border-radius: var(--r-sm); background: var(--gold-soft); color: var(--text); font-size: 13.5px; line-height: 1.6;
}
.campaign__notice svg { margin-top: 1px; color: var(--warning-text); }

/* ---- 申請區與分享連結的狀態：說明一句，需要時配一個動作 ---- */
.campaign__state {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-3); margin: 0; padding: var(--s-4);
  border-radius: var(--r-sm); background: var(--surface-2); color: var(--text-2); font-size: 14px; line-height: 1.6;
}
.campaign__state:empty { display: none; }
.campaign__state svg { color: var(--text-3); }
.campaign__state > span { flex: 1 1 200px; min-width: 0; }
.campaign__state--action svg { color: var(--accent-text); }
.campaign__state--action > span { color: var(--text); font-weight: 500; }
.campaign__signin { flex: none; }
.campaign__done { background: var(--success-soft); color: var(--success); }

.campaign__skeleton { display: grid; gap: var(--s-4); }
.campaign__skeleton-hero { height: 240px; border-radius: var(--r-lg); }
.campaign__skeleton-line { height: 120px; border-radius: var(--r-lg); }

@media (max-width: 900px) {
  .campaign__tiers { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .campaign__hero-body { padding: var(--s-5) var(--s-4); }
  .campaign__section { padding: var(--s-4); }
  .campaign__dates { grid-template-columns: minmax(0, 1fr); }
  .campaign__steps { grid-template-columns: minmax(0, 1fr); }
  .campaign__steps li { grid-template-columns: 28px minmax(0, 1fr); align-items: center; }
  .campaign__intro :deep(h2) { font-size: 20px; }
  .campaign__tier { padding: var(--s-3); }
  .campaign__tier-amount { font-size: 19px; }
  .campaign__signin { min-height: var(--h-lg); }
  .campaign__mine { min-height: 44px; }
}
@media (max-width: 480px) {
  .campaign__signin { width: 100%; }
}
</style>

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
  TIERS, campaignErrorText, fetchCampaign, fetchMyContents, formatPeriod, localized,
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
      <div class="ghost campaign__skeleton-banner" />
      <div class="ghost campaign__skeleton-title" />
      <div v-for="i in 4" :key="i" class="ghost campaign__skeleton-line" />
    </div>

    <template v-else>
      <header class="campaign__head">
        <img v-if="campaign.bannerUrl" :src="campaign.bannerUrl" alt="" class="campaign__banner" />
        <span class="campaign__phase" :class="`campaign__phase--${campaign.phase}`" data-phase>{{ t(`campaign.phase.${campaign.phase}`) }}</span>
        <h1 class="campaign__title">{{ title }}</h1>
        <dl class="campaign__dates">
          <div v-if="period"><dt>{{ t("campaign.page.period") }}</dt><dd>{{ period }}</dd></div>
          <div v-if="campaign.submitDeadline !== null"><dt>{{ t("campaign.field.submitDeadline") }}</dt><dd>{{ at(campaign.submitDeadline) }}</dd></div>
          <div v-if="campaign.payoutDeadline !== null"><dt>{{ t("campaign.field.payoutDeadline") }}</dt><dd>{{ at(campaign.payoutDeadline) }}</dd></div>
        </dl>
      </header>

      <!-- renderDoc 不吃 HTML，只有它的輸出可以 v-html -->
      <div v-if="intro" class="campaign__intro" v-html="intro" />

      <section class="panel campaign__section" data-rules aria-labelledby="campaign-rules-h">
        <h2 id="campaign-rules-h" class="campaign__h2">{{ t("campaign.page.rules") }}</h2>
        <ul class="campaign__tiers">
          <li v-for="tier in tiers" :key="tier.key" class="campaign__tier">
            <span>{{ t(`campaign.tier.${tier.key}`) }}</span>
            <strong class="num">{{ t("campaign.page.points", { n: tier.amount }) }}</strong>
          </li>
        </ul>
        <p v-if="campaign.extraPlacementAmount" class="campaign__rule">{{ t("campaign.page.extra", { n: campaign.extraPlacementAmount }) }}</p>
        <p class="campaign__rule">{{ t("campaign.page.highest") }}</p>
      </section>

      <section class="panel campaign__section" aria-labelledby="campaign-how-h">
        <h2 id="campaign-how-h" class="campaign__h2">{{ t("campaign.page.how") }}</h2>
        <ol class="campaign__steps">
          <li>{{ t("campaign.page.step1") }}</li>
          <li>{{ t("campaign.page.step2") }}</li>
          <li>{{ t("campaign.page.step3") }}</li>
        </ol>
        <p class="campaign__notice">{{ t("campaign.page.notice") }}</p>
      </section>

      <section class="panel campaign__section" aria-labelledby="campaign-apply-h">
        <h2 id="campaign-apply-h" class="campaign__h2">{{ t("campaign.apply.title") }}</h2>
        <!-- 登入狀態還在確認時先不說「請登入」，免得已登入的人看到一閃；沒開放的活動登入了也不能交，就直接說沒開放 -->
        <p v-if="campaign.phase !== 'open'" class="campaign__rule">{{ t(`campaign.page.notOpen.${campaign.phase}`) }}</p>
        <template v-else-if="!signedIn">
          <p v-if="session.ready" class="campaign__rule">{{ t("campaign.page.signIn") }}</p>
          <RouterLink v-if="session.ready" class="btn btn--primary campaign__signin" data-signin :to="lp(loginPath(route.fullPath))">{{ t("nav.login") }}</RouterLink>
        </template>
        <!-- @submit 落到表單根節點的原生 submit：下一次送出一開始就收掉上一次的「已收到」 -->
        <CampaignApplyForm v-else :key="formKey" :campaign="campaign" :contents="contents" @submit="done = false" @done="onDone" />
      </section>

      <section v-if="signedIn" ref="shareEl" class="panel campaign__section" data-share-links aria-labelledby="campaign-share-h">
        <div class="campaign__row">
          <h2 id="campaign-share-h" class="campaign__h2">{{ t("campaign.share.title") }}</h2>
          <RouterLink class="campaign__mine" data-mine :to="lp('/me/campaign')">{{ t("campaign.page.mine") }}</RouterLink>
        </div>
        <p v-if="done" class="notice" role="status">{{ t("campaign.apply.done") }}</p>
        <p v-if="contentsError" class="notice notice--error" role="alert">
          {{ contentsError }}
          <button type="button" class="btn btn--sm" @click="loadMine()">{{ t("campaign.page.retry") }}</button>
        </p>
        <CampaignShareLinks v-if="contents.length" :items="contents" />
        <p v-else-if="!contentsError" class="campaign__rule muted">{{ t("campaign.share.empty") }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.campaign { max-width: 800px; display: grid; gap: var(--s-5); }
.campaign__head { display: grid; gap: var(--s-3); justify-items: start; }
.campaign__banner { width: 100%; aspect-ratio: 16 / 6; object-fit: cover; border-radius: var(--r-lg); background: var(--surface-2); }
.campaign__phase { padding: 1px 8px; border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2); }
.campaign__phase--open { background: var(--success-soft); color: var(--success); }
.campaign__phase--upcoming { color: var(--accent-text); }
.campaign__title { margin: 0; font-size: clamp(26px, 3.4vw, 36px); line-height: 1.25; overflow-wrap: anywhere; }
.campaign__dates { display: grid; gap: var(--s-1); margin: 0; font-size: 14px; }
.campaign__dates > div { display: flex; flex-wrap: wrap; gap: 0 var(--s-2); }
.campaign__dates dt { color: var(--text-3); }
.campaign__dates dd { margin: 0; }

.campaign__intro { font-size: 16px; line-height: 1.8; overflow-wrap: anywhere; }
.campaign__intro :deep(h2) { font-size: 20px; margin: var(--s-5) 0 var(--s-2); }
.campaign__intro :deep(h3) { font-size: 17px; margin: var(--s-4) 0 var(--s-2); }
.campaign__intro :deep(:first-child) { margin-top: 0; }
.campaign__intro :deep(p), .campaign__intro :deep(ul), .campaign__intro :deep(ol) { margin: 0 0 var(--s-3); }
.campaign__intro :deep(ul), .campaign__intro :deep(ol) { padding-left: 1.4em; }
.campaign__intro :deep(a) { color: var(--accent-text); text-decoration: underline; text-underline-offset: 3px; }
.campaign__intro :deep(img) { display: block; max-width: 100%; height: auto; border-radius: var(--r-md); }

.campaign__section { display: grid; gap: var(--s-3); }
.campaign__h2 { margin: 0; font-size: 18px; }
.campaign__row { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: var(--s-2) var(--s-4); }
.campaign__mine { font-size: 14px; color: var(--accent-text); }
.campaign__rule, .campaign__notice { margin: 0; font-size: 14px; line-height: 1.6; }
.campaign__notice { color: var(--text-2); }
.campaign__tiers { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); }
.campaign__tier { display: grid; gap: var(--s-1); padding: var(--s-3) var(--s-4); border-radius: var(--r-md); background: var(--surface-2); font-size: 14px; }
.campaign__tier strong { font-size: 18px; }
.campaign__steps { margin: 0; padding-left: 1.4em; display: grid; gap: var(--s-1); font-size: 14px; line-height: 1.6; }
.campaign__signin { justify-self: start; }

.campaign__skeleton { display: grid; gap: var(--s-3); }
.campaign__skeleton-banner { aspect-ratio: 16 / 6; border-radius: var(--r-lg); }
.campaign__skeleton-title { width: 60%; height: 36px; }
.campaign__skeleton-line { height: 18px; border-radius: var(--r-sm); }
@media (max-width: 760px) { .campaign__signin, .campaign__mine { min-height: 44px; display: inline-flex; align-items: center; } }
</style>

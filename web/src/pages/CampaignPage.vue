<script setup lang="ts">
/**
 * 公開活動頁 /campaign/:slug。所有活動共用這個版型（設計：約戰 UIUX「綺夢分享季」M2 定稿，2026-10-17）：
 * ① 頁頭（後台橫幅、狀態、期間、標題）② 獎勵怎麼拿＋登入／專屬連結 ③ 分享拿多少 ④ 算算看 ⑤ 怎麼參加
 * ⑥ 活動介紹（後台 Markdown）⑦ 提交分享 ⑧ 我的分享（登入才有）⑨ 參加前看一下。
 * 手機一欄，②是第一屏的終點；桌機兩欄，②與⑧在右欄跟著捲動。
 *
 * 金額與時間全部讀 API，時間用活動自己的時區；推薦數字讀 Harbor 公開的推薦規則（lib/referral-terms），讀不到就只講分享。
 * 訪客看得到全部規則，申請區請他登入後回到這一頁（?s= 進站時已記在瀏覽器，登入後綁定，見 lib/share-ref.ts）。
 * 只有登入且活動進行中才有申請表。進頁成功記一次 campaign_view（同一個 slug 重新讀不再記）。
 *
 * 發卡獎勵活動（創作季，kind = card_reward）共用頁頭，中段換成 CreatorSeason（規則卡、我的進度、怎麼參加、條款）。
 * 分享活動頁在條款上方多一行連到進行中的創作季。
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import CampaignApplyForm from "@/components/CampaignApplyForm.vue";
import CampaignRewards from "@/components/CampaignRewards.vue";
import CampaignShareLinks from "@/components/CampaignShareLinks.vue";
import AmountText from "@/components/AmountText.vue";
import CreatorSeason from "@/components/CreatorSeason.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import { ApiError } from "@/lib/api";
import {
  DEFAULT_TIMEZONE, TIERS, campaignErrorText, fetchCampaign, fetchMyContents, formatNumber, formatPeriod, formatPoints, isCardReward, localized, openCardReward, platformsFor, zoneName,
  type ApplyResult, type CardRewardCampaign, type ContentView, type PublicCampaign,
} from "@/lib/campaign";
import { pageTitle } from "@/lib/i18n";
import { loginPath } from "@/lib/login-return";
import { renderDoc } from "@/lib/markdown-toc";
import { CALC_FIRST_TOPUP, CALC_LATER_TOPUP, calcExample, fetchReferralTerms, friendTotal, referralShown, type ReferralTerms } from "@/lib/referral-terms";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";
import { siteName } from "../../../shared/site-name";

const route = useRoute();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const session = useSession();

const slug = computed(() => String(route.params.slug ?? ""));
/** 分享活動；發卡獎勵活動放在 creator。兩個最多一個有值，頁頭讀 head。 */
const campaign = ref<PublicCampaign | null>(null);
const creator = ref<CardRewardCampaign | null>(null);
const head = computed(() => campaign.value ?? creator.value);
const missing = ref(false);
const failed = ref(false);
const loading = ref(true);

const title = computed(() => (head.value ? localized(head.value.title, locale.value) || head.value.slug : ""));
/** 活動名兩行時在品牌名後的空格斷（「SukiSuki／創作シーズン」），兩段都夠短才這樣分（同首頁輪播） */
const titleParts = computed(() => {
  const at = title.value.indexOf(" ");
  const parts = at > 0 ? [title.value.slice(0, at), title.value.slice(at + 1)] : [title.value];
  return parts.length > 1 && parts.every((p) => [...p].length <= 16) ? parts : [title.value];
});
const intro = computed(() => renderDoc(campaign.value ? localized(campaign.value.intro, locale.value) : "").html);
const signedIn = computed(() => !!session.me);
const loginTo = computed(() => lp(loginPath(route.fullPath)));
const tz = computed(() => head.value?.timezone || DEFAULT_TIMEZONE);

// ---- 日期：活動自己的時區 ---------------------------------------------------------
const fmt = (opts: Intl.DateTimeFormatOptions) => (ms: number) => new Intl.DateTimeFormat(locale.value, { timeZone: tz.value, ...opts }).format(ms);
const md = (ms: number) => fmt({ month: "numeric", day: "numeric" })(ms);
const mdhm = (ms: number) => fmt({ month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })(ms);
/** 狀態膠囊旁的一行期間：只到月日 */
const shortPeriod = computed(() => {
  const c = head.value;
  if (!c || c.startsAt === null || c.endsAt === null) return "";
  // 結束日是最後一天（結束時刻前 1 毫秒），跟首頁輪播一致
  return `${md(c.startsAt)} – ${md(c.endsAt - 1)}`;
});
/** 桌機頁頭的三格：期間完整、兩個截止 */
const period = computed(() => (campaign.value ? formatPeriod(campaign.value, locale.value) : ""));
const at = (ms: number) => formatPeriod({ startsAt: ms, endsAt: null, timezone: tz.value }, locale.value);
/** 提交區標題下的一行：期間・補件・發獎（後兩個沒設就整行不出），帶時區名稱 */
const datesLine = computed(() => {
  const c = campaign.value;
  if (!c || c.startsAt === null || c.endsAt === null || c.submitDeadline === null || c.payoutDeadline === null) return "";
  const line = t("campaign.page.dates", { start: md(c.startsAt), end: md(c.endsAt), submitDeadline: md(c.submitDeadline), payBy: md(c.payoutDeadline) });
  return `${line}（${zoneName(tz.value, locale.value)}）`;
});
const startLabel = computed(() => (head.value?.startsAt != null ? mdhm(head.value.startsAt) : ""));

// ---- 創作季的頁頭：剩幾天、最後一天、期間（結束日是最後一天）、副標 ---------------------------------
const DAY = 86_400_000;
const creatorMd = (ms: number) => fmt({ month: "short", day: "numeric" })(ms);
const creatorStatus = computed(() => {
  const c = creator.value;
  if (!c) return "";
  if (c.phase === "upcoming") return startLabel.value ? t("campaign.page.status.upcoming", { date: startLabel.value }) : t("campaign.page.status.upcoming");
  if (c.phase === "ended") return t("creator.status.ended");
  const left = c.endsAt - Date.now();
  return left <= DAY ? t("creator.status.lastDay") : t("creator.status.open", { days: Math.ceil(left / DAY) });
});
const creatorPeriod = computed(() => (creator.value ? t("creator.period", { start: creatorMd(creator.value.startsAt), end: creatorMd(creator.value.endsAt - 1) }) : ""));
const creatorCredits = computed(() => (creator.value ? formatNumber(creator.value.reward) : ""));

// ---- 分享活動頁連到進行中的創作季 ------------------------------------------------------
const creatorLink = ref<CardRewardCampaign | null>(null);
watch(() => campaign.value?.slug, (s) => {
  creatorLink.value = null;
  if (s) void openCardReward().then((c) => { if (campaign.value?.slug === s) creatorLink.value = c; }).catch(() => {});
});

// ---- 檔位、推薦、算算看 ----------------------------------------------------------
const tiers = computed(() => TIERS.filter((k) => typeof campaign.value?.tiers[k] === "number").map((k) => ({ key: k, amount: campaign.value!.tiers[k]! })));
const topTier = computed(() => tiers.value[tiers.value.length - 1]);
const terms = ref<ReferralTerms | null>(null);
void fetchReferralTerms().then((v) => { terms.value = v; });
const referral = computed(() => (referralShown(terms.value) ? terms.value : null));
/** 算算看用原創貼文那一檔當例子；這個活動沒有那一檔就不算 */
const calc = computed(() => {
  const base = campaign.value?.tiers.original;
  if (typeof base !== "number") return null;
  return calcExample(base, campaign.value?.extraPlacementAmount ?? 0, terms.value);
});
const extra = computed(() => campaign.value?.extraPlacementAmount ?? 0);

// ---- 怎麼參加：依語言的平台 ---------------------------------------------------------
const chips = computed(() => platformsFor(locale.value).primary);
const site = computed(() => siteName(locale.value));

// ---- 活動介紹：手機超過五行先收起來 ------------------------------------------------------
const introEl = ref<HTMLElement | null>(null);
const introOpen = ref(false);
const introLong = ref(false);
function measureIntro() { const el = introEl.value; introLong.value = !!el && el.scrollHeight > el.clientHeight + 2; }
let ro: ResizeObserver | undefined;
watch(introEl, (el) => {
  ro?.disconnect();
  if (!el || typeof ResizeObserver === "undefined") return;
  ro = new ResizeObserver(measureIntro);
  ro.observe(el);
});
watch(intro, () => { introOpen.value = false; void nextTick(measureIntro); });
onBeforeUnmount(() => ro?.disconnect());

// ---- 參加前看一下 ------------------------------------------------------------------
const notes = computed(() => {
  const list = [t("campaign.page.notes.1"), t("campaign.page.notes.2"), t("campaign.page.notes.3"), t("campaign.page.notes.4")];
  if (referral.value) list.push(t("campaign.page.notes.5", { friendDays: referral.value.welcomeDays }));
  list.push(t("campaign.page.notes.6"));
  return list;
});

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
    campaign.value = isCardReward(res) ? null : res;
    creator.value = isCardReward(res) ? res : null;
    document.title = pageTitle(title.value);
    if (viewed !== res.slug) { viewed = res.slug; track("campaign_view", { subject: res.slug }); }
  } catch (err) {
    if (mine !== seq) return;
    campaign.value = null;
    creator.value = null;
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else failed.value = true;
  } finally {
    if (mine === seq) loading.value = false;
  }
}
watch(slug, () => { void load(); }, { immediate: true });

// ---- 我的內容（申請表的既有內容、每份分享的追蹤連結）---------------------------------------
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

// ---- 送出成功：換一張新表、說一聲、更新清單並捲過去 --------------------------------------
const formKey = ref(0);
const done = ref(false);
const mineEl = ref<HTMLElement | null>(null);
async function onDone(_result: ApplyResult) {
  formKey.value++;
  done.value = true;
  track("campaign_apply", { subject: slug.value });
  await loadMine();
  await nextTick();
  mineEl.value?.scrollIntoView?.({ behavior: "smooth", block: "start" });
}
</script>

<template>
  <NotFoundPage v-if="missing" />
  <div v-else class="page campaign" :aria-busy="loading && !!campaign">
    <p v-if="failed" class="notice notice--error" role="alert">
      {{ t("campaign.page.error") }}
      <button type="button" class="btn btn--sm" data-action="retry" @click="load()">{{ t("campaign.page.retry") }}</button>
    </p>

    <div v-else-if="!head" class="campaign__skeleton" aria-hidden="true">
      <div class="ghost campaign__skeleton-hero" />
      <div v-for="i in 3" :key="i" class="ghost campaign__skeleton-line" />
    </div>

    <div v-else class="campaign__grid">
      <!-- ① 頁頭：標題不疊在橫幅上，橫幅可以沒有 -->
      <header class="campaign__head">
        <img v-if="head.bannerUrl" :src="head.bannerUrl" alt="" class="campaign__banner" width="720" height="270" fetchpriority="high" />
        <div class="campaign__head-body" :class="{ 'campaign__head-body--bare': !head.bannerUrl }">
          <div class="campaign__head-text">
            <div class="campaign__status">
              <span class="campaign__phase" :class="`campaign__phase--${head.phase}`" data-phase>
                <template v-if="creator">{{ creatorStatus }}</template>
                <template v-else>{{ head.phase === "upcoming" && startLabel ? t("campaign.page.status.upcoming", { date: startLabel }) : t(`campaign.page.status.${head.phase}`) }}</template>
              </span>
              <span v-if="creator" class="campaign__period num" data-period>{{ creatorPeriod }}</span>
              <span v-else-if="shortPeriod" class="campaign__short num">{{ shortPeriod }}</span>
            </div>
            <h1 class="campaign__title" :class="{ 'campaign__title--long': [...title].length > 12 }"><template v-for="(part, k) in titleParts" :key="k"><template v-if="k">{{ " " }}</template><span :class="{ campaign__part: titleParts.length > 1 }">{{ part }}</span></template></h1>
            <template v-if="creator">
              <p class="campaign__subtitle"><AmountText :text="t('creator.subtitle', { credits: creatorCredits })" /></p>
            </template>
            <dl v-else-if="campaign" class="campaign__dates">
              <div v-if="period"><dt>{{ t("campaign.page.period") }}</dt><dd>{{ period }}</dd></div>
              <div v-if="campaign.submitDeadline !== null"><dt>{{ t("campaign.field.submitDeadline") }}</dt><dd>{{ at(campaign.submitDeadline) }}</dd></div>
              <div v-if="campaign.payoutDeadline !== null"><dt>{{ t("campaign.field.payoutDeadline") }}</dt><dd>{{ at(campaign.payoutDeadline) }}</dd></div>
            </dl>
          </div>
          <img v-if="!head.bannerUrl" class="campaign__wave" src="/mascot/home/pose-wave.webp" alt="" width="140" height="175" />
        </div>
      </header>

      <CreatorSeason v-if="creator" :campaign="creator" :login-to="loginTo" />
      <template v-else-if="campaign">

      <!-- 右欄（桌機跟著捲動）；手機上拆開，②接在頁頭後、⑧接在提交區後 -->
      <aside class="campaign__side">
        <CampaignRewards class="campaign__rewards" :campaign="campaign" :terms="terms" :login-to="loginTo" />

        <section v-if="signedIn" ref="mineEl" class="panel campaign__section campaign__mine-card" data-share-links aria-labelledby="campaign-mine-h">
          <div class="campaign__row">
            <h2 id="campaign-mine-h" class="campaign__h2">{{ t("campaign.page.mine") }}</h2>
            <RouterLink class="campaign__mine" data-mine :to="`${lp('/campaigns')}?tab=mine`">
              {{ t("campaign.page.mineAll") }}
              <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg>
            </RouterLink>
          </div>
          <p v-if="done" class="notice campaign__done" role="status">{{ t("campaign.apply.done") }}</p>
          <p v-if="contentsError" class="notice notice--error" role="alert">
            {{ contentsError }}
            <button type="button" class="btn btn--sm" @click="loadMine()">{{ t("campaign.page.retry") }}</button>
          </p>
          <CampaignShareLinks v-if="contents.length" :items="contents" />
          <p class="campaign__cap">{{ t("campaign.page.mineHint") }}</p>
        </section>
      </aside>

      <div class="campaign__body">
        <!-- ③ 分享拿多少 -->
        <section class="panel campaign__section" data-rules aria-labelledby="campaign-tiers-h">
          <div class="campaign__say">
            <img src="/mascot/campaign/pose-hoard.webp" alt="" width="80" height="111" loading="lazy" decoding="async" />
            <div class="campaign__say-text">
              <h2 id="campaign-tiers-h" class="campaign__h2">{{ t("campaign.page.tiers.title") }}</h2>
              <p v-if="topTier?.key === 'video'" class="campaign__bubble"><span class="campaign__who">{{ t("mascot.name") }}</span>{{ t("campaign.page.tiers.say", { video: formatNumber(topTier.amount) }) }}</p>
            </div>
          </div>
          <ul class="campaign__tiers" :style="{ '--n': tiers.length }">
            <li v-for="tier in tiers" :key="tier.key" class="campaign__tier" :class="{ 'campaign__tier--top': tier.key === topTier?.key }">
              <div class="campaign__tier-text">
                <strong class="campaign__tier-name">{{ t(`campaign.tier.${tier.key}`) }}</strong>
                <span class="campaign__cap">{{ t(`campaign.tierDesc.${tier.key}`) }}</span>
              </div>
              <span class="campaign__tier-amount num">{{ formatPoints(tier.amount) }}</span>
            </li>
          </ul>
          <ul class="campaign__rules">
            <li v-if="extra">
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 6.75v6.5M6.75 10h6.5" /></svg>
              <span>{{ t("campaign.page.extra", { extra: formatNumber(extra) }) }}</span>
            </li>
            <li>
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 13.5v-7M7 9.25l3-3 3 3" /></svg>
              <span>{{ t("campaign.page.highest") }}</span>
            </li>
            <li v-if="campaign.lightLimit && campaign.tiers.light" data-light-limit>
              <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M6.75 10h6.5" /></svg>
              <span>{{ t("campaign.page.lightLimit", { n: campaign.lightLimit }) }}</span>
            </li>
          </ul>
        </section>

        <div class="campaign__pair">
          <!-- ④ 算算看 -->
          <section v-if="calc" class="panel campaign__section" data-calc aria-labelledby="campaign-calc-h">
            <div class="campaign__row campaign__row--top">
              <div class="campaign__say-text">
                <h2 id="campaign-calc-h" class="campaign__h2">{{ t("campaign.page.calc.title") }}</h2>
                <span class="campaign__cap">{{ referral ? t("campaign.page.calc.lead") : t("campaign.page.calc.leadShareOnly") }}</span>
              </div>
              <img class="campaign__calc-pose" src="/mascot/campaign/pose-got-points.webp" alt="" width="60" height="83" loading="lazy" decoding="async" />
            </div>
            <div class="campaign__calc num">
              <div class="campaign__calc-row">
                <span><span class="campaign__calc-label">{{ t("campaign.page.calc.row1") }}</span><span class="campaign__cap">{{ t("campaign.page.calc.row1Formula", { base: formatNumber(calc.base), extra: formatNumber(extra) }) }}</span></span>
                <strong>{{ formatNumber(calc.share) }}</strong>
              </div>
              <div v-if="calc.first" class="campaign__calc-row">
                <span><span class="campaign__calc-label">{{ t("campaign.page.calc.row2", { amount: formatNumber(CALC_FIRST_TOPUP) }) }}</span><span class="campaign__cap">{{ t("campaign.page.calc.row2Formula", { first: referral!.firstPercent }) }}</span></span>
                <strong>{{ formatNumber(calc.first) }}</strong>
              </div>
              <div v-if="calc.rebate" class="campaign__calc-row">
                <span><span class="campaign__calc-label">{{ t("campaign.page.calc.row3", { amount: formatNumber(CALC_LATER_TOPUP) }) }}</span><span class="campaign__cap">{{ t("campaign.page.calc.row3Formula", { rebate: referral!.rebatePercent }) }}</span></span>
                <strong>{{ formatNumber(calc.rebate) }}</strong>
              </div>
              <div class="campaign__calc-row campaign__calc-row--total">
                <span>{{ t("campaign.page.calc.total") }}</span>
                <strong data-calc-total>{{ formatPoints(calc.total) }}</strong>
              </div>
            </div>
          </section>

          <!-- ⑤ 怎麼參加 -->
          <section class="panel campaign__section" aria-labelledby="campaign-how-h">
            <h2 id="campaign-how-h" class="campaign__h2">{{ t("campaign.page.how") }}</h2>
            <ol class="campaign__steps">
              <li>
                <span class="campaign__no num">1</span>
                <div><strong>{{ t("campaign.page.step1") }}</strong><span class="campaign__cap">{{ t("campaign.page.step1Desc") }}</span></div>
              </li>
              <li>
                <span class="campaign__no num">2</span>
                <div>
                  <strong>{{ t("campaign.page.step2", { site }) }}</strong><span class="campaign__cap">{{ t("campaign.page.step2Desc", { site }) }}</span>
                  <ul class="campaign__chips" data-platform-chips>
                    <li v-for="p in chips" :key="p">{{ t(`campaign.platform.${p}`) }}</li>
                    <li>{{ t("campaign.page.platformOther") }}</li>
                  </ul>
                </div>
              </li>
              <li>
                <span class="campaign__no num">3</span>
                <div><strong>{{ t("campaign.page.step3") }}</strong><span class="campaign__cap">{{ t("campaign.page.step3Desc") }}</span></div>
              </li>
            </ol>
          </section>
        </div>

        <!-- ⑥ 活動介紹（後台 Markdown）；renderDoc 不吃 HTML，只有它的輸出可以 v-html -->
        <section v-if="intro" class="panel campaign__section" aria-labelledby="campaign-intro-h">
          <h2 id="campaign-intro-h" class="campaign__h2">{{ t("campaign.page.intro") }}</h2>
          <div id="campaign-intro" ref="introEl" class="campaign__intro" :class="{ 'campaign__intro--open': introOpen, 'campaign__intro--long': introLong }" v-html="intro" />
          <button v-if="introLong && !introOpen" type="button" class="btn campaign__more" aria-controls="campaign-intro" :aria-expanded="introOpen" @click="introOpen = true">{{ t("campaign.page.introMore") }}</button>
        </section>

        <!-- ⑦ 提交分享 -->
        <section class="panel campaign__section" aria-labelledby="campaign-apply-h">
          <div class="campaign__say">
            <img src="/mascot/campaign/pose-screenshot.webp" alt="" width="80" height="111" loading="lazy" decoding="async" />
            <div class="campaign__say-text">
              <h2 id="campaign-apply-h" class="campaign__h2">{{ t("campaign.apply.title") }}</h2>
              <p v-if="campaign.phase === 'open'" class="campaign__bubble"><span class="campaign__who">{{ t("mascot.name") }}</span>{{ t("campaign.page.apply.say") }}</p>
            </div>
          </div>
          <p v-if="datesLine" class="campaign__cap campaign__dates-line num">{{ datesLine }}</p>
          <p v-if="campaign.phase === 'upcoming'" class="campaign__state campaign__state--soft" data-state="upcoming">{{ t("campaign.page.apply.upcoming", { date: startLabel }) }}</p>
          <div v-else-if="campaign.phase === 'ended'" class="campaign__state" data-state="ended">
            <span>{{ t("campaign.page.apply.ended", { submitDeadline: campaign.submitDeadline !== null ? md(campaign.submitDeadline) : "" }) }}</span>
            <RouterLink class="btn campaign__state-btn" :to="`${lp('/campaigns')}?tab=mine`">{{ t("campaign.page.apply.endedButton") }}</RouterLink>
          </div>
          <template v-else-if="!signedIn">
            <RouterLink v-if="session.ready" class="btn btn--lg campaign__signin" data-signin-apply :to="loginTo">{{ t("campaign.page.signIn") }}</RouterLink>
          </template>
          <!-- @submit 落到表單根節點的原生 submit：下一次送出一開始就收掉上一次的「已收到」 -->
          <CampaignApplyForm v-else :key="formKey" :campaign="campaign" :contents="contents" @submit="done = false" @done="onDone" />
        </section>

        <!-- 進行中的創作季：條款上方一行連結 -->
        <RouterLink v-if="creatorLink" class="campaign__link-row" data-creator-link :to="lp(`/campaign/${creatorLink.slug}`)">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.75l1.9 4.6 4.85.4-3.7 3.15 1.15 4.85L10 13.2l-4.2 2.55 1.15-4.85-3.7-3.15 4.85-.4z" /></svg>
          <span><AmountText :text="t('campaign.page.creatorLink', { credits: formatNumber(creatorLink.reward) })" /></span>
          <svg class="campaign__link-go" viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg>
        </RouterLink>

        <!-- ⑨ 參加前看一下 -->
        <details class="panel campaign__notes" data-notes>
          <summary>
            <span>{{ t("campaign.page.notes.title") }}</span>
            <span class="campaign__cap">{{ t("campaign.page.notes.count", { n: notes.length }) }}</span>
          </summary>
          <ul>
            <li v-for="(n, i) in notes" :key="i">{{ n }}</li>
          </ul>
        </details>
      </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
/*
 * 版型：手機一欄（頁頭 → 獎勵 → 內容 → 我的分享 → 小提醒），桌機兩欄（左：頁頭、內容；右：獎勵、我的分享，跟著捲動）。
 * 右欄在手機上 display: contents，讓獎勵與我的分享各自排進一欄的順序。
 * 圓角：面板 --r-lg、面板裡的塊 --r-md、輸入框 --r-sm、按鈕與膠囊 pill。
 */
.campaign { max-width: 1100px; }
.campaign svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.campaign__grid {
  display: grid; gap: var(--s-6); align-items: start;
  grid-template-columns: minmax(0, 1fr) minmax(300px, 360px);
  grid-template-areas: "head side" "body side";
  /* 右欄比頁頭高時，多出來的高度給第二列：左欄的內容緊接在頁頭下面，不留一大段空白 */
  grid-template-rows: auto 1fr;
}
.campaign__head { grid-area: head; display: grid; gap: var(--s-3); min-width: 0; }
.campaign__side { grid-area: side; display: grid; gap: var(--s-4); position: sticky; top: calc(var(--header-h, 64px) + var(--s-4)); min-width: 0; }
.campaign__body { grid-area: body; display: grid; gap: var(--s-5); min-width: 0; }
.campaign__pair { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-5); align-items: start; }

/* ---- ① 頁頭 ---- */
/* 橫幅不疊字、不加遮罩：同一張圖也用在首頁輪播與活動中心 */
.campaign__banner { display: block; width: 100%; height: auto; aspect-ratio: 16 / 6; object-fit: cover; border-radius: var(--r-lg); background: var(--surface-2); }
.campaign__head-body { display: flex; align-items: flex-end; gap: var(--s-4); padding: 0 var(--s-1); }
.campaign__head-body--bare {
  padding: var(--s-6); border-radius: var(--r-lg);
  background: color-mix(in srgb, var(--accent) 10%, var(--surface)); border: 1px solid var(--line);
}
.campaign__head-text { flex: 1; min-width: 0; display: grid; gap: var(--s-2); justify-items: start; }
.campaign__wave { flex: none; width: 140px; height: 175px; object-fit: contain; margin: calc(-1 * var(--s-3)) 0 calc(-1 * var(--s-6)); }
.campaign__status { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.campaign__phase {
  display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; white-space: nowrap;
  border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2);
}
.campaign__phase::before { content: ""; width: 6px; height: 6px; border-radius: var(--r-pill); background: currentColor; }
.campaign__phase--open { background: var(--success-soft); color: var(--success); }
.campaign__phase--upcoming { background: var(--accent-soft); color: var(--accent-text); }
.campaign__short { display: none; font-size: 13px; color: var(--text-2); }
/* 創作季：期間一行，桌機手機都出（只到月日，帶時區說明） */
.campaign__period { font-size: 13px; color: var(--text-2); }
.campaign__subtitle { margin: 0; font-size: 17px; font-weight: 600; line-height: 1.5; color: var(--text-2); word-break: auto-phrase; text-wrap: pretty; }
.campaign:lang(ko) .campaign__subtitle { word-break: keep-all; }
.campaign__link-row {
  display: flex; align-items: center; gap: var(--s-2); min-height: 44px; padding: 0 var(--s-1);
  font-size: 14px; font-weight: 600; line-height: 1.5; color: var(--accent-text); text-decoration: none; word-break: auto-phrase; text-wrap: pretty;
}
.campaign__link-row:hover span { text-decoration: underline; text-underline-offset: 3px; }
.campaign__link-go { margin-left: auto; }
.campaign__title { margin: 0; font-size: 40px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; overflow-wrap: anywhere; text-wrap: balance; line-break: strict; word-break: auto-phrase; }
.campaign__part { white-space: nowrap; }
.campaign__dates {
  justify-self: stretch; display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-2); margin: var(--s-1) 0 0;
}
.campaign__dates > div { min-width: 0; display: grid; gap: 2px; align-content: start; padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.campaign__dates dt { font-size: 12px; color: var(--text-3); }
.campaign__dates dd { margin: 0; font-size: 13px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

/* ---- 共用 ---- */
.campaign__section { display: grid; gap: var(--s-4); padding: var(--s-6); min-width: 0; }
.campaign__h2 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.4; }
.campaign__cap { display: block; font-size: 13px; line-height: 1.55; color: var(--text-2); }
.campaign__row { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2) var(--s-4); }
.campaign__row--top { flex-wrap: nowrap; }
.campaign__say { display: flex; align-items: flex-end; gap: var(--s-3); }
.campaign__say > img { flex: none; width: 80px; height: 111px; object-fit: contain; }
.campaign__say-text { min-width: 0; display: grid; gap: var(--s-2); }
.campaign__bubble {
  margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-lg) var(--r-lg) var(--r-lg) 4px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface)); font-size: 14px; line-height: 1.55;
}
.campaign__who { display: block; font-size: 12px; font-weight: 700; color: var(--accent-text); }
.campaign__mine { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; font-size: 14px; font-weight: 600; color: var(--accent-text); }
.campaign__mine svg { width: 16px; height: 16px; }
.campaign__mine:hover { text-decoration: underline; text-underline-offset: 3px; }
.campaign__done { background: var(--success-soft); color: var(--success); }

/* ---- ③ 檔位：桌機 n 欄卡，手機一列一檔 ---- */
.campaign__tiers { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-3); grid-template-columns: repeat(var(--n, 4), minmax(0, 1fr)); }
.campaign__tier { display: flex; flex-direction: column; gap: var(--s-2); min-width: 0; padding: var(--s-4); border-radius: var(--r-md); background: var(--surface-2); }
.campaign__tier-text { display: grid; gap: 2px; }
.campaign__tier-name { font-size: 15px; }
/* keep-all：「3,000 ポイント」只在空格斷行，不把單位拆成兩半 */
.campaign__tier-amount { margin-top: auto; font-size: 20px; font-weight: 700; line-height: 1.3; word-break: keep-all; }
.campaign__tier--top .campaign__tier-amount { color: var(--accent-text); }
.campaign__rules { list-style: none; margin: 0; padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); display: grid; gap: 6px; }
.campaign__rules li { display: flex; align-items: flex-start; gap: var(--s-2); font-size: 13.5px; line-height: 1.6; }
.campaign__rules svg { margin-top: 2px; color: var(--accent-text); }

/* ---- ④ 算算看 ---- */
.campaign__calc-pose { flex: none; width: 60px; height: 83px; object-fit: contain; }
.campaign__calc { display: grid; border-radius: var(--r-md); background: var(--surface-2); overflow: hidden; font-size: 13.5px; line-height: 1.5; }
.campaign__calc-row { display: flex; justify-content: space-between; align-items: center; gap: var(--s-3); padding: 10px var(--s-3); }
.campaign__calc-row + .campaign__calc-row { border-top: 1px solid var(--line); }
.campaign__calc-label { display: block; }
.campaign__calc-row--total { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); font-weight: 600; }
.campaign__calc-row--total strong { font-size: 20px; color: var(--accent-text); white-space: nowrap; }

/* ---- ⑤ 怎麼參加 ---- */
.campaign__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); }
.campaign__steps > li { display: flex; align-items: flex-start; gap: var(--s-3); }
.campaign__no {
  flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--r-pill);
  background: var(--accent-soft); color: var(--accent-text); font-size: 13px; font-weight: 700;
}
.campaign__chips { list-style: none; margin: var(--s-2) 0 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.campaign__chips li { display: inline-flex; align-items: center; height: 28px; padding: 0 10px; border-radius: var(--r-pill); background: var(--surface-2); font-size: 12.5px; color: var(--text-2); }

/* ---- ⑥ 介紹 ---- */
.campaign__intro { font-size: 15px; line-height: 1.8; color: var(--text); overflow-wrap: anywhere; }
.campaign__intro :deep(h2) { margin: var(--s-5) 0 var(--s-2); font-size: 18px; font-weight: 700; line-height: 1.4; }
.campaign__intro :deep(h3) { margin: var(--s-4) 0 var(--s-2); font-size: 16px; font-weight: 650; line-height: 1.45; }
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
.campaign__more { justify-self: stretch; min-height: 44px; }
@media (min-width: 761px) { .campaign__more { display: none; } }

/* ---- ⑦ 提交 ---- */
.campaign__dates-line { margin: 0; }
.campaign__state {
  display: grid; gap: var(--s-3); margin: 0; padding: var(--s-4);
  border-radius: var(--r-md); background: var(--surface-2); font-size: 14px; line-height: 1.6;
}
.campaign__state--soft { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.campaign__state-btn, .campaign__signin { min-height: 48px; justify-self: stretch; }

/* ---- ⑨ 參加前看一下 ---- */
.campaign__notes { padding: 0 var(--s-6); }
.campaign__notes summary {
  min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  font-size: 16px; font-weight: 650; cursor: pointer; list-style: none;
}
.campaign__notes summary::-webkit-details-marker { display: none; }
.campaign__notes ul { margin: 0 0 var(--s-5); padding-left: 1.2em; display: grid; gap: 6px; font-size: 13.5px; line-height: 1.6; color: var(--text-2); }

.campaign__skeleton { display: grid; gap: var(--s-4); }
.campaign__skeleton-hero { height: 260px; border-radius: var(--r-lg); }
.campaign__skeleton-line { height: 140px; border-radius: var(--r-lg); }

@media (max-width: 1020px) {
  .campaign__pair { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 860px) {
  /* 一欄：右欄與內容欄都拆開，照 order 排成 頁頭 → 獎勵 → 內容 → 我的分享 → 小提醒 */
  .campaign__grid { grid-template-columns: minmax(0, 1fr); grid-template-areas: none; gap: var(--s-3); }
  .campaign__head { gap: var(--s-2); }
  .campaign__side, .campaign__body { display: contents; }
  .campaign__head, .campaign__side, .campaign__body { grid-area: auto; }
  .campaign__head { order: 1; }
  .campaign__rewards { order: 2; }
  .campaign__body > * { order: 3; }
  .campaign__mine-card { order: 4; }
  .campaign__body > .campaign__notes, .campaign__body > .campaign__link-row { order: 5; }
}
@media (max-width: 760px) {
  .campaign__head-body { padding: 0 var(--s-1); }
  .campaign__head-body--bare { padding: var(--s-4); }
  .campaign__wave { width: 96px; height: 120px; margin: calc(-1 * var(--s-2)) 0 calc(-1 * var(--s-4)); }
  .campaign__title { font-size: 28px; }
  .campaign__subtitle { font-size: 15px; }
  /* 英日韓的活動名較長（Hearthroom シェアシーズン），手機上縮一階，盡量一行放完、不留單字在第二行 */
  .campaign__title--long { font-size: 23px; }
  .campaign__dates { display: none; }
  .campaign__short { display: inline; }
  .campaign__section { padding: var(--s-4); gap: var(--s-3); }
  .campaign__h2 { font-size: 18px; }
  .campaign__say > img { width: 64px; height: 89px; }
  .campaign__calc-pose { width: 52px; height: 72px; }
  .campaign__tiers { display: flex; flex-direction: column; gap: 0; }
  .campaign__tier { flex-direction: row; align-items: center; gap: var(--s-3); padding: var(--s-3) 0; border-radius: 0; background: none; border-top: 1px solid var(--line); }
  .campaign__tier-amount { margin: 0 0 0 auto; font-size: 18px; white-space: nowrap; }
  .campaign__notes { padding: 0 var(--s-4); }
  /* 介紹超過五行先收起來，按「展開全文」再看全部 */
  .campaign__intro:not(.campaign__intro--open) { max-height: calc(1.8em * 5); overflow: hidden; }
  .campaign__intro--long:not(.campaign__intro--open) { -webkit-mask-image: linear-gradient(#000 60%, transparent); mask-image: linear-gradient(#000 60%, transparent); }
  .campaign__notes summary { min-height: 52px; }
}
@media (min-width: 761px) {
  /* 桌機補件、發獎截止已在頁頭三格裡 */
  .campaign__dates-line { display: none; }
}
@media (prefers-reduced-motion: reduce) { .campaign * { scroll-behavior: auto !important; } }
</style>

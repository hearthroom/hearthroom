<script setup lang="ts">
/**
 * 發卡獎勵活動（創作季）頁的中段：規則卡、我的進度（登入才有）、怎麼參加、參加前看一下。
 * 頁頭在 CampaignPage（跟分享季共用）；這個元件的根節點是 display: contents，裡面的區塊直接排進活動頁的格線：
 * 桌機右欄（跟著捲動）放規則卡與我的進度，左欄放怎麼參加與條款；手機一欄：規則卡 → 我的進度 → 怎麼參加 → 條款
 * （登入的作者回來看的是進度，所以手機上進度緊接在規則卡後）。設計：UIUX 創作季 Canvas 第 17 版（2026-10-17）。
 *
 * 金額、額度、期間全部讀活動設定；日期用活動自己的時區，作者自己的送審時間用作者本地時區。
 */
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { campaignErrorText, fetchRewardProgress, formatNumber, type CardRewardCampaign, type RewardProgress, type RewardProgressItem } from "@/lib/campaign";
import AmountText from "@/components/AmountText.vue";
import { hueFrom } from "@/lib/format";
import { daysUntilReset, remaining } from "@/lib/quota";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { siteName } from "../../../shared/site-name";

const props = defineProps<{ campaign: CardRewardCampaign; loginTo: string }>();
const { t } = useI18n();
const { lp, locale } = useLocalePath();
const session = useSession();

const signedIn = computed(() => !!session.me);
const c = computed(() => props.campaign);
const credits = computed(() => formatNumber(c.value.reward));
const site = computed(() => siteName(locale.value));
const total = computed(() => formatNumber(c.value.reward * c.value.weeklyLimit));
/** 活動時區的月日（10月31日、Oct 31）；結束日是最後一天：結束時刻前 1 毫秒 */
const md = (ms: number) => new Intl.DateTimeFormat(locale.value, { timeZone: c.value.timezone, month: "short", day: "numeric" }).format(ms);
const start = computed(() => md(c.value.startsAt));
const end = computed(() => md(c.value.endsAt - 1));

// ---- 我的進度 -----------------------------------------------------------------
const progress = ref<RewardProgress | null>(null);
const progressError = ref("");
let seq = 0;
async function loadProgress() {
  const mine = ++seq;
  progressError.value = "";
  if (!session.me) { progress.value = null; return; }
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t("auth.expired"));
    const res = await fetchRewardProgress(token, c.value.slug);
    if (mine === seq) progress.value = res;
  } catch (e) {
    if (mine === seq) progressError.value = campaignErrorText(e);
  }
}
watch([() => c.value.slug, () => session.me?.accountNumId ?? null], () => { void loadProgress(); }, { immediate: true });

const quota = computed(() => progress.value?.quota ?? null);
const quotaFull = computed(() => !!quota.value && remaining(quota.value) === 0 && quota.value.packRemaining === 0);
const resetText = computed(() => (!quota.value ? "" : daysUntilReset(quota.value) <= 1 ? t("mine.quota.resetSoon") : t("mine.quota.reset", { n: daysUntilReset(quota.value) })));
const empty = computed(() => !!progress.value && progress.value.items.length === 0);

const SHOWN = 5;
const showAll = ref(false);
const items = computed(() => (progress.value?.items ?? []).slice(0, showAll.value ? undefined : SHOWN));
/** 作者自己的送審時間：作者本地時區的月日 */
const submittedOn = (ms: number) => t("creator.mine.submitted", { date: new Intl.DateTimeFormat(locale.value, { month: "short", day: "numeric" }).format(ms) });
/** 列表狀態：已過審而還沒入帳的（上線前送審、等補發）顯示「已通過」 */
const statusOf = (i: RewardProgressItem) => (i.review === "approved" ? (i.reward?.status === "paid" ? "paid" : "approved") : i.review);
const monogram = (name: string) => Array.from(name.trim())[0] ?? "";
</script>

<template>
  <div class="creator">
    <aside class="creator__side">
      <!-- 規則卡：一個大數字、主按鈕在清單前面（手機第一屏的終點是主按鈕） -->
      <section class="panel creator__card creator__rules" data-rules aria-labelledby="creator-rules-h">
        <h2 id="creator-rules-h" class="creator__label">{{ t("creator.rules.label") }}</h2>
        <p class="creator__big">
          <i18n-t keypath="creator.rules.amount" tag="span" scope="global">
            <template #credits><strong class="creator__big-num num">{{ credits }}</strong></template>
          </i18n-t>
        </p>
        <p class="creator__cap">{{ t("creator.rules.desc") }}</p>

        <div class="creator__actions" data-cta>
          <template v-if="c.phase === 'ended'">
            <RouterLink class="btn btn--primary btn--lg" :to="lp('/mine')">{{ t("creator.cta.ended") }}</RouterLink>
            <p class="creator__line"><span class="creator__who">{{ t("mascot.name") }}</span>{{ t("creator.say.ended", { end }) }}</p>
          </template>
          <template v-else-if="!signedIn">
            <template v-if="session.ready">
              <RouterLink class="btn btn--primary btn--lg" data-signin :to="loginTo">{{ t("creator.cta.signIn") }}</RouterLink>
              <p v-if="c.phase === 'upcoming'" class="creator__line"><span class="creator__who">{{ t("mascot.name") }}</span>{{ t("creator.say.upcoming", { start }) }}</p>
              <p v-else class="creator__cap">{{ t("campaign.page.cta.guest.desc") }}</p>
            </template>
          </template>
          <template v-else-if="c.phase === 'upcoming'">
            <RouterLink class="btn btn--primary btn--lg" :to="lp('/create')">{{ t("creator.cta.write") }}</RouterLink>
            <p class="creator__cap">{{ t("creator.say.upcoming", { start }) }}</p>
          </template>
          <!-- 額度用完：主按鈕換成從我的卡片送審（位置不變），一行說明在它下面，再接寫一張新卡 -->
          <template v-else-if="quotaFull">
            <RouterLink class="btn btn--primary btn--lg" :to="lp('/mine')">{{ t("creator.cta.fromMine") }}</RouterLink>
            <p class="creator__full" data-quota-full>{{ t("creator.cta.quotaFull", { reset: resetText }) }}</p>
            <RouterLink class="btn btn--ghost btn--lg" :to="lp('/create')">{{ t("creator.cta.write") }}</RouterLink>
          </template>
          <template v-else>
            <RouterLink class="btn btn--primary btn--lg" data-write :to="lp('/create')">{{ t("creator.cta.write") }}</RouterLink>
            <RouterLink class="btn btn--lg" :to="lp('/mine')">{{ t("creator.cta.fromMine") }}</RouterLink>
          </template>
        </div>

        <!-- 結束後規則清單收起來（ui.md §4.5）：額度、截止都不再適用 -->
        <ul v-if="c.phase !== 'ended'" class="creator__list">
          <li>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3.25" y="4.25" width="13.5" height="12.5" rx="2.5" /><path d="M3.25 8.25h13.5M7 2.75v3M13 2.75v3" /></svg>
            <i18n-t keypath="creator.rules.limit" tag="span" scope="global">
              <template #count><strong>{{ t("creator.rules.limitCount", { limit: c.weeklyLimit }) }}</strong></template>
              <template #normal>{{ c.normalWeeklyLimit }}</template>
            </i18n-t>
          </li>
          <li>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 6.25V10l2.5 1.75" /></svg>
            <span>{{ t("creator.rules.until", { end }) }}</span>
          </li>
          <li>
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.75l6 2.5v4.5c0 3.75-2.6 6.4-6 7.5-3.4-1.1-6-3.75-6-7.5v-4.5z" /><path d="M7.25 10l2 2 3.5-3.75" /></svg>
            <span>{{ t("creator.rules.own") }}</span>
          </li>
          <li>
            <svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="7.25" /><path d="M10 6.5v7" /></svg>
            <span>{{ t("creator.rules.once") }}</span>
          </li>
          <li>
            <svg viewBox="0 0 20 20" aria-hidden="true"><rect x="4.25" y="2.75" width="11.5" height="14.5" rx="2" /><path d="M7 6.25h6M7 10h1M10 10h1M13 10h0M7 13.25h1M10 13.25h1M13 13.25h0" /></svg>
            <span><AmountText :text="t('creator.rules.calc', { limit: c.weeklyLimit, total })" /></span>
          </li>
        </ul>

        <!-- 活動結束後蘇綺在主按鈕下說過話了，導言不再出現；空狀態時進度卡已有她 -->
        <div v-if="!empty && c.phase !== 'ended'" class="creator__say">
          <img src="/mascot/campaign/pose-got-points.webp" alt="" width="80" height="111" loading="lazy" decoding="async" />
          <p class="creator__bubble" data-lead><span class="creator__who">{{ t("mascot.name") }}</span><AmountText :text="t('creator.lead', { site, credits })" /></p>
        </div>
      </section>

      <!-- 我的進度：這頁的主角 -->
      <section v-if="signedIn" class="panel creator__card creator__mine" data-progress aria-labelledby="creator-mine-h">
        <div class="creator__row">
          <h2 id="creator-mine-h" class="creator__h2">{{ t("creator.mine.title") }}</h2>
          <RouterLink class="creator__more" :to="lp('/mine')">
            {{ t("creator.mine.link") }}
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8 5.5l4.5 4.5L8 14.5" /></svg>
          </RouterLink>
        </div>

        <p v-if="progressError" class="notice notice--error" role="alert">
          {{ progressError }}
          <button type="button" class="btn btn--sm" @click="loadProgress()">{{ t("campaign.page.retry") }}</button>
        </p>
        <div v-else-if="!progress" class="creator__ghosts" aria-hidden="true">
          <div class="creator__cells"><div v-for="i in 3" :key="i" class="ghost creator__ghost-cell" /></div>
          <div v-for="i in 3" :key="i" class="ghost creator__ghost-row" />
        </div>
        <template v-else>
          <div class="creator__cells" :class="{ 'creator__cells--two': c.phase === 'ended' }">
            <!-- 結束後不看本週額度（ui.md §4.5） -->
            <div v-if="c.phase !== 'ended'" class="creator__cell" data-cell="week">
              <span class="creator__cell-label">{{ t("creator.mine.week") }}</span>
              <strong class="creator__cell-num num">{{ progress.quota.used }}/{{ progress.quota.limit }}</strong>
              <span class="creator__pips" aria-hidden="true"><i v-for="i in progress.quota.limit" :key="i" :class="{ on: i <= progress.quota.used }" /></span>
              <span class="creator__cell-sub">{{ resetText }}</span>
            </div>
            <div class="creator__cell" data-cell="approved">
              <span class="creator__cell-label">{{ t("creator.mine.approved") }}</span>
              <strong class="creator__cell-num num">{{ t("creator.mine.count", { n: progress.approvedCount }) }}</strong>
              <span v-if="progress.pendingCount" class="creator__cell-sub">{{ t("creator.mine.inReview", { n: progress.pendingCount }) }}</span>
            </div>
            <div class="creator__cell" data-cell="paid">
              <span class="creator__cell-label">{{ t("creator.mine.paid") }}</span>
              <strong class="creator__cell-num creator__cell-num--paid num">{{ formatNumber(progress.creditsPaid) }}</strong>
              <span class="creator__cell-sub">{{ t("creator.mine.unit") }}</span>
            </div>
          </div>

          <div v-if="empty" class="creator__empty" data-empty>
            <img src="/mascot/home/pose-write-1.webp" alt="" width="96" height="120" loading="lazy" decoding="async" />
            <p class="creator__bubble"><span class="creator__who">{{ t("mascot.name") }}</span>{{ t("creator.say.empty") }}</p>
            <RouterLink v-if="c.phase !== 'ended'" class="btn btn--primary btn--lg" :to="lp('/create')">{{ t("creator.cta.write") }}</RouterLink>
          </div>
          <template v-else>
            <ul class="creator__items">
              <li v-for="i in items" :key="i.cardId">
                <RouterLink class="creator__item" :to="lp(`/cards/${i.cardId}/edit`)" :data-card="i.cardId">
                  <img v-if="i.avatarUrl" class="creator__thumb" :src="i.avatarUrl" alt="" width="40" height="40" loading="lazy" decoding="async" />
                  <span
                    v-else class="creator__thumb creator__mono" aria-hidden="true"
                    :style="{ background: `linear-gradient(160deg, hsl(${hueFrom(i.name)} 45% 78%), hsl(${(hueFrom(i.name) + 40) % 360} 40% 62%))` }"
                  >{{ monogram(i.name) }}</span>
                  <span class="creator__item-text">
                    <span class="creator__item-name">{{ i.name }}</span>
                    <span class="creator__item-date num">{{ submittedOn(i.submittedAt) }}</span>
                  </span>
                  <span class="creator__item-end">
                    <span class="creator__status" :class="`creator__status--${statusOf(i)}`" data-status>{{ t(`creator.mine.status.${statusOf(i)}`) }}</span>
                    <span v-if="statusOf(i) === 'paid'" class="creator__amount num">+{{ formatNumber(i.reward!.amount) }}</span>
                  </span>
                </RouterLink>
              </li>
            </ul>
            <button v-if="!showAll && progress.items.length > SHOWN" type="button" class="btn creator__all" @click="showAll = true">
              {{ t("creator.mine.showAll", { n: progress.items.length }) }}
            </button>
          </template>
        </template>
      </section>
    </aside>

    <div class="creator__body">
      <!-- 怎麼參加：三步，活動結束後不出（ui.md §4.5）。手機上相鄰的卡不同時放蘇綺：未登入時這張緊接規則卡、空狀態時緊接有蘇綺的進度卡，這兩種都不放姿勢 -->
      <section v-if="c.phase !== 'ended'" class="panel creator__card creator__how" :class="{ 'creator__how--quiet': !signedIn || empty }" aria-labelledby="creator-how-h">
        <h2 id="creator-how-h" class="creator__h2">{{ t("creator.how.title") }}</h2>
        <div class="creator__say creator__how-say">
          <img src="/mascot/home/pose-write-2.webp" alt="" width="80" height="111" loading="lazy" decoding="async" />
          <p class="creator__bubble"><span class="creator__who">{{ t("mascot.name") }}</span>{{ t("creator.say.how") }}</p>
        </div>
        <ol class="creator__steps">
          <li><span class="creator__no num">1</span><div><strong>{{ t("creator.how.step1") }}</strong><span class="creator__cap">{{ t("creator.how.step1Desc") }}</span></div></li>
          <li><span class="creator__no num">2</span><div><strong>{{ t("creator.how.step2") }}</strong><span class="creator__cap">{{ t("creator.how.step2Desc", { end, limit: c.weeklyLimit }) }}</span></div></li>
          <li><span class="creator__no num">3</span><div><strong>{{ t("creator.how.step3") }}</strong><span class="creator__cap"><AmountText :text="t('creator.how.step3Desc', { credits })" /></span></div></li>
        </ol>
      </section>

      <details class="panel creator__notes" data-notes>
        <summary>
          <span>{{ t("creator.notes.title") }}</span>
          <span class="creator__cap">{{ t("campaign.page.notes.count", { n: 5 }) }}</span>
        </summary>
        <ul>
          <li>{{ t("creator.notes.1") }}</li>
          <li>{{ t("creator.notes.2") }}</li>
          <li>{{ t("creator.notes.3", { end }) }}</li>
          <li>{{ t("creator.notes.4") }}</li>
          <li>{{ t("creator.notes.5") }}</li>
        </ul>
      </details>
    </div>
  </div>
</template>

<style scoped>
/*
 * 根節點不成盒：右欄（規則卡、我的進度）與左欄（怎麼參加、條款）直接排進 CampaignPage 的格線（grid-area side / body）。
 * 圓角：面板 --r-lg、面板裡的塊 --r-md、縮圖 --r-sm、按鈕與膠囊 pill。
 */
.creator { display: contents; }
.creator svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.creator__side { grid-area: side; display: grid; gap: var(--s-4); position: sticky; top: calc(var(--header-h, 64px) + var(--s-4)); min-width: 0; }
.creator__body { grid-area: body; display: grid; gap: var(--s-5); min-width: 0; }
.creator__card { display: grid; gap: var(--s-3); padding: var(--s-6); min-width: 0; }

.creator__label { margin: 0; font-size: 12px; font-weight: 600; color: var(--text-3); }
.creator__h2 { margin: 0; font-size: 20px; font-weight: 650; line-height: 1.4; }
.creator__cap { display: block; margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-2); }
/* 日文照詞組斷行、不留單獨一個字在最後一行 */
.creator__card, .creator__notes { word-break: auto-phrase; text-wrap: pretty; }
.creator:lang(ko) .creator__card, .creator:lang(ko) .creator__notes, .creator:lang(ko) .creator__bubble { word-break: keep-all; }
.creator__row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.creator__more { display: inline-flex; align-items: center; gap: 2px; min-height: 44px; font-size: 14px; font-weight: 600; color: var(--accent-text); }
.creator__more svg { width: 16px; height: 16px; }

/* ---- 規則卡 ---- */
/* 頁面上最大的字：數字與單位同一行不換行 */
.creator__big { margin: 0; font-size: 18px; font-weight: 700; color: var(--accent-text); white-space: nowrap; line-height: 1.1; }
.creator__big-num { font-size: 48px; font-weight: 800; letter-spacing: -0.02em; }
.creator__actions { display: grid; gap: var(--s-2); margin-top: var(--s-1); }
.creator__actions .btn { justify-content: center; min-height: 44px; }
.creator__full { margin: 0; font-size: 13px; line-height: 1.55; color: var(--text-2); text-align: center; }
.creator__line { margin: 0; font-size: 13.5px; line-height: 1.6; color: var(--text-2); text-wrap: balance; }
.creator__list { list-style: none; margin: var(--s-1) 0 0; padding: var(--s-3) 0 0; border-top: 1px solid var(--line); display: grid; gap: 6px; }
.creator__list li { display: flex; align-items: flex-start; gap: var(--s-2); font-size: 13px; line-height: 1.6; }
.creator__list svg { margin-top: 1px; color: var(--accent-text); }
.creator__list strong { color: var(--text); font-weight: 700; }

.creator__say { display: flex; align-items: flex-end; gap: var(--s-3); }
.creator__say > img { flex: none; width: 80px; height: 111px; object-fit: contain; }
/* 氣泡短：平均分行，不留一兩個字在最後一行；日文照詞組斷、韓文只在空格斷 */
.creator__bubble {
  text-wrap: balance; word-break: auto-phrase;
  margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-lg) var(--r-lg) var(--r-lg) 4px;
  background: color-mix(in srgb, var(--accent) 10%, var(--surface)); font-size: 14px; line-height: 1.55;
}
.creator__who { display: block; font-size: 12px; font-weight: 700; color: var(--accent-text); }
.creator__line .creator__who { display: inline; margin-right: 6px; }

/* ---- 我的進度 ---- */
.creator__cells { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-2); }
.creator__cells--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
/* 右欄只有約 360 寬，三格各約 100：數字跟著格寬縮（最大 28），180,000 也放得下 */
.creator__cell { min-width: 0; display: grid; gap: 2px; align-content: start; padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); container-type: inline-size; }
.creator__cell-label { font-size: 12px; color: var(--text-3); }
.creator__cell-num { font-size: clamp(16px, 24cqi, 28px); font-weight: 700; line-height: 1.2; white-space: nowrap; }
.creator__cell-num--paid { color: var(--success); }
/* 小字跟著格寬縮、一行放完（「3 日後にリセット」不拆兩行） */
.creator__cell-sub { font-size: clamp(10px, 11.5cqi, 12px); color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.creator__pips { display: flex; gap: 2px; margin: 2px 0; }
.creator__pips i { flex: 0 1 10px; min-width: 4px; height: 6px; border-radius: var(--r-pill); background: var(--surface); box-shadow: inset 0 0 0 1px var(--line-strong); }
.creator__pips i.on { background: var(--accent-grad); box-shadow: none; }
.creator__ghosts { display: grid; gap: var(--s-2); }
.creator__ghost-cell { height: 96px; border-radius: var(--r-md); }
.creator__ghost-row { height: 52px; border-radius: var(--r-md); }

.creator__items { list-style: none; margin: 0; padding: 0; display: grid; }
.creator__items li + li { border-top: 1px solid var(--line); }
.creator__item { display: flex; align-items: center; gap: var(--s-3); min-height: 56px; padding: var(--s-2) 0; color: var(--text); text-decoration: none; }
.creator__item:hover .creator__item-name { text-decoration: underline; text-underline-offset: 3px; }
.creator__thumb { flex: none; width: 40px; height: 40px; border-radius: var(--r-sm); object-fit: cover; background: var(--surface-2); }
.creator__mono { display: grid; place-items: center; font-size: 16px; font-weight: 700; color: #fff; }
.creator__item-text { flex: 1; min-width: 0; display: grid; gap: 2px; }
.creator__item-name { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.creator__item-date { font-size: 12px; color: var(--text-3); }
.creator__item-end { flex: none; display: grid; justify-items: end; gap: 2px; }
.creator__status { padding: 1px 8px; border-radius: var(--r-pill); font-size: 12px; font-weight: 600; background: var(--surface-2); color: var(--text-2); white-space: nowrap; }
.creator__status--approved, .creator__status--paid { background: var(--success-soft); color: var(--success); }
.creator__status--rejected { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); color: var(--danger); }
.creator__amount { font-size: 13px; font-weight: 700; color: var(--success); }
.creator__all { justify-self: stretch; min-height: 44px; }
.creator__empty { display: grid; justify-items: center; gap: var(--s-3); padding: var(--s-2) 0; text-align: center; }
.creator__empty > img { width: 96px; height: 120px; object-fit: contain; }
.creator__empty .btn { justify-self: stretch; justify-content: center; }

/* ---- 怎麼參加：桌機姿勢在左一窄欄、標題與氣泡在右；三步在下面用整張卡的寬（每步標題一行放得下）；手機上下排 ---- */
.creator__how { grid-template-columns: 80px minmax(0, 1fr); grid-template-areas: "pose h" "pose say" "steps steps"; align-items: start; column-gap: var(--s-4); }
.creator__how > .creator__h2 { grid-area: h; }
.creator__how-say { display: contents; }
.creator__how-say > img { grid-area: pose; align-self: start; }
.creator__how-say > .creator__bubble { grid-area: say; justify-self: start; }
.creator__how .creator__steps { grid-area: steps; }
.creator__steps { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-4); grid-template-columns: repeat(3, minmax(0, 1fr)); }
.creator__steps > li { display: flex; align-items: flex-start; gap: var(--s-3); min-width: 0; }
.creator__steps strong { display: block; font-size: 15px; line-height: 1.45; text-wrap: balance; }
.creator__no {
  flex: none; display: grid; place-items: center; width: 28px; height: 28px; border-radius: var(--r-pill);
  background: var(--accent-soft); color: var(--accent-text); font-size: 13px; font-weight: 700;
}

/* ---- 參加前看一下 ---- */
.creator__notes { padding: 0 var(--s-6); }
.creator__notes summary {
  min-height: 56px; display: flex; align-items: center; justify-content: space-between; gap: var(--s-3);
  font-size: 16px; font-weight: 650; cursor: pointer; list-style: none;
}
.creator__notes summary::-webkit-details-marker { display: none; }
.creator__notes ul { margin: 0 0 var(--s-5); padding-left: 1.2em; display: grid; gap: 6px; font-size: 13.5px; line-height: 1.6; color: var(--text-2); }

@media (max-width: 1020px) {
  .creator__steps { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .creator__how { grid-template-columns: minmax(0, 1fr); grid-template-areas: none; }
  .creator__how > .creator__h2, .creator__how .creator__steps { grid-area: auto; }
  .creator__how-say { display: flex; flex-direction: row; align-items: flex-end; }
  .creator__how-say > img, .creator__how-say > .creator__bubble { grid-area: auto; }
}
@media (max-width: 860px) {
  /* 一欄：右欄與左欄都拆開，照 order 排成 頁頭(1) → 規則卡 → 我的進度 → 怎麼參加 → 條款 */
  .creator__side, .creator__body { display: contents; }
  .creator__rules { order: 2; }
  .creator__mine { order: 3; }
  .creator__how { order: 4; }
  .creator__notes { order: 5; }
}
@media (max-width: 760px) {
  .creator__card { padding: var(--s-4); }
  .creator__h2 { font-size: 18px; }
  .creator__big { font-size: 16px; }
  .creator__big-num { font-size: 40px; }
  .creator__say > img { width: 64px; height: 89px; }
  .creator__cell { padding: var(--s-2); }
  .creator__how--quiet .creator__how-say > img { display: none; }
  /* 沒有姿勢時氣泡不撐滿整列，跟字的寬度差不多 */
  .creator__how--quiet .creator__bubble { max-width: 24em; text-wrap: pretty; }
  .creator__notes { padding: 0 var(--s-4); }
  .creator__notes summary { min-height: 52px; }
}
</style>

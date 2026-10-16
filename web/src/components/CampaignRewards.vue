<script setup lang="ts">
/**
 * 活動頁的「獎勵怎麼拿」：分享拿積分（活動檔位的最低～最高）、朋友來儲值你拿多少（Harbor 公開的推薦規則），
 * 以及這一屏的主要動作——訪客登入、會員複製自己的專屬連結。手機上這塊是第一屏的終點（設計：約戰 UIUX M2）。
 *
 * 推薦規則讀不到、推薦關著、或分成都是 0 時，整個推薦格不出，標題改成「分享拿積分」；單一數值是 0 的那一行也不出。
 * 專屬連結＝首頁網址＋自己的推薦碼（?ref=），登入就給，不必先提交分享（owner 2026-10-16）。
 * 連到首頁不連活動頁：看到連結的是沒來過的朋友，要先看到網站本身（owner 2026-10-17）；首頁帶 ?ref= 時分享預覽是邀請版（src/campaign-head.ts）。
 * 推薦碼讀不到（舊登入沒授權推薦、服務暫時不通）就給不帶碼的網址，分享照樣能用，只是推薦獎勵算不到。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { formatNumber, TIERS, type PublicCampaign } from "@/lib/campaign";
import { friendTotal, referralShown, type ReferralTerms } from "@/lib/referral-terms";
import { useSession } from "@/lib/session";
import { currentReferralCode, withShareRef } from "@/lib/share-ref";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ campaign: PublicCampaign; terms: ReferralTerms | null; loginTo: string }>();
const { t } = useI18n();
const { lp } = useLocalePath();
const session = useSession();

const amounts = computed(() => TIERS.map((k) => props.campaign.tiers[k]).filter((v): v is number => typeof v === "number"));
const range = computed(() => (amounts.value.length ? { min: formatNumber(Math.min(...amounts.value)), max: formatNumber(Math.max(...amounts.value)) } : null));
const ref$ = computed(() => (referralShown(props.terms) ? props.terms : null));
/** 365 天說「一年」，其他照天數 */
const period = (days: number) => (days === 365 ? t("campaign.page.periodYear") : t("campaign.page.periodDays", { n: days }));

const signedIn = computed(() => !!session.me);

// ---- 專屬連結 ------------------------------------------------------------------
const refCode = ref<string | null>(null);
const ready = ref(false);
watch(() => session.me?.accountNumId ?? null, async (id) => {
  refCode.value = null;
  ready.value = false;
  if (!id) return;
  const code = await currentReferralCode(id);
  if ((session.me?.accountNumId ?? null) !== id) return;
  refCode.value = code;
  ready.value = true;
}, { immediate: true });
const link = computed(() => withShareRef(new URL(lp("/"), location.origin).href, refCode.value));

const copied = ref(false);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  try {
    await navigator.clipboard.writeText(link.value);
    copied.value = true;
    clearTimeout(timer);
    timer = setTimeout(() => { copied.value = false; }, 1800);
    track("campaign_share", { subject: props.campaign.slug });
  } catch { /* 拿不到剪貼簿：連結就在畫面上 */ }
}
/** 系統分享面板：手機瀏覽器才有，沒有就不顯示這顆鈕 */
const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
async function share() {
  try {
    await navigator.share({ url: link.value });
    track("campaign_share", { subject: props.campaign.slug });
  } catch { /* 使用者取消 */ }
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <section class="panel rewards" data-rewards aria-labelledby="rewards-h">
    <h2 id="rewards-h" class="rewards__h">{{ ref$ ? t("campaign.page.rewards.title") : t("campaign.page.rewards.titleShareOnly") }}</h2>
    <div class="rewards__stats" :class="{ 'rewards__stats--one': !ref$ }">
      <div v-if="range" class="rewards__stat" data-stat="share">
        <span class="rewards__label">{{ t("campaign.page.rewards.share.label") }}</span>
        <b class="rewards__value num">{{ t("campaign.page.rewards.share.value", range) }}</b>
        <span class="rewards__cap">{{ t("campaign.page.rewards.share.desc") }}</span>
      </div>
      <div v-if="ref$" class="rewards__stat" data-stat="referral">
        <span class="rewards__label">{{ t("campaign.page.rewards.referral.label") }}</span>
        <b v-if="ref$.firstPercent > 0" class="rewards__value num">{{ t("campaign.page.rewards.referral.value", { first: ref$.firstPercent }) }}</b>
        <span v-if="ref$.firstPercent > 0 && ref$.firstCap > 0" class="rewards__cap num">{{ t("campaign.page.rewards.referral.cap", { cap: formatNumber(ref$.firstCap) }) }}</span>
        <span v-if="ref$.rebatePercent > 0 && ref$.rebateDays > 0" class="rewards__cap num" data-rebate>{{ t("campaign.page.rewards.referral.rebate", { rebate: ref$.rebatePercent, period: period(ref$.rebateDays) }) }}</span>
      </div>
    </div>

    <!-- 登入狀態還在確認時先不說「請登入」，免得已登入的人看到一閃 -->
    <div v-if="!signedIn && session.ready" class="rewards__cta" data-guest-cta>
      <div class="rewards__row">
        <div class="rewards__text">
          <strong class="rewards__cta-title">{{ t("campaign.page.cta.guest.title") }}</strong>
          <span v-if="ref$ && friendTotal(ref$) > 0" class="rewards__desc num">{{ t("campaign.page.cta.friendGift", { friendTotal: formatNumber(friendTotal(ref$)) }) }}</span>
          <span v-if="ref$ && ref$.inviteePercent > 0" class="rewards__desc num">{{ t("campaign.page.cta.inviteeBonus", { inviteePercent: ref$.inviteePercent }) }}</span>
          <span v-if="!ref$" class="rewards__desc">{{ t("campaign.page.cta.shareOnlyHint") }}</span>
        </div>
        <img class="rewards__pose" src="/mascot/campaign/pose-share-phone.webp" alt="" width="72" height="100" decoding="async" />
      </div>
      <RouterLink class="btn btn--primary btn--lg rewards__btn" data-signin :to="loginTo">{{ t("campaign.page.cta.guest.button") }}</RouterLink>
      <!-- 「還沒有帳號也沒關係」放在按鈕下：英日的說明較長，放上面會把按鈕擠出手機第一屏 -->
      <span class="rewards__desc rewards__desc--under">{{ t("campaign.page.cta.guest.desc") }}</span>
    </div>

    <div v-else-if="signedIn" class="rewards__cta" data-invite-link :aria-busy="!ready">
      <div class="rewards__row rewards__row--end">
        <div class="field rewards__text">
          <label class="rewards__link-label" for="invite-link">{{ t("campaign.share.title") }}</label>
          <input id="invite-link" class="input rewards__url num" readonly :value="link" @focus="($event.target as HTMLInputElement).select()" />
        </div>
        <img class="rewards__pose rewards__pose--sm" src="/mascot/campaign/pose-share-phone.webp" alt="" width="56" height="78" decoding="async" />
      </div>
      <div class="rewards__actions" :class="{ 'rewards__actions--two': canShare }">
        <button type="button" class="btn btn--primary btn--lg rewards__btn" data-action="copy-invite" :disabled="!ready" @click="copy">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path v-if="copied" d="M5 10.5l3.25 3.25L15 7" /><template v-else><rect x="7" y="7" width="9" height="9" rx="2" /><path d="M13 7V5.5A1.5 1.5 0 0 0 11.5 4h-6A1.5 1.5 0 0 0 4 5.5v6A1.5 1.5 0 0 0 5.5 13H7" /></template></svg>
          {{ copied ? t("campaign.share.copied") : t("campaign.share.copy") }}
        </button>
        <button v-if="canShare" type="button" class="btn btn--lg rewards__btn" data-action="share-invite" :disabled="!ready" @click="share">
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v10M6 7l4-4 4 4M4 12v3.5A1.5 1.5 0 0 0 5.5 17h9a1.5 1.5 0 0 0 1.5-1.5V12" /></svg>
          {{ t("campaign.share.more") }}
        </button>
      </div>
      <span v-if="ref$ && friendTotal(ref$) > 0" class="rewards__desc num">{{ t("campaign.page.cta.friendGift", { friendTotal: formatNumber(friendTotal(ref$)) }) }}</span>
      <span v-if="ref$ && ref$.inviteePercent > 0" class="rewards__desc num">{{ t("campaign.page.cta.inviteeBonus", { inviteePercent: ref$.inviteePercent }) }}</span>
      <span class="rewards__desc">{{ t("campaign.page.cta.member.desc") }}</span>
    </div>
  </section>
</template>

<style scoped>
.rewards { display: grid; gap: var(--s-4); padding: var(--s-5); min-width: 0; }
.rewards svg { flex: none; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.7; stroke-linecap: round; stroke-linejoin: round; }
.rewards__h { margin: 0; font-size: 18px; font-weight: 650; line-height: 1.4; }
.rewards__stats { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-2); }
.rewards__stats--one { grid-template-columns: minmax(0, 1fr); }
.rewards__stat { display: flex; flex-direction: column; gap: 2px; min-width: 0; padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); }
.rewards__label { font-size: 12.5px; font-weight: 600; color: var(--text-2); text-wrap: balance; }
/* 數字本身不拆開（keep-all：「500–10,000」整段一起換行），英日的單位放不下時換到下一行 */
.rewards__value { font-size: 22px; font-weight: 700; line-height: 1.3; color: var(--accent-text); word-break: keep-all; overflow-wrap: normal; }
.rewards__cap { font-size: 12px; line-height: 1.5; color: var(--text-2); text-wrap: pretty; }
.rewards__cta { display: grid; gap: var(--s-3); }
.rewards__row { display: flex; align-items: center; gap: var(--s-3); }
.rewards__row--end { align-items: flex-end; }
.rewards__text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 4px; }
.rewards__cta-title { font-size: 15px; font-weight: 650; }
.rewards__desc { font-size: 13px; line-height: 1.6; color: var(--text-2); }
.rewards__desc--under { margin-top: calc(-1 * var(--s-1)); text-align: center; }
.rewards__pose { flex: none; width: 72px; height: 100px; object-fit: contain; }
.rewards__pose--sm { width: 56px; height: 78px; }
.rewards__link-label { font-size: 13px; font-weight: 600; }
.rewards__url { font-size: 13px; }
.rewards__actions { display: grid; gap: var(--s-2); }
.rewards__actions--two { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.rewards__btn { width: 100%; min-height: 48px; }
/* 桌機在右欄（約 360 寬）：兩格並排放不下「500–10,000 積分」，改上下排 */
@media (min-width: 861px) {
  .rewards__stats { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 760px) {
  .rewards { padding: var(--s-4); gap: var(--s-3); }
  .rewards__h { font-size: 16px; }
  .rewards__value { font-size: 18px; }
  /* 這一列的高度由立繪撐著：手機縮到跟已登入一樣，英日說明較長時按鈕才留在第一屏 */
  .rewards__pose { width: 56px; height: 78px; }
}
@media (prefers-reduced-motion: reduce) { .rewards * { transition: none !important; } }
</style>

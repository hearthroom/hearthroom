<script setup lang="ts">
/**
 * 邀請獎勵：自己的推薦碼與成果，以及（新帳號）填朋友推薦碼的地方。
 *
 * 填碼刻意不是預設畫面：自己來註冊的人不該被提醒去網路上找一個碼來填；
 * 朋友給的邀請連結（?code=）會直接落在填碼那一頁並帶好碼。
 * 積分頁的邀請卡（WalletInvite）會對「服務說還能填」的帳號提填碼：那是看得到自己還有資格的人，不是泛泛提醒。
 * 數字都從服務讀，畫面不寫死；推薦只有接上的服務有這項能力時才有意義。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ApiError, fetchReferral, redeemReferral, type ReferralSummary } from "@/lib/api";
import { accountToken } from "@/lib/connections";
import { beginLogin } from "@/lib/oauth";
import { currentProvider } from "@/lib/provider";
import { useSession } from "@/lib/session";
import { pageTitle } from "@/lib/i18n";
import { dateOnly, dateTime, whole } from "@/lib/format";
import { withShareRef } from "@/lib/share-ref";
import { useLocalePath } from "@/lib/use-locale";

const { t, locale } = useI18n();
const { lp } = useLocalePath();
const route = useRoute();
const router = useRouter();
const session = useSession();
const provider = currentProvider();
const externalId = computed(() => session.profile?.identities.find((i) => i.provider === provider)?.externalId ?? session.me?.accountNumId);

const data = ref<ReferralSummary | null>(null);
const inviterBonus = computed(() => !!data.value?.enabled && (data.value?.terms.inviterCredits ?? 0) > 0 && Date.parse(data.value?.terms.inviterEndAt ?? "") > Date.now());
const promotionEnd = computed(() => data.value?.terms.inviterEndAt ? new Intl.DateTimeFormat(locale.value, { timeZone: "Asia/Taipei", dateStyle: "medium", timeStyle: "short" }).format(Date.parse(data.value.terms.inviterEndAt) - 1) : "");
const loadError = ref("");
const needsConsent = ref(false);

const tab = computed({
  get: () => (route.query.tab === "enter" || typeof route.query.code === "string" ? "enter" : "mine"),
  set: (v: string) => { void router.replace({ query: v === "enter" ? { tab: "enter" } : {} }); },
});

async function token(): Promise<string> {
  const value = await accountToken(provider, externalId.value);
  if (!value) throw new Error(t("auth.expired"));
  return value;
}

async function load() {
  loadError.value = "";
  needsConsent.value = false;
  try {
    data.value = await fetchReferral(await token(), provider);
  } catch (err) {
    if (err instanceof ApiError && err.code === "insufficient_scope") needsConsent.value = true;
    else loadError.value = err instanceof Error ? err.message : t("state.loadFailed");
  }
}

function reauthorize() {
  void beginLogin(route.fullPath, { provider });
}

const copied = ref<"" | "code" | "link">("");
// 邀請連結跟分享卡片同一條路（lib/share-ref.ts）：朋友點進來先記下，註冊後自動帶入，不用自己再填。
// 舊的 ?code= 連結照舊落在填碼頁。
const inviteLink = computed(() => data.value ? withShareRef(new URL(lp("/"), location.origin).href, data.value.code) : "");
async function copy(kind: "code" | "link") {
  if (!data.value) return;
  try {
    await navigator.clipboard.writeText(kind === "code" ? data.value.code : inviteLink.value);
    copied.value = kind;
    setTimeout(() => { copied.value = ""; }, 1800);
  } catch { /* 拿不到剪貼簿：碼就在畫面上 */ }
}

const code = ref(typeof route.query.code === "string" ? route.query.code.trim().toUpperCase() : "");
const pending = ref(false);
const errorKey = ref("");
const KNOWN = new Set(["referral_code_invalid", "referral_self", "referral_already_bound", "referral_window_closed", "referral_disabled"]);
const error = computed(() => errorKey.value ? t(`referral.error.${errorKey.value}`, { days: data.value?.terms.bindDays ?? 7 }) : "");

async function redeem() {
  if (pending.value || !code.value.trim()) return;
  pending.value = true;
  errorKey.value = "";
  try {
    data.value = await redeemReferral(await token(), code.value.trim().toUpperCase(), provider);
  } catch (err) {
    if (err instanceof ApiError && err.code === "insufficient_scope") needsConsent.value = true;
    else errorKey.value = err instanceof ApiError && KNOWN.has(err.code) ? err.code : "unknown";
  } finally {
    pending.value = false;
  }
}

onMounted(() => {
  document.title = pageTitle(t("referral.title"));
  void load();
});
</script>

<template>
  <div class="page referral">
    <header>
      <h1 class="display">{{ $t("referral.title") }}</h1>
      <p v-if="inviterBonus && data?.terms.firstChatCredits !== undefined" class="referral__lead">{{ $t(data?.terms.inviterCredits === data?.terms.welcomeCredits ? "referral.lead" : "referral.leadSplit", { inviter: whole(data?.terms.inviterCredits ?? 0), friend: whole(data?.terms.welcomeCredits ?? 0), bind: whole(data?.terms.inviterCredits ?? 0), first: whole(data?.terms.firstChatCredits ?? 0) }) }}</p>
    </header>

    <section v-if="needsConsent" class="panel referral__card">
      <p>{{ $t("referral.consent") }}</p>
      <button type="button" class="btn btn--primary" data-testid="referral-reauthorize" @click="reauthorize">{{ $t("referral.consentAction") }}</button>
    </section>
    <p v-else-if="loadError" class="panel referral__card referral__error" role="alert">{{ loadError }} <button type="button" class="btn btn--sm" @click="load">{{ $t("referral.retry") }}</button></p>
    <p v-else-if="!data" class="subtle">{{ $t("state.loading") }}</p>

    <template v-else>
      <p v-if="!data.enabled" class="panel referral__card subtle">{{ $t("referral.disabled") }}</p>
      <div class="seg" role="tablist">
        <button type="button" role="tab" class="seg__item" :class="{ 'seg__item--on': tab === 'mine' }" :aria-selected="tab === 'mine'" @click="tab = 'mine'">{{ $t("referral.tabMine") }}</button>
        <button type="button" role="tab" class="seg__item" :class="{ 'seg__item--on': tab === 'enter' }" :aria-selected="tab === 'enter'" @click="tab = 'enter'">{{ $t("referral.tabEnter") }}</button>
      </div>

      <template v-if="tab === 'mine'">
        <div class="referral__grid">
          <section class="panel referral__card">
            <h2>{{ $t("referral.codeTitle") }}</h2>
            <div class="referral__code" data-testid="referral-code">{{ data.code }}</div>
            <div class="referral__actions">
              <button type="button" class="btn btn--primary" @click="copy('code')">{{ copied === "code" ? $t("referral.copiedCode") : $t("referral.copyCode") }}</button>
              <button type="button" class="btn" @click="copy('link')">{{ copied === "link" ? $t("referral.copiedLink") : $t("referral.copyLink") }}</button>
            </div>
          </section>
          <section class="panel referral__card">
            <h2>{{ $t("referral.statsTitle") }}</h2>
            <div class="referral__tiles">
              <div class="referral__tile"><span>{{ $t("referral.invited") }}</span><strong><b class="num">{{ whole(data.invited) }}</b> <small>{{ $t("referral.unitPeople") }}</small></strong></div>
              <div class="referral__tile"><span>{{ $t("referral.purchased") }}</span><strong><b class="num">{{ whole(data.purchased) }}</b> <small>{{ $t("referral.unitPeople") }}</small></strong></div>
              <div class="referral__tile"><span>{{ $t("referral.earned") }}</span><strong><b class="num">{{ whole(data.earned) }}</b> <small>{{ $t("referral.unitCredits") }}</small></strong></div>
            </div>
          </section>
        </div>
        <section v-if="data.invites" class="panel referral__card" data-testid="referral-invites">
          <h2>{{ $t("referral.invites.title") }}</h2>
          <p v-if="(data.invitesTotal ?? 0) > data.invites.length" class="subtle" data-testid="invites-total">{{ $t("referral.invites.total", { total: whole(data.invitesTotal ?? 0), shown: whole(data.invites.length) }) }}</p>
          <ul v-if="data.invites.length" class="referral__invites">
            <li v-for="(invite, index) in data.invites" :key="index" class="referral__invite" data-testid="referral-invite">
              <time :datetime="invite.boundAt">{{ $t("referral.invites.joined", { date: dateTime(invite.boundAt) }) }}</time>
              <span :data-testid="`invite-${invite.firstChat}`">{{ $t(`referral.invites.${invite.firstChat}`, { firstChatBy: dateTime(invite.firstChatBy) }) }}</span>
              <div class="referral__invite-amounts">
                <strong class="num" data-testid="invite-credited">{{ $t(invite.credited > 0 ? "referral.invites.credited" : "referral.invites.none", { credited: whole(invite.credited) }) }}</strong>
                <span v-if="invite.pending > 0" class="subtle" data-testid="invite-pending">{{ $t(invite.pendingUntil ? "referral.invites.pending" : "referral.invites.pendingReview", { pending: whole(invite.pending), pendingUntil: invite.pendingUntil ? dateTime(invite.pendingUntil) : "" }) }}</span>
              </div>
            </li>
          </ul>
          <template v-else>
            <h3>{{ $t("referral.invites.emptyTitle") }}</h3>
            <p class="subtle">{{ $t("referral.invites.emptyBody") }}</p>
            <button type="button" class="btn btn--lg referral__empty-copy" data-testid="invites-empty-copy" @click="copy('link')">{{ copied === "link" ? $t("referral.copiedLink") : $t("referral.copyLink") }}</button>
          </template>
        </section>
        <section class="panel referral__card">
          <h2>{{ $t("referral.rulesTitle") }}</h2>
          <ul class="referral__rules">
            <template v-if="inviterBonus && data.terms.firstChatCredits !== undefined">
              <li data-testid="inviter-bonus">{{ $t(data.terms.inviterCredits === data.terms.welcomeCredits ? "referral.rule.bind" : "referral.rule.bindSplit", { inviter: whole(data.terms.inviterCredits ?? 0), friend: whole(data.terms.welcomeCredits), credits: whole(data.terms.inviterCredits ?? 0) }) }}</li>
              <li>{{ $t("referral.rule.chat", { days: data.terms.firstChatDays, credits: whole(data.terms.firstChatCredits) }) }}</li>
              <li>{{ $t("referral.rule.permanent") }}</li>
              <li>{{ $t("referral.rule.period", { end: promotionEnd }) }}</li>
            </template>
            <li v-else-if="inviterBonus" data-testid="inviter-bonus">{{ $t("referral.rule.inviter", { credits: whole(data.terms.inviterCredits ?? 0), end: dateTime(data.terms.inviterEndAt!) }) }}</li>
            <li v-if="data.terms.welcomeCredits > 0 && data.terms.firstChatCredits === undefined">{{ $t(data.terms.welcomeDays === 0 ? "referral.rule.welcomePermanent" : "referral.rule.welcome", { credits: whole(data.terms.welcomeCredits), days: data.terms.welcomeDays }) }}</li>
            <li>{{ $t("referral.rule.first", { percent: data.terms.firstPercent, cap: whole(data.terms.firstCap) }) }}</li>
            <li v-if="data.terms.rebatePercent > 0">{{ $t("referral.rule.rebate", { rate: data.terms.rebatePercent, days: data.terms.rebateDays }) }}</li>
            <li v-if="data.terms.inviteePercent > 0">{{ $t("referral.rule.invitee", { percent: data.terms.inviteePercent }) }}</li>
            <li>{{ $t("referral.rule.refund") }}</li>
            <li>{{ $t("referral.rule.scope") }}</li>
          </ul>
        </section>
      </template>

      <section v-else class="panel referral__card">
        <h2>{{ $t("referral.redeemTitle") }}</h2>
        <form v-if="data.enabled && data.canRedeem" class="referral__form" data-testid="referral-form" @submit.prevent="redeem">
          <p id="referral-help" class="subtle">{{ data.referred ? $t("referral.switchHelp", { date: data.redeemUntil ? dateTime(data.redeemUntil) : "" }) : $t("referral.redeemHelp", { date: data.redeemUntil ? dateOnly(Math.floor(Date.parse(data.redeemUntil) / 1000)) : "" }) }}</p>
          <label class="field">
            <span>{{ $t("referral.codeLabel") }}</span>
            <span class="referral__controls">
              <input v-model="code" class="input" data-testid="referral-input" aria-describedby="referral-help" :placeholder="$t('referral.placeholder')" maxlength="32" autocomplete="off" autocapitalize="characters" spellcheck="false" :disabled="pending" @input="errorKey = ''" />
              <button type="submit" class="btn btn--primary" :disabled="pending || !code.trim()">{{ $t("referral.submit") }}</button>
            </span>
          </label>
          <p v-if="error" class="referral__error" role="alert">{{ error }}</p>
        </form>
        <p v-else-if="data.referred" class="subtle" data-testid="referral-entered">{{ data.welcomeCredits > 0 ? $t("referral.enteredWithGift", { credits: whole(data.welcomeCredits) }) : $t("referral.entered") }}</p>
        <p v-else class="subtle">{{ $t("referral.redeemClosed", { days: data.terms.bindDays }) }}</p>
      </section>
    </template>
  </div>
</template>

<style scoped>
.referral { max-width: 1080px; display: grid; gap: var(--s-5); align-content: start; }
h1 { font-size: 1.5rem; margin: 0; }
.referral__lead { margin: var(--s-2) 0 0; color: var(--text-2); }
.referral__card { padding: var(--s-5); display: grid; gap: var(--s-3); align-content: start; min-width: 0; }
.referral__card h2 { margin: 0; font-size: 16px; font-weight: 650; }
.referral__grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-4); }
.referral__code { font-size: 28px; font-weight: 700; letter-spacing: .08em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.referral__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.referral__tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: var(--s-3); }
.referral__tile { display: grid; gap: var(--s-1); padding: var(--s-3); border-radius: var(--r-md); background: var(--surface-2); min-width: 0; }
.referral__tile span { font-size: 12px; color: var(--text-2); }
.referral__tile strong { font-size: 22px; font-weight: 700; overflow-wrap: anywhere; }
.referral__tile small { font-size: 12px; font-weight: 400; color: var(--text-2); }
.referral__rules { margin: 0; padding-left: 1.2em; display: grid; gap: var(--s-2); color: var(--text-2); line-height: 1.6; }
.referral__form { display: grid; gap: var(--s-3); }
.referral__form p { margin: 0; }
.referral__controls { display: flex; gap: var(--s-2); }
.referral__controls .input { flex: 1; min-width: 0; }
.referral__error { color: var(--danger); margin: 0; }
.referral__invites { list-style: none; margin: 0; padding: 0; }
.referral__invite { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) minmax(0, 1fr); align-items: start; gap: var(--s-3); padding: var(--s-3) 0; overflow-wrap: anywhere; font-size: 14px; }
.referral__invite + .referral__invite { border-top: 1px solid var(--line); }
.referral__invite time { color: var(--text-2); }
.referral__invite-amounts { display: grid; gap: var(--s-1); text-align: end; }
.referral__invite-amounts strong { font-weight: 600; white-space: nowrap; }
.referral__card h3 { margin: 0; font-size: 14px; font-weight: 600; }
.referral__empty-copy { justify-self: start; }
@media (max-width: 640px) {
  .referral__tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .referral__tile:last-child { grid-column: 1 / -1; }
  .referral__invite { grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
  .referral__invite-amounts { text-align: start; }
}
@media (max-width: 700px) {
  .referral__grid { grid-template-columns: 1fr; }
  .referral__controls { flex-direction: column; }
}
</style>

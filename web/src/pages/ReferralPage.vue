<script setup lang="ts">
/**
 * 邀請獎勵：自己的推薦碼與成果，以及（新帳號）填朋友推薦碼的地方。
 *
 * 填碼刻意不是預設畫面：自己來註冊的人不該被提醒去網路上找一個碼來填；
 * 朋友給的邀請連結（?code=）會直接落在填碼那一頁並帶好碼。
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
import { dateOnly, whole } from "@/lib/format";

const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const session = useSession();
const provider = currentProvider();
const externalId = computed(() => session.profile?.identities.find((i) => i.provider === provider)?.externalId ?? session.me?.accountNumId);

const data = ref<ReferralSummary | null>(null);
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
const inviteLink = computed(() => data.value ? `${location.origin}${route.path}?code=${encodeURIComponent(data.value.code)}` : "");
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
      <p class="referral__lead">{{ $t("referral.lead") }}</p>
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
        <section class="panel referral__card">
          <h2>{{ $t("referral.rulesTitle") }}</h2>
          <ul class="referral__rules">
            <li v-if="data.terms.welcomeCredits > 0">{{ $t("referral.rule.welcome", { credits: whole(data.terms.welcomeCredits), days: data.terms.welcomeDays }) }}</li>
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
          <p id="referral-help" class="subtle">{{ $t("referral.redeemHelp", { date: data.redeemUntil ? dateOnly(Math.floor(Date.parse(data.redeemUntil) / 1000)) : "" }) }}</p>
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
@media (max-width: 700px) {
  .referral__grid { grid-template-columns: 1fr; }
  .referral__controls { flex-direction: column; }
}
</style>

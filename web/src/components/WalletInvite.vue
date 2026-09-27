<script setup lang="ts">
/**
 * 積分頁上的邀請獎勵入口：拿積分最直接的兩條路之一（另一條是儲值），所以跟餘額放在同一排。
 *
 * 還能填推薦碼的新帳號看到的是「填碼領積分」；其他人看到自己的推薦碼、可以直接複製。
 * 邀請頁本身刻意不把填碼當預設畫面（見 ReferralPage）；這裡是 owner 2026-09-27 要求的入口，
 * 只在服務說「這個帳號還能填」時才提，不會對早就過了期限的人一直推。
 * 讀不到（沒授權、服務暫時不通）就退成一個普通的入口連結，不讓整頁少一塊。
 */
import { computed, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { fetchReferral, type ReferralSummary } from "@/lib/api";
import { accountToken } from "@/lib/connections";
import { whole } from "@/lib/format";
import type { ProviderId } from "@/lib/provider";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";
import AccountIcon from "@/components/AccountIcon.vue";

const props = defineProps<{ provider: ProviderId; externalId: number }>();
const { lp } = useLocalePath();
const data = ref<ReferralSummary | null>(null);
const failed = ref(false);
const copied = ref(false);

/** 還能填碼：服務說可以、而且還沒填過 */
const canRedeem = computed(() => !!data.value?.canRedeem && !data.value.referred);

onMounted(async () => {
  try {
    const token = await accountToken(props.provider, props.externalId);
    if (!token) throw new Error("no token");
    data.value = await fetchReferral(token, props.provider);
  } catch {
    failed.value = true;
  }
});

async function copy() {
  if (!data.value) return;
  try {
    await navigator.clipboard.writeText(data.value.code);
    copied.value = true;
    track("invite_click", { detail: "invite_copy" });
    setTimeout(() => { copied.value = false; }, 1800);
  } catch { /* 拿不到剪貼簿：碼就在畫面上 */ }
}
</script>

<template>
  <!-- 活動關著就不佔位 -->
  <section v-if="!data || data.enabled" class="panel invite" data-testid="wallet-invite">
    <p class="eyebrow invite__eyebrow"><AccountIcon name="gift" />{{ $t("referral.title") }}</p>

    <div v-if="!data && !failed" class="invite__ghost" aria-hidden="true"><div class="ghost" /><div class="ghost" /></div>

    <template v-else-if="data && canRedeem">
      <p class="invite__headline">{{ data.terms.welcomeCredits > 0 ? $t("wallet.invite.redeemGift", { credits: whole(data.terms.welcomeCredits) }) : $t("wallet.invite.redeem") }}</p>
      <RouterLink :to="lp('/me/referral?tab=enter')" class="btn btn--lg invite__cta" data-testid="wallet-invite-redeem" @click="track('invite_click', { detail: 'invite_redeem' })">{{ $t("referral.tabEnter") }}</RouterLink>
      <RouterLink :to="lp('/me/referral')" class="invite__more" @click="track('invite_click', { detail: 'invite_mine' })">{{ $t("wallet.invite.own") }}</RouterLink>
    </template>

    <template v-else-if="data">
      <p class="invite__headline">{{ $t("wallet.invite.share", { percent: data.terms.firstPercent }) }}</p>
      <div class="invite__code">
        <code data-testid="wallet-invite-code">{{ data.code }}</code>
        <button type="button" class="btn btn--sm" @click="copy">{{ copied ? $t("referral.copiedCode") : $t("referral.copyCode") }}</button>
      </div>
      <RouterLink :to="lp('/me/referral')" class="invite__more" @click="track('invite_click', { detail: 'invite_mine' })">
        {{ data.earned > 0 ? $t("wallet.invite.earned", { credits: whole(data.earned) }) : $t("wallet.invite.details") }}
      </RouterLink>
    </template>

    <template v-else>
      <p class="invite__headline">{{ $t("referral.lead") }}</p>
      <RouterLink :to="lp('/me/referral')" class="btn btn--lg invite__cta" @click="track('invite_click', { detail: 'invite_fallback' })">{{ $t("wallet.invite.details") }}</RouterLink>
    </template>
  </section>
</template>

<style scoped>
.invite { display: flex; flex-direction: column; gap: var(--s-3); padding: var(--s-5); min-width: 0; }
.invite > * { margin: 0; }
.invite__eyebrow { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
.invite__eyebrow svg { width: 14px; height: 14px; }
.invite__headline { margin: 0; font-size: 15px; font-weight: 600; line-height: 1.5; }
.invite__cta { margin-top: auto; }
.invite__cta + .invite__more { margin-top: 0; }
.invite__code { display: flex; align-items: center; gap: var(--s-2); min-width: 0; padding: 6px 6px 6px 12px; border-radius: var(--r-md); background: var(--surface-2); }
.invite__code code { flex: 1; min-width: 0; font-family: inherit; font-size: 18px; font-weight: 700; letter-spacing: 0.08em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; background: none; color: var(--text); }
.invite__more { display: inline-flex; align-items: center; gap: 2px; font-size: 13px; color: var(--text-2); justify-self: start; margin-top: auto; }
.invite__more::after { content: "›"; font-size: 15px; line-height: 1; }
.invite__more:hover { color: var(--accent-text); }
.invite__ghost { display: grid; gap: var(--s-2); }
.invite__ghost .ghost { height: 20px; }
.invite__ghost .ghost + .ghost { height: var(--h-md); }
</style>

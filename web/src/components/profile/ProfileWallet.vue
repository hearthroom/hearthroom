<script setup lang="ts">
/**
 * 資料頭右邊的積分卡：餘額、儲值、邀請（owner 2026-10-19 要放在「編輯資料」下面）。
 * 白天是香檳金淺色卡，深色模式才是深色卡。餘額讀不到就整張不放，不顯示假的 0。
 */
import { computed } from 'vue';
import { RouterLink } from 'vue-router';
import AccountIcon from '@/components/AccountIcon.vue';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';
import { whole } from '@/lib/format';
import { track } from '@/lib/track';

const session = useSession();
const { lp } = useLocalePath();
const balance = computed(() => (session.wallet ? whole(session.wallet.score + session.wallet.tempScore) : null));
</script>

<template>
  <section v-if="balance !== null" class="wallet" aria-labelledby="profile-wallet-title">
    <svg class="wallet__mark" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9Z" /></svg>
    <div class="wallet__head">
      <h2 id="profile-wallet-title" class="wallet__title"><span class="wallet__badge" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9Z" /></svg></span>{{ $t('nav.wallet') }}</h2>
      <RouterLink :to="lp('/wallet')" class="wallet__detail">{{ $t('profile.wallet.detail') }} <AccountIcon name="arrow" /></RouterLink>
    </div>
    <p class="wallet__balance"><strong>{{ balance }}</strong><span>{{ $t('profile.wallet.unit') }}</span></p>
    <div class="wallet__actions">
      <a class="wallet__topup" href="https://console.harperharbor.com/me/billing" target="_blank" rel="noopener" @click="track('topup_click')">{{ $t('wallet.topUp') }}<AccountIcon name="external" /></a>
      <RouterLink :to="lp('/me/referral')" class="wallet__invite"><AccountIcon name="gift" />{{ $t('profile.wallet.invite') }}</RouterLink>
    </div>
  </section>
</template>

<style scoped>
.wallet {
  --w-bg: radial-gradient(120% 90% at 100% 0%, rgba(255, 211, 92, 0.5) 0%, transparent 55%), radial-gradient(90% 80% at 0% 100%, rgba(239, 79, 111, 0.1) 0%, transparent 60%), linear-gradient(160deg, #fffaf0 0%, #fdeecd 100%);
  --w-text: #3a2600; --w-sub: rgba(58, 38, 0, 0.6); --w-gold: #8a5a00; --w-mark: rgba(201, 138, 8, 0.22);
  --w-num: linear-gradient(180deg, #5e3d0a 20%, #b07a00); --w-btn2: rgba(255, 255, 255, 0.72); --w-ring: rgba(160, 110, 0, 0.25);
  --w-shadow: 0 0 0 1px rgba(201, 138, 8, 0.2), 0 18px 40px -24px rgba(201, 138, 8, 0.6);
  position: relative; overflow: hidden; flex: 0 1 340px; min-width: min(100%, 300px);
  padding: var(--s-4) 18px; border-radius: 18px; color: var(--w-text); background: var(--w-bg); box-shadow: var(--w-shadow);
}
:root[data-mode="dark"] .wallet {
  --w-bg: radial-gradient(120% 90% at 100% 0%, #5b2a52 0%, transparent 55%), radial-gradient(90% 80% at 0% 100%, #3a1d45 0%, transparent 60%), linear-gradient(160deg, #241a2e 0%, #15121c 100%);
  --w-text: #fff; --w-sub: rgba(255, 255, 255, 0.58); --w-gold: #ffd35c; --w-mark: rgba(255, 211, 92, 0.16);
  --w-num: linear-gradient(180deg, #fff 30%, #ffe7a8); --w-btn2: rgba(255, 255, 255, 0.08); --w-ring: rgba(255, 255, 255, 0.16);
  --w-shadow: 0 0 0 1px rgba(255, 255, 255, 0.06), 0 18px 40px -18px rgba(36, 16, 48, 0.7);
}
.wallet__mark { position: absolute; right: -40px; top: -40px; width: 160px; height: 160px; fill: none; stroke: var(--w-mark); stroke-width: 0.6; pointer-events: none; }
.wallet__head { position: relative; display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.wallet__title { display: flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; font-weight: 650; letter-spacing: 0.04em; color: var(--w-gold); }
.wallet__badge { display: grid; place-items: center; width: 24px; height: 24px; border-radius: var(--r-sm); background: linear-gradient(145deg, #ffe28a, #f2b01e 55%, #c98a08); }
.wallet__badge svg { width: 13px; height: 13px; fill: #5e3d0a; }
.wallet__detail { display: inline-flex; align-items: center; gap: 2px; font-size: 12.5px; color: var(--w-sub); }
.wallet__detail svg { width: 13px; height: 13px; }
.wallet__balance { position: relative; display: flex; align-items: baseline; gap: 8px; margin: 10px 0 0; }
.wallet__balance strong { font-size: 32px; font-weight: 750; letter-spacing: -0.035em; line-height: 1; font-variant-numeric: tabular-nums; background: var(--w-num); -webkit-background-clip: text; background-clip: text; color: transparent; }
.wallet__balance span { font-size: 12.5px; color: var(--w-sub); }
.wallet__actions { position: relative; display: grid; grid-template-columns: 1fr 1fr; gap: var(--s-2); margin-top: var(--s-4); }
.wallet__topup, .wallet__invite { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; padding: 0 10px; border-radius: var(--r-pill); font-size: 13.5px; white-space: nowrap; overflow: hidden; }
.wallet__topup { font-weight: 700; color: #3a2600; background: linear-gradient(180deg, #ffe28a, #f2b01e 60%, #e09a12); box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.6), 0 8px 18px -8px rgba(242, 176, 30, 0.8); }
.wallet__invite { font-weight: 500; color: var(--w-text); background: var(--w-btn2); box-shadow: inset 0 0 0 1px var(--w-ring); }
.wallet__topup svg, .wallet__invite svg { width: 15px; height: 15px; }
</style>

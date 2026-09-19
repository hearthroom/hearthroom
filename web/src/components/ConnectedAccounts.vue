<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import AccountIcon from "./AccountIcon.vue";
import { useSession } from "@/lib/session";
import { availableProviders } from "@/lib/provider-switch";
import {
  ACCOUNT_PAGE,
  PROVIDERS,
  apiBaseOf,
  providerName,
  type ProviderId,
} from "@/lib/provider";
import { accountToken, connectAccount } from "@/lib/connections";
import { ApiError, fetchMeAt } from "@/lib/api";
import { connectionMessage } from "@/lib/connection-ui";
import { useRoute } from "vue-router";
import { useI18n } from "vue-i18n";
import { useLocalePath } from "@/lib/use-locale";
const session = useSession();
const route=useRoute();
const { t } = useI18n();
const { lp } = useLocalePath();
const configured = ref<{ id: ProviderId; name: string }[]>([]);
const isConnected = (id:ProviderId) => !!session.profile?.identities.some(i=>i.provider===id);
const providers = computed(() =>
  PROVIDERS.filter(
    (p) =>
      configured.value.some((x) => x.id === p.id) ||
      session.profile?.identities.some((i) => i.provider === p.id)
  ).sort((a,b)=>Number(isConnected(b.id))-Number(isConnected(a.id)))
);
const error = ref("");
const busy = ref(false);
// 每一家連的是哪個信箱。使用者要確認的是「這是我哪一個帳號」，公開編號回答不了這件事。
// 問不到就維持顯示編號——那一家可能還沒給這項授權，而這一列不該因此變成空的。
const emails = ref<Partial<Record<ProviderId, string>>>({});
const states=ref<Partial<Record<ProviderId,'checking'|'ready'|'expired'|'unavailable'>>>({});
async function loadEmails() {
  for (const p of session.profile?.identities ?? []) {
    const id = p.provider as ProviderId;
    if (!PROVIDERS.some((x) => x.id === id)) continue;
    states.value[id]="checking";
    try {
      const token = await accountToken(id);
      if (!token) {states.value[id]="expired";continue;}
      const me = await fetchMeAt(apiBaseOf(id), token);
      if (me.accountNumId !== p.externalId) {states.value[id]="expired";continue;}
      states.value[id]="ready";
      if (me.email) emails.value = { ...emails.value, [id]: me.email };
    } catch (e) {
      states.value[id]=e instanceof ApiError && e.status===401?"expired":"unavailable";
    }
  }
}

/** 管完帳號要回得來，所以把現在這一頁帶過去。 */
function billingPage(id:ProviderId):string {
 return id==='harbor'?'https://console.harperharbor.com/me/wallet':'https://lunatalk.ai/pages/mine/vippay';
}
function accountPage(id: ProviderId): string | null {
  const base = ACCOUNT_PAGE[id];
  return base ? `${base}?return_to=${encodeURIComponent(new URL(route.fullPath,location.origin).href)}` : null;
}

onMounted(async () => {
  configured.value = await availableProviders();
});
watch(
  () => session.profile?.identities.map(i=>`${i.provider}:${i.externalId}`).join('|'),
  () => { void loadEmails(); },
  { immediate: true },
);
async function connect(provider: ProviderId) {
  error.value = "";
  busy.value = true;
  try {
    await connectAccount(provider, lp("/me"));
  } catch (e) {
    error.value = connectionMessage(e);
    busy.value = false;
  }
}
</script>
<template>
  <section class="accounts" aria-labelledby="services-title">
    <header class="accounts__heading">
      <h2 id="services-title">{{ $t("me.linked.title") }}</h2>
      <p>{{ $t("services.description") }}</p>
    </header>
    <p v-if="error" role="alert" class="notice notice--error">{{ error }}</p>
    <div class="accounts__list">
      <div v-for="p in providers" :key="p.id" class="account" :class="{'account--connected':isConnected(p.id)}">
        <div class="account__identity">
          <span class="account__mark" aria-hidden="true">{{ p.id==='harbor'?'H':'L' }}</span>
          <div class="account__text">
            <h3>{{ providerName(p.id) }}</h3>
            <p>{{ !isConnected(p.id) ? $t('linked.notConnected') : emails[p.id] || $t('linked.account', {id:session.profile!.identities.find(i=>i.provider===p.id)!.externalId}) }}</p>
          </div>
          <span v-if="isConnected(p.id)" class="account__status" :class="{'account__status--ready':states[p.id]==='ready'}" role="status">
            <span class="account__dot" aria-hidden="true" />{{ $t(`services.${states[p.id]??'checking'}`) }}
          </span>
        </div>
        <div class="account__actions" v-if="isConnected(p.id)">
          <a v-if="accountPage(p.id)" class="account__action" :href="accountPage(p.id)!" :aria-label="$t('linked.manage',{name:providerName(p.id)})" target="_blank" rel="noopener">{{ $t('services.manage') }}<AccountIcon name="external" /></a>
          <a class="account__action" :href="billingPage(p.id)" target="_blank" rel="noopener">{{ $t('services.billing') }}<AccountIcon name="external" /></a>
          <button v-if="states[p.id]==='expired'" class="btn account__connect" :disabled="busy || !session.profile" @click="connect(p.id)">{{ $t('me.reauthorize') }}</button>
          <button v-if="states[p.id]==='unavailable'" class="btn account__connect" :disabled="busy" @click="loadEmails">{{ $t('linked.retry') }}</button>
        </div>
        <button v-else class="btn account__connect" :disabled="busy || !session.profile" @click="connect(p.id)">{{ $t('linked.connect') }}</button>
      </div>
    </div>
    <p class="accounts__note">{{ $t('services.permanent') }}</p>
  </section>
</template>
<style scoped>
.accounts {display:grid;gap:var(--s-4);min-width:0}
.accounts__heading {display:grid;gap:var(--s-2)}
h2,h3,p {margin:0}
h2 {font-size:18px;font-weight:650;letter-spacing:-.015em}
.accounts__heading p {font-size:14px;color:var(--text-2);line-height:1.7}
.accounts__list {border:1px solid var(--line-strong);border-radius:var(--r-md);background:var(--surface);overflow:hidden}
.account {display:flex;align-items:center;justify-content:space-between;gap:var(--s-4);padding:var(--s-5);flex-wrap:wrap}
.account + .account {border-top:1px solid var(--line)}
.account__identity {display:flex;align-items:center;gap:var(--s-3);min-width:0;flex:1;flex-wrap:wrap}
.account__mark {width:40px;height:40px;display:flex;align-items:center;justify-content:center;border:1px solid var(--line);border-radius:var(--r-md);background:var(--surface-2);color:var(--text-2);font-size:20px;font-weight:650;flex:none}
.account--connected .account__mark {background:var(--accent-tint);color:var(--accent-text);border-color:transparent}
.account__text {min-width:0;flex:1 1 120px}
h3 {font-size:15px;font-weight:600;line-height:1.5}
.account__text p {font-size:13px;line-height:1.6;color:var(--text-2);overflow-wrap:anywhere;margin-top:var(--s-1)}
.account__status {display:inline-flex;align-items:center;gap:var(--s-2);font-size:12px;color:var(--text-2);line-height:1.5;max-width:100%}
.account__dot {width:6px;height:6px;border-radius:var(--r-pill);background:var(--text-3);flex:none}
.account__status--ready .account__dot {background:var(--success)}
.account__actions {display:flex;align-items:center;gap:var(--s-5);width:100%;padding-left:52px;flex-wrap:wrap}
.account__action {display:inline-flex;align-items:center;gap:var(--s-2);min-height:44px;color:var(--text-2);font-size:13px;font-weight:500}
.account__action svg {width:14px;height:14px;color:var(--text-3)}
.account__action:hover {color:var(--accent-text)}
.account__connect {min-height:44px;height:auto;border-radius:var(--r-sm);font-size:13px;white-space:normal;padding:var(--s-2) var(--s-4);box-shadow:none}
.accounts__note {color:var(--text-3);font-size:12px;line-height:1.8}
@media(max-width:700px) {
 .account{padding:var(--s-4);gap:var(--s-2)}
 .account__identity{flex-basis:100%}.account:not(.account--connected) .account__identity{flex-basis:auto}
 .account__status{margin-left:52px}.account__status--ready{margin-left:0}
 .account__actions{padding-left:0;column-gap:var(--s-4);row-gap:var(--s-1)}
}
@media(prefers-reduced-motion:reduce) {.account__connect{transition:none}}
</style>

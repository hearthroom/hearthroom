<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
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
const providers = computed(() =>
  PROVIDERS.filter(
    (p) =>
      configured.value.some((x) => x.id === p.id) ||
      session.profile?.identities.some((i) => i.provider === p.id)
  )
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
  void loadEmails();
  configured.value = await availableProviders();
});
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
  <section class="panel accounts">
    <h2>{{ $t("me.linked.title") }}</h2>
    <p class="subtle">{{ $t("linked.hint") }}</p>
    <p v-if="error" role="alert" class="notice notice--error">{{ error }}</p>
    <div v-for="p in providers" :key="p.id" class="account">
      <div>
        <strong>{{ providerName(p.id) }}</strong>
        <p class="subtle">
          {{
            !session.profile?.identities.find((i) => i.provider === p.id)
              ? $t("linked.notConnected")
              : emails[p.id]
                ? emails[p.id]
                : $t("linked.account", {
                    id: session.profile.identities.find(
                      (i) => i.provider === p.id
                    )!.externalId,
                  })
          }}
        </p>
        <p v-if="session.profile?.identities.some(i=>i.provider===p.id)" class="subtle" role="status">{{ $t(`services.${states[p.id]??'checking'}`) }}</p>
      </div>
      <div
        class="actions"
        v-if="session.profile?.identities.some((i) => i.provider === p.id)"
      >
        <!-- 改密碼、換信箱、換綁第三方都只能在那一家自己的頁面上做：那些操作要再確認一次
             本人，而我們這邊沒有辦法替他做那件事，也不該有那個能力。 -->
        <a
          v-if="accountPage(p.id)"
          class="btn btn--sm"
          :href="accountPage(p.id)!"
          target="_blank"
          rel="noopener"
        >
          {{ $t("linked.manage", { name: providerName(p.id) }) }} ↗
        </a>
        <a class="btn btn--sm" :href="billingPage(p.id)" target="_blank" rel="noopener">{{ $t('services.billing') }} ↗</a>
        <button
          v-if="states[p.id]==='expired'"
          class="btn btn--sm"
          :disabled="busy || !session.profile"
          @click="connect(p.id)"
        >
          {{ $t("me.reauthorize") }}
        </button>
        <button v-if="states[p.id]==='unavailable'" class="btn btn--sm" :disabled="busy" @click="loadEmails">{{ $t('linked.retry') }}</button>
      </div>
      <button
        v-else
        class="btn btn--sm"
        :disabled="busy || !session.profile"
        @click="connect(p.id)"
      >
        {{ $t("linked.connect") }}
      </button>
    </div>
    <p class="subtle">{{ $t("services.permanent") }}</p>
  </section>
</template>
<style scoped>
.accounts {
  display: grid;
  gap: var(--s-4);
  padding: var(--s-4);
}
h2,
p {
  margin: 0;
}
.account {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--s-3);
  flex-wrap: wrap;
  border-top: 1px solid var(--line);
  padding-top: var(--s-4);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}
.btn {min-height:var(--h-lg);height:auto;white-space:normal}
.account > div:first-child {min-width:0;overflow-wrap:anywhere}
</style>

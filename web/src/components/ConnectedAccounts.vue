<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSession } from "@/lib/session";
import { availableProviders } from "@/lib/provider-switch";
import {
  ACCOUNT_PAGE,
  PROVIDERS,
  apiBaseOf,
  currentProvider,
  providerName,
  type ProviderId,
} from "@/lib/provider";
import { accountToken, connectAccount, disconnectAccount } from "@/lib/connections";
import { fetchMeAt } from "@/lib/api";
import { connectionMessage } from "@/lib/connection-ui";
import { confirmDialog } from "@/lib/confirm";
import { useI18n } from "vue-i18n";
import { useLocalePath } from "@/lib/use-locale";
const session = useSession();
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
async function loadEmails() {
  for (const p of session.profile?.identities ?? []) {
    const id = p.provider as ProviderId;
    if (!PROVIDERS.some((x) => x.id === id)) continue;
    try {
      const token = await accountToken(id);
      if (!token) continue;
      const me = await fetchMeAt(apiBaseOf(id), token);
      if (me.email) emails.value = { ...emails.value, [id]: me.email };
    } catch {
      // 拿不到就算了：這一列的主要資訊是「連了沒有」，信箱只是錦上添花。
    }
  }
}

/** 管完帳號要回得來，所以把現在這一頁帶過去。 */
function accountPage(id: ProviderId): string | null {
  const base = ACCOUNT_PAGE[id];
  return base ? `${base}?return_to=${encodeURIComponent(location.href)}` : null;
}

onMounted(async () => {
  configured.value = await availableProviders();
  void loadEmails();
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
async function disconnect(provider: ProviderId) {
  if (
    !(await confirmDialog({
      message: t("linked.disconnectHint"),
      confirmText: t("linked.disconnect"),
    }))
  )
    return;
  error.value = "";
  busy.value = true;
  try {
    const token = await session.accessToken();
    if (!token) throw new Error("connection_source_expired");
    const removedLogin = currentProvider() === provider;
    session.profile = await disconnectAccount(provider, token, session.profile?.identities);
    if (removedLogin) location.reload();
  } catch (e) {
    error.value = connectionMessage(e);
  } finally {
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
        <button
          class="btn btn--sm"
          :disabled="busy || !session.profile"
          @click="connect(p.id)"
        >
          {{ $t("me.reauthorize") }}
        </button>
        <button
          v-if="
            !session.profile?.identities.find((i) => i.provider === p.id)
              ?.founding
          "
          class="btn btn--sm btn--ghost"
          :disabled="busy || !session.profile"
          @click="disconnect(p.id)"
        >
          {{ $t("linked.disconnect") }}
        </button>
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
    <button class="btn btn--sm" @click="session.logout()">
      {{ $t("nav.logout") }}
    </button>
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
  padding-top: var(--s-3);
}
.actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--s-2);
}
</style>

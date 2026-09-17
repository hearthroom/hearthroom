<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { useSession } from "@/lib/session";
import { availableProviders } from "@/lib/provider-switch";
import {
  PROVIDERS,
  currentProvider,
  providerName,
  type ProviderId,
} from "@/lib/provider";
import { connectAccount, disconnectAccount } from "@/lib/connections";
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
onMounted(async () => {
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
            session.profile?.identities.find((i) => i.provider === p.id)
              ? $t("linked.account", {
                  id: session.profile.identities.find(
                    (i) => i.provider === p.id
                  )!.externalId,
                })
              : $t("linked.notConnected")
          }}
        </p>
      </div>
      <div
        class="actions"
        v-if="session.profile?.identities.some((i) => i.provider === p.id)"
      >
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

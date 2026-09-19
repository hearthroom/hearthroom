<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRouter } from "vue-router";
import { connectionMessage } from "@/lib/connection-ui";
import { finishConnection, previewConnection, type ConnectionPreview } from "@/lib/connections";
import { providerName, setProvider } from "@/lib/provider";
import { useProviderUpstream } from "@/lib/config";
import { completeLogin } from "@/lib/oauth";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();
const error = ref("");
const pending = ref<Awaited<ReturnType<typeof completeLogin>> | null>(null);
const preview = ref<ConnectionPreview | null>(null);
const keepHandle = ref('');
const busy = ref(false);
async function confirmConnection() {
  if (!pending.value?.linkFrom || !preview.value || !keepHandle.value || busy.value) return;
  busy.value = true; error.value = '';
  try {
    const p = pending.value;
    await finishConnection(p.provider, p.linkFrom!, p.token, {keepHandle:keepHandle.value, sourceHandle:preview.value.source.handle!,targetHandle:preview.value.target.handle ?? null});
    location.replace(p.returnTo);
  } catch (e) { error.value = connectionMessage(e); busy.value = false }
}
function cancelConnection() {
  const p = pending.value;
  if (!p?.linkFrom) return;
  setProvider(p.linkFrom); useProviderUpstream(); pending.value = null;
  location.replace(p.returnTo);
}

onMounted(async () => {
  try {
    const completed = await completeLogin(new URLSearchParams(location.search));
    const { token, returnTo, provider, linkFrom } = completed;
    if (linkFrom) {
      pending.value = completed;
      preview.value = await previewConnection(provider, linkFrom, token);
      keepHandle.value = preview.value.source.handle!;
      return;
    }
    setProvider(provider); useProviderUpstream();
    await session.adopt(token);
    track("login_done");
    // 用 replace：回上一頁不該再回到帶著授權碼的網址。
    await router.replace(returnTo);
  } catch (err) {
    const code = String((err as Error)?.message ?? "");
    track("login_fail", {
      detail: code.includes("denied") ? "oauth_denied" : code.includes("state") ? "oauth_state" : "oauth_exchange",
      ok: false,
    });
    error.value = connectionMessage(err);
  }
});
</script>

<template>
  <div class="page page--narrow">
    <section v-if="preview" class="panel link-confirm">
      <h1>{{ $t('linked.chooseTitle') }}</h1>
      <p>{{ $t('linked.chooseIntro', {provider:providerName(preview.target.provider)}) }}</p>
      <div class="link-destination"><strong>{{ preview.source.name }}</strong></div>
      <p v-if="preview.target.handle && preview.target.handle !== preview.source.handle" class="subtle">{{ $t('linked.previousCommunity', {handle:preview.target.handle}) }}</p>
      <p class="subtle">{{ $t('linked.keepHint') }}</p>
      <p v-if="error" role="alert" class="notice notice--error">{{ error }}</p>
      <div class="link-actions">
        <button class="btn" :disabled="!keepHandle || busy" @click="confirmConnection">{{ $t('linked.confirm') }}</button>
        <button class="btn btn--ghost" :disabled="busy" @click="cancelConnection">{{ $t('linked.cancel') }}</button>
      </div>
    </section>
    <template v-else-if="error">
      <p class="notice notice--error" role="alert">{{ error }}</p>
      <button v-if="pending" class="btn btn--ghost" @click="cancelConnection">{{ $t('linked.cancel') }}</button>
      <RouterLink v-else class="btn" :to="lp('/login')">{{ $t("auth.retry") }}</RouterLink>
    </template>
    <p v-else class="muted">{{ $t("auth.completing") }}</p>
  </div>
</template>

<style scoped>
.link-confirm { display:grid; gap:var(--s-4); padding:var(--s-5); }
.link-confirm h1, .link-confirm p { margin:0; }
.link-confirm fieldset { border:0; padding:0; display:grid; gap:var(--s-3); min-width:0; }
.link-confirm legend { margin-bottom:var(--s-3); }
.link-choice { display:flex; gap:var(--s-3); align-items:center; padding:var(--s-4); border:1px solid var(--line); border-radius:var(--r-md); cursor:pointer; }
.link-choice:has(input:checked) { border-color:var(--text); }
.link-choice > span { display:grid; gap:var(--s-1); min-width:0; overflow-wrap:anywhere; }
.link-actions { display:flex; gap:var(--s-3); flex-wrap:wrap; }
</style>

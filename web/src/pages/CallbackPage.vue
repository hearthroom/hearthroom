<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRouter } from "vue-router";
import { connectionMessage } from "@/lib/connection-ui";
import { setProvider } from "@/lib/provider";
import { useProviderUpstream } from "@/lib/config";
import { completeLogin, pendingReturnTo } from "@/lib/oauth";
import { loginPath } from "@/lib/login-return";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { recordGa4Login } from "@/lib/ga4";
import { useLocalePath } from "@/lib/use-locale";

const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();
const error = ref("");
// 失敗後「重新登入」回到原本要去的那頁；先記下來，成功的路徑會清掉這份記錄。
const retryTo = ref(lp(loginPath(pendingReturnTo())));
onMounted(async () => {
  try {
    const completed = await completeLogin(new URLSearchParams(location.search));
    // 靜默登入沒登入成功（Harbor 沒登入，或還不是本站會員）：不是錯誤，回原頁照常顯示登入鈕
    if ("authenticated" in completed) { await router.replace(completed.returnTo); return; }
    const { token, returnTo, provider, linkFrom } = completed;
    if(linkFrom)throw new Error('auth_reauthorization_required');
    setProvider(provider); useProviderUpstream();
    await session.adopt(token);
    track(completed.silent ? "login_silent" : "login_done");
    void recordGa4Login(() => session.accessToken());
    // 用 replace：回上一頁不該再回到帶著授權碼的網址。
    await router.replace(returnTo);
  } catch (err) {
    const code = String((err as Error)?.message ?? "");
    track("login_fail", {
      detail: code === "oauth_denied" ? "oauth_denied" : code.includes("state") ? "oauth_state" : "oauth_exchange",
      ok: false,
    });
    error.value = code === "oauth_denied" ? t("auth.denied") : connectionMessage(err);
  }
});
</script>

<template>
  <div class="page page--narrow">
    <template v-if="error">
      <p class="notice notice--error" role="alert">{{ error }}</p>
      <RouterLink class="btn" :to="retryTo">{{ $t("auth.retry") }}</RouterLink>
    </template>
    <p v-else class="muted">{{ $t("auth.completing") }}</p>
  </div>
</template>

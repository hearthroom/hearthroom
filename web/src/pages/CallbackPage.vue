<script setup lang="ts">
import { onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { completeLogin } from "@/lib/oauth";
import { useSession } from "@/lib/session";
import { track } from "@/lib/track";
import { useLocalePath } from "@/lib/use-locale";

const router = useRouter();
const session = useSession();
const { lp } = useLocalePath();
const { t } = useI18n();
const error = ref("");

onMounted(async () => {
  try {
    const { token, returnTo } = await completeLogin(new URLSearchParams(location.search));
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
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  }
});
</script>

<template>
  <div class="page page--narrow">
    <template v-if="error">
      <p class="notice notice--error" role="alert">{{ error }}</p>
      <button class="btn" @click="session.login(lp('/'))">{{ $t("auth.retry") }}</button>
    </template>
    <p v-else class="muted">{{ $t("auth.completing") }}</p>
  </div>
</template>

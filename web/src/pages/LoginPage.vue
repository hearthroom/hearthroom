<script setup lang="ts">
/**
 * 本站的登入頁。
 *
 * 進站的「登入」先到這裡，不直接跳去供應商的授權頁：本站沒有自己的密碼，登入交給你已有的
 * 帳號，但「用哪一家登入」是這個站的事，供應商只是其中一種（owner 2026-09-08）。
 * 現在只有一家，所以一顆按鈕；PROVIDERS 多一列，這裡就多一顆。
 *
 * 登入後回哪裡走網址參數（?returnTo=），只收站內路徑（safeReturnTo），擋開放轉址。
 * 已經登入的人來到這頁：直接送去 returnTo。
 */
import { onMounted, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { pageTitle } from "@/lib/i18n";
import { safeReturnTo } from "@/lib/login-return";
import { PROVIDERS } from "@/lib/providers";
import { useSession } from "@/lib/session";
import { SITE } from "@/lib/site";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { t } = useI18n();

const returnTo = () => safeReturnTo(route.query.returnTo);

function start(providerId: string) {
  // 現在只有一家；接第二家時這裡按代號分流
  if (providerId !== "lunatalk") return;
  void session.login(returnTo());
}

onMounted(() => {
  document.title = pageTitle(t("login.title"));
});
watch(() => [session.ready, session.me], () => {
  if (session.ready && session.me) void router.replace(returnTo());
}, { immediate: true });
</script>

<template>
  <div class="page page--narrow login">
    <section class="panel login__card">
      <p class="eyebrow">{{ SITE.name }}</p>
      <h1 class="login__title display">{{ $t("login.title") }}</h1>
      <p class="login__lead">{{ $t("login.lead") }}</p>

      <div class="login__providers">
        <button v-for="p in PROVIDERS" :key="p.id" type="button" class="btn btn--primary btn--lg login__provider" @click="start(p.id)">
          {{ $t("login.continueWith", { provider: p.name }) }}
        </button>
      </div>
      <p class="subtle login__more">{{ $t("login.moreComing") }}</p>
      <p class="subtle login__note">{{ $t("login.note") }}</p>
    </section>
  </div>
</template>

<style scoped>
.login { display: grid; place-items: center; min-height: 60vh; }
.login__card { width: 100%; max-width: 420px; padding: var(--s-6); display: grid; gap: var(--s-3); text-align: center; }
.login__title { font-size: clamp(20px, 2.6vw, 24px); margin: 0; }
.login__lead { margin: 0; color: var(--text-2); }
.login__providers { display: grid; gap: var(--s-2); margin-top: var(--s-2); }
.login__provider { width: 100%; }
.login__more { margin: 0; }
.login__note { margin: var(--s-2) 0 0; }
</style>

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
 *
 * 版型照同類產品（Character.AI 登入卡）的骨架：價值主張當標題、一句「一步就能開始」、
 * 三行登入後才能做的事、按鈕、同意行（owner 2026-10-04：不堆免責聲明、不解釋機制，但也不能空）。
 * 大多數人按下去的時候還沒有供應商帳號，按鈕會順手把帳號建好，所以分頁標題是「登入或註冊」。
 * 同意行連到開帳號那家的條款與隱私政策；授權怎麼保存、怎麼停止，講在「我的」頁的連結區。
 */
import { connectionMessage } from '@/lib/connection-ui';
import { onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { pageTitle } from "@/lib/i18n";
import { safeReturnTo } from "@/lib/login-return";
import { currentProvider, legalPage, PROVIDERS } from "@/lib/provider";
import { availableProviders, chooseProvider, needsSwitchConfirm } from "@/lib/provider-switch";
import { useSession } from "@/lib/session";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { t, locale } = useI18n();

const loginError=ref('');
const returnTo = () => safeReturnTo(route.query.returnTo);

/** 正在問「要換到另一家嗎」的那一家；null 表示沒有在問。 */
const pendingSwitch = ref<(typeof PROVIDERS)[number] | null>(null);
/** 這個部署有的那幾家。先給預設那家，問到再換上——登入頁不該為了一次請求空白著。 */
const providers = ref<typeof PROVIDERS>([PROVIDERS[0]]);

function start(provider: (typeof PROVIDERS)[number]) {
  // 換一家等於換一個帳號：已經登入的人要先看清楚這件事再決定。
  if (needsSwitchConfirm(provider.id, { signedIn: !!session.me })) {
    pendingSwitch.value = provider;
    return;
  }
  void go(provider.id);
}

async function go(id: (typeof PROVIDERS)[number]["id"]) {
  pendingSwitch.value = null;
  loginError.value="";
  try{await chooseProvider(id, {
    signedIn: !!session.me,
    logout: () => session.logout(),
    login: () => session.login(returnTo()),
  });}catch(e){loginError.value=connectionMessage(e);}
}

onMounted(async () => {
  document.title = pageTitle(t("login.title"));
  providers.value = await availableProviders();
});
watch(() => [session.ready, session.me], () => {
  if (session.ready && session.me) void router.replace(returnTo());
}, { immediate: true });
</script>

<template>
  <div class="page page--narrow login">
    <section class="panel login__card">
      <h1 class="login__title display">{{ $t("login.headline") }}</h1>
      <p class="login__lead">{{ $t("login.lead") }}</p>

      <!-- 登入後才能做的三件事：聊天、關注與收藏、發卡。訪客不登入已經能看榜單，所以不列「瀏覽」。 -->
      <ul class="login__features">
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-4.2 3.4A.5.5 0 0 1 4 19z"/></svg>
          <span>{{ $t("login.feature.chat") }}</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
          <span>{{ $t("login.feature.follow") }}</span>
        </li>
        <li>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10.5-10.5a2.1 2.1 0 0 0-3-3L5 17z"/><path d="M13.5 6.5l3 3"/></svg>
          <span>{{ $t("login.feature.create") }}</span>
        </li>
      </ul>

      <p v-if="loginError" role="alert" class="notice notice--error">{{ loginError }}</p>
      <div class="login__providers">
        <button
          v-for="p in providers"
          :key="p.id"
          type="button"
          class="btn btn--lg login__provider"
          :class="p.id === currentProvider() ? 'btn--primary' : 'btn--ghost'"
          @click="start(p)"
        >
          {{ $t("login.continueWith", { provider: p.name }) }}
        </button>
      </div>
      <!-- 只有一家可選時，「換平台」的提醒沒有對象，反而像免責聲明。 -->
      <p v-if="providers.length > 1" class="subtle login__more">{{ $t("login.moreComing") }}</p>

      <!-- 換家＝換帳號。講清楚會變成什麼，再讓他按下去。 -->
      <div v-if="pendingSwitch" class="login__confirm" role="alertdialog" aria-live="polite">
        <p class="login__confirmText">{{ $t("login.switchWarning", { provider: pendingSwitch.name }) }}</p>
        <div class="login__confirmActions">
          <button type="button" class="btn btn--ghost" @click="pendingSwitch = null">{{ $t("dialog.cancel") }}</button>
          <button type="button" class="btn btn--primary" @click="go(pendingSwitch.id)">
            {{ $t("login.switchConfirm", { provider: pendingSwitch.name }) }}
          </button>
        </div>
      </div>
      <i18n-t keypath="login.legal" tag="p" class="subtle login__legal">
        <template #provider>{{ providers[0].name }}</template>
        <template #terms><a :href="legalPage(providers[0].id, 'terms', locale)" target="_blank" rel="noopener">{{ $t("login.terms") }}</a></template>
        <template #privacy><a :href="legalPage(providers[0].id, 'privacy', locale)" target="_blank" rel="noopener">{{ $t("login.privacy") }}</a></template>
      </i18n-t>
    </section>
  </div>
</template>

<style scoped>
.login { display: grid; place-items: center; min-height: 60vh; }
.login__card { width: 100%; max-width: 420px; padding: var(--s-6); display: grid; gap: var(--s-3); text-align: center; }
.login__title { font-size: clamp(22px, 2.8vw, 26px); margin: 0; }
.login__lead { margin: 0; color: var(--text-2); }
.login__features { list-style: none; margin: var(--s-2) 0 0; padding: var(--s-4); display: grid; gap: var(--s-3); text-align: left; background: var(--surface-2); border-radius: var(--r-2); }
.login__features li { display: flex; align-items: center; gap: var(--s-3); font-size: 14px; line-height: 1.5; }
.login__features svg { width: 20px; height: 20px; flex: none; color: var(--accent); }
.login__providers { display: grid; gap: var(--s-2); margin-top: var(--s-2); }
.login__provider { width: 100%; }
.login__more { margin: 0; }
.login__legal { margin: 0; font-size: 12px; }
.login__legal a { color: inherit; text-decoration: underline; }
.login__confirm { margin-top: var(--s-2); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-2); background: var(--surface-2); display: grid; gap: var(--s-2); }
.login__confirmText { margin: 0; font-size: 14px; line-height: 1.6; text-align: left; }
.login__confirmActions { display: flex; gap: var(--s-2); justify-content: flex-end; }
</style>

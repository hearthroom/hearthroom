<script setup lang="ts">
/**
 * 「我的」：登入者在本站的身分，以及各功能的入口。
 *
 * 本站有自己的成員 ID（公開的 8 個小寫字母），供應商帳號只是掛在底下的一筆「身分」——
 * 這頁把兩層分開講：上面是你在本站是誰，下面是你用哪個帳號登入進來、狀態如何。
 * 只有一家供應商時「解除連結」等於把自己鎖在外面，所以這一版只有「重新授權」與「登出」。
 *
 * 顯示名稱與頭像來自登入用的那個帳號（供應商回的），本站不另存一份。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import { dateOnly, hueFrom } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { providerName } from "@/lib/providers";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { track } from "@/lib/track";

const session = useSession();
const reviewerStore = useReviewer();
const route = useRoute();
const { lp } = useLocalePath();
const { t } = useI18n();
const copied = ref(false);

const handle = computed(() => session.profile?.handle ?? "");

async function copyHandle() {
  if (!handle.value) return;
  try {
    await navigator.clipboard.writeText(handle.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1800);
  } catch {
    /* 拿不到剪貼簿：字就在畫面上，使用者自己選取 */
  }
}

function reauthorize() {
  // session.login 自己會記 login_start
  void session.login(route.fullPath);
}

onMounted(() => {
  document.title = pageTitle(t("me.title"));
});
</script>

<template>
  <div v-if="session.me" class="page page--narrow me">
    <header class="panel me__who">
      <img v-if="session.me.avatar" :src="session.me.avatar" alt="" class="me__face" />
      <div v-else class="me__face mono" :style="{ '--h': hueFrom(session.me.nickName) }">{{ [...session.me.nickName][0] }}</div>
      <div class="me__text">
        <p class="eyebrow">{{ $t("me.title") }}</p>
        <h1 class="me__name display">{{ session.me.nickName }}</h1>
        <div class="me__id">
          <span class="subtle">{{ $t("me.handle") }}</span>
          <span v-if="handle" class="me__id-row">
            <code class="me__handle mono">{{ handle }}</code>
            <button type="button" class="btn btn--sm btn--ghost" @click="copyHandle">{{ copied ? $t("me.copied") : $t("me.copy") }}</button>
          </span>
          <span v-else class="subtle">{{ $t("state.loading") }}</span>
        </div>
        <p v-if="session.profile" class="subtle me__since">{{ $t("me.since", { date: dateOnly(Math.floor(session.profile.memberSince / 1000)) }) }}</p>
      </div>
    </header>

    <section class="panel me__linked">
      <p class="eyebrow">{{ $t("me.linked.title") }}</p>
      <p class="subtle">{{ $t("me.linked.desc") }}</p>
      <ul class="me__accounts">
        <li v-for="id in session.profile?.identities ?? []" :key="`${id.provider}:${id.externalId}`" class="me__account">
          <div class="me__account-text">
            <strong>{{ providerName(id.provider) }}</strong>
            <span class="subtle">{{ session.me.nickName }} · ID {{ id.externalId }}</span>
            <span class="subtle">{{ $t("me.linked.at", { date: dateOnly(Math.floor(id.linkedAt / 1000)) }) }}</span>
          </div>
          <span class="me__status">{{ $t("me.linked.active") }}</span>
        </li>
        <li v-if="!session.profile" class="subtle">{{ $t("state.loading") }}</li>
      </ul>
      <div class="me__acts">
        <button type="button" class="btn btn--sm" @click="reauthorize">{{ $t("me.reauthorize") }}</button>
        <button type="button" class="btn btn--sm btn--ghost" @click="track('logout'); session.logout()">{{ $t("nav.logout") }}</button>
      </div>
    </section>

    <nav class="panel me__links" :aria-label="$t('me.title')">
      <RouterLink :to="lp('/mine')" class="me__link">{{ $t("nav.mine") }}</RouterLink>
      <RouterLink :to="lp('/resources')" class="me__link">{{ $t("nav.resources") }}</RouterLink>
      <RouterLink :to="lp('/wallet')" class="me__link">{{ $t("nav.wallet") }}</RouterLink>
      <RouterLink v-if="reviewerStore.reviewer" :to="lp('/review')" class="me__link">{{ $t("nav.review") }}</RouterLink>
      <RouterLink :to="lp('/settings')" class="me__link">{{ $t("nav.settings") }}</RouterLink>
      <RouterLink v-if="handle" :to="lp(`/authors/${handle}`)" class="me__link">{{ $t("me.publicPage") }}</RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.me { display: grid; gap: var(--s-4); }
.me__who { display: flex; align-items: center; gap: var(--s-4); padding: var(--s-5); }
.me__face { width: 64px; height: 64px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 24px; }
.me__text { min-width: 0; display: grid; gap: 4px; }
.me__name { font-size: clamp(20px, 2.6vw, 26px); margin: 0; }
/* 標籤一行、ID 與複製鈕一行且不拆開：手機上原本會把「複製」擠到下一行 */
.me__id { display: grid; gap: 2px; margin: 0; }
.me__id-row { display: inline-flex; align-items: center; gap: var(--s-2); white-space: nowrap; }
.me__handle { font-size: 14px; padding: 2px 8px; border-radius: 6px; background: var(--surface-2); }
.me__since { margin: 0; }
.me__linked { padding: var(--s-4); display: grid; gap: var(--s-2); }
.me__accounts { list-style: none; margin: 0; padding: 0; display: grid; gap: var(--s-2); }
.me__account { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md); }
.me__account-text { display: grid; gap: 2px; min-width: 0; }
.me__status { font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: var(--accent-tint); color: var(--accent-text); flex: none; }
.me__acts { display: flex; gap: var(--s-2); justify-content: flex-end; }
.me__links { padding: var(--s-2); display: grid; }
.me__link { padding: 10px 12px; border-radius: var(--r-sm); color: var(--text); }
.me__link:hover { background: var(--surface-2); }
</style>

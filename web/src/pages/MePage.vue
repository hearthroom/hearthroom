<script setup lang="ts">
/**
 * 「我的」：登入者在本站的身分，以及各功能的入口。
 *
 * 本站有自己的成員 ID（公開的 8 個小寫字母），供應商帳號只是掛在底下的一筆「身分」——
 * 這頁把兩層分開講：上面是你在本站是誰，下面是你用哪個帳號登入進來、狀態如何。
 *
 * 顯示名稱與頭像由社區保存，首次登入預填後即可獨立編輯。
 */
import CommunityProfile from "@/components/CommunityProfile.vue";
import AccountIcon from "@/components/AccountIcon.vue";
import ConnectedAccounts from "@/components/ConnectedAccounts.vue";
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink } from "vue-router";
import { dateOnly, hueFrom } from "@/lib/format";
import { pageTitle } from "@/lib/i18n";
import { useReviewer } from "@/lib/review";
import { useSession } from "@/lib/session";
import { can } from "@/lib/provider";
import { useLocalePath } from "@/lib/use-locale";

const session = useSession();
const reviewerStore = useReviewer();
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

onMounted(() => {
  document.title = pageTitle(t("me.title"));
});
</script>

<template>
  <div v-if="session.me" class="page me">
    <header class="me__who">
     <div class="me__identity">
      <img v-if="session.avatarUrl" :src="session.avatarUrl" alt="" class="me__face" />
      <div v-else class="me__face mono" :style="{ '--h': hueFrom(session.displayName) }">{{ [...session.displayName][0] }}</div>
      <div class="me__text">
        <h1 class="me__name display">{{ session.displayName }}</h1>
        <div class="me__id" :aria-label="$t('me.handle')">
          <span v-if="handle" class="me__id-row">
            <span aria-hidden="true">@</span><span class="me__handle">{{ handle }}</span>
            <button type="button" class="me__copy" :aria-label="copied ? $t('me.copied') : $t('me.copy')" :title="copied ? $t('me.copied') : $t('me.copy')" @click="copyHandle"><AccountIcon :name="copied ? 'check' : 'copy'" /></button>
          </span>
          <span v-else class="subtle">{{ $t("state.loading") }}</span>
        </div>
      </div>
     </div>
     <p v-if="session.profile?.bio" class="me__bio">{{ session.profile.bio }}</p>
     <p v-if="session.profile" class="me__since"><AccountIcon name="calendar" />{{ $t("me.since", { date: dateOnly(Math.floor(session.profile.memberSince / 1000)) }) }}</p>
     <div class="me__profile-actions">
       <CommunityProfile />
       <RouterLink v-if="handle" :to="lp(`/authors/${handle}`)" class="me__public">{{ $t('me.publicPage') }}<AccountIcon name="arrow" /></RouterLink>
     </div>
    </header>


    <div class="me__main">
      <section class="me__workspace" aria-labelledby="workspace-title">
        <h2 id="workspace-title">{{ $t('me.workspace') }}</h2>
        <nav class="me__destinations" :aria-label="$t('me.workspace')">
          <RouterLink :to="lp('/library')" class="me__destination"><span class="me__destination-icon"><AccountIcon name="calendar" /></span><span class="me__destination-text"><strong>{{ $t('library.title') }}</strong><span>{{ $t('library.hint') }}</span></span><AccountIcon name="arrow" class="me__chevron" /></RouterLink>
          <RouterLink :to="lp('/mine')" class="me__destination">
            <span class="me__destination-icon"><AccountIcon name="cards" /></span>
            <span class="me__destination-text"><strong>{{ $t('nav.mine') }}</strong><span>{{ $t('me.cardsHint') }}</span></span>
            <AccountIcon name="arrow" class="me__chevron" />
          </RouterLink>
          <RouterLink v-if="can('library')" :to="lp('/resources')" class="me__destination">
            <span class="me__destination-icon"><AccountIcon name="folder" /></span>
            <span class="me__destination-text"><strong>{{ $t('nav.resources') }}</strong><span>{{ $t('me.resourcesHint') }}</span></span>
            <AccountIcon name="arrow" class="me__chevron" />
          </RouterLink>
        </nav>
      </section>
    <ConnectedAccounts />
    </div>
    <nav class="me__links" :aria-label="$t('me.title')">
      <RouterLink :to="lp('/wallet')" class="me__link"><AccountIcon name="wallet" />{{ $t("nav.wallet") }}<AccountIcon name="arrow" class="me__chevron" /></RouterLink>
      <RouterLink v-if="reviewerStore.reviewer" :to="lp('/review')" class="me__link"><AccountIcon name="check" />{{ $t("nav.review") }}<AccountIcon name="arrow" class="me__chevron" /></RouterLink>
      <RouterLink :to="lp('/settings')" class="me__link"><AccountIcon name="settings" />{{ $t("nav.settings") }}<AccountIcon name="arrow" class="me__chevron" /></RouterLink>
    </nav>
    <button type="button" class="me__link me__logout" @click="session.logout()"><AccountIcon name="logout" />{{ $t('nav.logout') }}</button>

  </div>
</template>

<style scoped>
.me { max-width:1080px;display:grid;grid-template-columns:272px minmax(0,1fr);column-gap:var(--s-7);row-gap:var(--s-4);align-items:start;padding-top:var(--s-7); }
.me__who,.me__main {min-width:0}
.me__who {display:grid;gap:var(--s-4);grid-column:1;grid-row:1}
.me__identity {display:grid;gap:var(--s-5);min-width:0}
.me__face:not(img) {background:var(--accent-tint);color:var(--accent-text)}
.me__face {width:96px;height:96px;border-radius:var(--r-pill);object-fit:cover;display:flex;align-items:center;justify-content:center;font-size:32px;box-shadow:0 0 0 4px var(--surface)}
.me__text {min-width:0}
.me__name {font-size:28px;font-weight:700;line-height:1.3;letter-spacing:-.025em;margin:0;overflow-wrap:anywhere}
.me__id {color:var(--text-2);font-size:14px}
.me__id-row {display:inline-flex;align-items:center;min-height:44px}
.me__copy {display:inline-flex;align-items:center;justify-content:center;width:44px;height:44px;background:transparent;border:0;border-radius:var(--r-sm);color:var(--text-3);cursor:pointer}
.me__copy svg {width:15px;height:15px}
.me__copy:hover {color:var(--text);background:var(--surface-2)}
.me__bio {margin:0;color:var(--text-2);font-size:15px;line-height:1.8;white-space:pre-wrap;overflow-wrap:anywhere}
.me__since {display:flex;align-items:center;gap:var(--s-2);margin:0;color:var(--text-3);font-size:13px}
.me__since svg {width:16px;height:16px}
.me__profile-actions {display:grid;gap:var(--s-1);margin-top:var(--s-2)}
.me__public {display:flex;align-items:center;justify-content:center;gap:var(--s-2);min-height:44px;font-size:14px;color:var(--text-2)}
.me__public:hover {color:var(--accent-text)}
.me__public svg {width:14px;height:14px}
.me__links {grid-column:1;grid-row:2;display:grid;border-top:1px solid var(--line-strong);margin-top:var(--s-5);padding-top:var(--s-4)}
.me__link {display:flex;align-items:center;gap:var(--s-3);min-height:44px;padding:var(--s-3) var(--s-2);font-size:14px;font-weight:500;border:0;background:transparent;color:var(--text-2);border-radius:var(--r-sm);cursor:pointer;text-align:start}
.me__link:hover {background:var(--surface-2);color:var(--text)}
.me__chevron {margin-left:auto;width:16px;height:16px;color:var(--text-3)}
.me__logout {grid-column:1;grid-row:3;margin-top:0;font-weight:400;width:100%;color:var(--text-3)}
.me__main {grid-column:2;grid-row:1 / span 3;display:grid;align-content:start;gap:var(--s-7)}
.me__workspace h2 {margin:0 0 var(--s-4);font-size:18px;font-weight:650;letter-spacing:-.015em}
.me__destinations {display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:var(--s-4)}
.me__destination {display:flex;align-items:center;gap:var(--s-3);padding:var(--s-5) var(--s-4);border:1px solid var(--line-strong);border-radius:var(--r-md);background:var(--surface);transition:border-color var(--dur),background var(--dur);min-width:0}
.me__destination:hover {border-color:var(--accent);background:var(--accent-tint)}
.me__destination-icon {display:flex;align-items:center;justify-content:center;width:40px;height:40px;border-radius:var(--r-sm);color:var(--accent-text);background:var(--accent-tint);flex:none}
.me__destination-text {display:grid;gap:var(--s-1);min-width:0}
.me__destination-text strong {font-size:15px;font-weight:600;color:var(--text)}
.me__destination-text > span {font-size:13px;line-height:1.5;color:var(--text-2)}
@media(max-width:960px) {.me{grid-template-columns:240px minmax(0,1fr);gap:var(--s-6)}.me__destinations{grid-template-columns:1fr}}
@media(max-width:700px) {
 .me{grid-template-columns:1fr;gap:var(--s-6);padding-top:var(--s-6)}
 .me__who{gap:var(--s-3)}.me__identity{display:flex;align-items:center;gap:var(--s-4)}
 .me__face{width:72px;height:72px}.me__name{font-size:24px}.me__bio{font-size:15px}
 .me__profile-actions{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start;gap:var(--s-3)}
 .me__profile-actions:has(.community-profile--editing){grid-template-columns:1fr}
 .me__main{grid-column:1;grid-row:2;gap:var(--s-6)}.me__links{grid-row:3;margin:0;padding-top:var(--s-4)}.me__logout{grid-row:4;margin-top:calc(var(--s-4)*-1)}
 .me__destination{padding:var(--s-4)}
}
</style>

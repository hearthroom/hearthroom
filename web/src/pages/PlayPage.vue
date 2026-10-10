<script setup lang="ts">
/**
 * /play/:roleId — 在站內玩一張卡。
 *
 * 整頁交給舞台（stage/ 打成的 moonstage/stage 套件）：沒有站台的頁首頁尾（route.meta.bare），
 * 因為魅魔島那類卡靠全頁樣式換背景與輸入框，套上站台外框會打架。
 * 這頁只負責三件事：把套件載進來並接上宿主、把 roleId 交給畫布、畫舞台丟出來的提示。
 *
 * 遊客也進得來（owner 2026-10-10）：看開場、挑開場、點開場選項、打字都不用登入，按下送出那一刻
 * 才在原地彈登入框（GuestSignInSheet）。這時候他最想玩，登入（＝註冊）完回到同一頁，草稿還在。
 * 遊客只走公開的路：上架中的卡、本站這一家。續玩紀錄、審核、作者試玩、別家供應商照舊要先登入。
 */
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, shallowRef, watch, type Component } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import { playProvider } from '@/lib/play-context';
import { accountToken, connectAccount } from '@/lib/connections';
import { currentProvider, apiBaseOf } from '@/lib/provider';
import { ensurePlayAuthorization } from "@/lib/play-authorization";
import { ensureStage, preloadStage, remergeStageMessages, stageToasts } from "@/lib/stage-host";
import { useSession } from "@/lib/session";
import { useLocalePath } from "@/lib/use-locale";
import { contentLang, pageTitle } from "@/lib/i18n";
import { track } from "@/lib/track";
import { fetchMeAt } from "@/lib/api";
import { resolvePlayCard } from "@/lib/play-card";
import { applyCardHead } from "@/lib/card-manifest";
import { requestInstallToast } from "@/lib/pwa";
import { communityHost, isPlayHost } from "@/lib/site";
import { registerPlayCard } from "@/lib/play-social";
import PlayComments from "@/components/PlayComments.vue";
import GuestSignInSheet from "@/components/GuestSignInSheet.vue";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const routeId = computed(() => String(route.params.roleId || ""));
const roleId = shallowRef("");
const Stage = shallowRef<Component | null>(null);
const error = shallowRef("");
/** 遊客按了送出：在原地請他登入 */
const signInOpen = shallowRef(false);

// 路由守衛每次導航都會把標題設回預設，換卡（同一個元件實例）之後要再蓋一次
watch(roleId, () => { document.title = pageTitle(t("play.title")); }, { immediate: true });

// 卡片 App 網域（lib/site.ts）：這一頁的 manifest 是這張卡的，瀏覽器的「安裝」與 iOS 的「加入主畫面」
// 裝下去的就是它（lib/card-manifest.ts）。私有卡也以數字卡號解析，內容仍由來源平台授權。
// 主站的對話頁不換：卡片只該有一個 App 身分，就是卡片 App 網域上那個。
const playApp = isPlayHost();
const cardNumber = shallowRef<string>("");
const cardPageUrl = computed(() => `https://${communityHost()}/${locale.value === "zh-Hant" ? "" : `${locale.value}/`}${cardNumber.value ? `cards/${cardNumber.value}` : ""}`);
if (playApp) {
  onBeforeUnmount(() => applyCardHead(null, String(locale.value)));
  // 卡片頁按了「加到主畫面」帶 ?install=1 過來：把提示卡拿出來
  if (route.query.install === "1") requestInstallToast();
}

/**
 * 卡片解析好了：記下卡號與畫布要的 roleId、登記頁首的收藏與評論、卡片 App 的頭，網址換成卡號那一個。
 * 換網址途中又換了卡（stale）回 false。
 */
async function adopt(resolved: Awaited<ReturnType<typeof resolvePlayCard>>, provider: ReturnType<typeof playProvider>, stale: () => boolean): Promise<boolean> {
  cardNumber.value = resolved.number;
  roleId.value = resolved.roleId;
  // 頁首的收藏與評論只給上架中的公開卡：作者試玩的是草稿、審核的還沒上架，都不登記。
  const listed = resolved.card && route.query.mode !== "source" && typeof route.query.review !== "string"
    && (!resolved.card.status || resolved.card.status === "approved");
  registerPlayCard(listed ? { roleId: resolved.roleId, cardId: String(resolved.card!.id), provider } : null);
  if (playApp) applyCardHead(resolved.card, locale.value);
  if (routeId.value !== resolved.number) {
    const destination = { path: playApp ? `/${resolved.number}/` : route.path.replace(/[^/]+\/?$/, resolved.number), query: route.query, hash: route.hash };
    canonicalNavigation = router.resolve(destination).fullPath;
    await router.replace(destination);
    canonicalNavigation = "";
    if (stale()) return false;
  }
  return true;
}

let generation = 0;
let canonicalNavigation = "";
let playerProvider = "";
onBeforeUnmount(() => { generation++; registerPlayCard(null); });
onMounted(() => {
  const app = getCurrentInstance()?.appContext.app;
  if (!app) return;
  watch([routeId, () => route.query.provider, () => route.query.mode, () => route.query.review, () => route.query.resume], async () => {
    if (route.fullPath === canonicalNavigation) return;
    const request = ++generation;
    const stale = () => request !== generation;
    Stage.value = null;
    roleId.value = "";
    cardNumber.value = "";
    error.value = "";
    registerPlayCard(null);
    try {
      void preloadStage();
      const provider = playProvider(route.query.provider);
      // Stage installs its API and credential host once per document.
      if (playerProvider && playerProvider !== provider) { location.assign(route.fullPath); return; }
      const sameProvider = provider === currentProvider();
      const returnTo = route.fullPath;
      const profileReady = session.ensureProfile();
      if (!sameProvider) await profileReady;
      if (stale()) return;
      // 遊客：本站這一家、上架中的卡，不必登入就掛舞台（只畫開場，送出時才請他登入）
      const publicPlay = sameProvider && route.query.mode !== "source" && typeof route.query.review !== "string" && typeof route.query.resume !== "string";
      // 路由不再擋未登入的人：身分還沒確認就在這裡確認（已經知道是誰就不必等）
      if (publicPlay && !session.me && !session.ready) await session.restore();
      if (stale()) return;
      if (publicPlay && !session.me) {
        const resolved = await resolvePlayCard(routeId.value, provider, contentLang(locale.value));
        if (stale()) return;
        if (!(await adopt(resolved, provider, stale))) return;
        playerProvider = provider;
        const stage = await ensureStage({ app, router, session, provider, accessToken: async () => null, player: null,
          currentPath: () => route.fullPath, currentRoleId: () => roleId.value, lp, guest: true,
          onSignInRequired: () => { signInOpen.value = true; track("play_signin", { subject: roleId.value }); } });
        if (stale()) return;
        Stage.value = stage;
        track("play_open", { subject: roleId.value, detail: "guest" });
        return;
      }
      const identity = session.profile?.identities.find(i => i.provider === provider);
      const accessToken = () => sameProvider ? session.accessToken() : accountToken(provider, identity?.externalId);
      if (!sameProvider && !identity) { await connectAccount(provider, returnTo); return; }
      const token = await accessToken();
      if (stale()) return;
      if (!token) { await connectAccount(provider, returnTo); return; }
      const [authorized, , resolved] = await Promise.all([
        ensurePlayAuthorization(token, returnTo, provider),
        profileReady,
        resolvePlayCard(routeId.value, provider, contentLang(locale.value), route.query.mode === "source", typeof route.query.review === "string" ? {id:route.query.review,token} : undefined,
          typeof route.query.resume === "string" ? {id:route.query.resume,token:await session.accessToken() ?? ""} : undefined),
      ]);
      if (!authorized || stale()) return;
      if (!(await adopt(resolved, provider, stale))) return;
      const player = sameProvider ? session.me : await fetchMeAt(apiBaseOf(provider), token);
      if (stale()) return;
      playerProvider = provider;
      const stage = await ensureStage({ app, router, session, provider, accessToken, player,
        currentPath: () => route.fullPath, currentRoleId: () => roleId.value, lp });
      if (stale()) return;
      Stage.value = stage;
      track("play_open", { subject: roleId.value });
    } catch {
      if (!stale()) error.value = t("play.loadFailed");
    }
  }, { immediate: true });
});

watch(locale, () => { void remergeStageMessages(); });
</script>

<template>
  <div class="play">
    <component :is="Stage" v-if="Stage" :key="roleId" :role-id="roleId" />
    <div v-else class="play__state">
      <p v-if="error" class="play__error" role="alert">{{ error }}</p>
      <p v-else class="subtle">{{ $t("play.loading") }}</p>
      <a v-if="error && playApp" class="btn" :href="cardPageUrl">{{ $t("play.backToCard") }}</a>
      <RouterLink v-else-if="error" class="btn" :to="lp(cardNumber ? `/cards/${cardNumber}` : '/')">{{ $t("play.backToCard") }}</RouterLink>
    </div>
    <PlayComments />
    <GuestSignInSheet v-if="signInOpen" :return-to="route.fullPath" @close="signInOpen = false" />
    <div class="play__toasts" aria-live="polite">
      <div v-for="toast in stageToasts.list" :key="toast.id" class="play__toast" :class="`play__toast--${toast.kind}`">{{ toast.text }}</div>
    </div>
  </div>
</template>

<style scoped>
.play { min-height: 100vh; min-height: 100dvh; }
.play__state { min-height: 60vh; display: grid; place-content: center; gap: var(--s-4); text-align: center; padding: var(--s-6); }
.play__error { color: var(--danger); }
.play__toasts { position: fixed; left: 50%; top: calc(var(--s-4) + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 1200; display: grid; gap: var(--s-2); pointer-events: none; }
.play__toast { padding: var(--s-2) var(--s-4); border-radius: var(--r-md); background: var(--surface); color: var(--text); box-shadow: var(--shadow-2); font-size: 14px; max-width: min(90vw, 480px); }
.play__toast--error { border-left: 3px solid var(--danger); }
.play__toast--success { border-left: 3px solid var(--accent); }
</style>

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
import { computed, getCurrentInstance, onBeforeUnmount, onMounted, ref, shallowRef, watch, type Component } from "vue";
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
import { setPlayShare, setPlayShareRef, shareContextOf } from "@/lib/play-share";
import { currentReferralCode } from "@/lib/share-ref";
import PlayComments from "@/components/PlayComments.vue";
import GuestSignInSheet from "@/components/GuestSignInSheet.vue";
import PlayLoading from "@/components/PlayLoading.vue";
import AdultGate from "@/components/AdultGate.vue";
import { readPlayIntro, type PlayIntro } from "@/lib/play-intro";
import { stageContentSeq } from "@/lib/stage-ready";
import { displayName } from "@/lib/display-name";

const route = useRoute();
const router = useRouter();
const session = useSession();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const routeId = computed(() => String(route.params.roleId || ""));
const roleId = shallowRef("");
const historyBootstrap = shallowRef<{conversationId?:string;readOnly?:boolean;reason?:string;title?:string}>({});
const Stage = shallowRef<Component | null>(null);
const error = shallowRef("");
/** 審核試玩打不開是因為沒領著（含領取過了時效）或這輪已結束：回審核頁就能處理，不是舞台壞了 */
const backToReview = shallowRef(false);
/**
 * 成人內容的卡、看的人還沒打開（讀卡回 403 adult_content）：畫卡片頁那道門，不是「載不進來」。
 * 在門上打開了就把 retry 加一，整條開卡流程重跑一次。
 */
const gated = shallowRef(false);
// A shallow ref forces a multi-source watch to run even when its values are
// unchanged. Overlay history pops must not restart this mounted player.
const retry = ref(0);
/** 遊客按了送出：在原地請他登入 */
const signInOpen = shallowRef(false);

/**
 * 載入畫面（PlayLoading）：從第一幀蓋到舞台喊「畫好了」（lib/stage-ready）。卡名與封面先用卡片頁
 * 交過來的（lib/play-intro），直接開網址的等卡片解析好再補。舞台掛上之後一直沒喊（卡住、舊版舞台）
 * 時限到了照樣收：沙箱殼握手逾時是 20 秒，到那時舞台自己會顯示提示，這一層不該再擋著。
 * 時限從舞台掛上才開始算：還沒掛上就是還在載（失敗會走錯誤畫面），這時收掉只會留下一片空白。
 */
const COVER_MAX_MS = 22_000;
const intro = shallowRef<PlayIntro | null>(readPlayIntro(routeId.value));
const readyBaseline = shallowRef(stageContentSeq.value);
const coverExpired = shallowRef(false);
const covering = computed(() => !error.value && !gated.value && !coverExpired.value && stageContentSeq.value <= readyBaseline.value);
let coverTimer: ReturnType<typeof setTimeout> | undefined;
function resetCover() {
  readyBaseline.value = stageContentSeq.value;
  coverExpired.value = false;
  clearTimeout(coverTimer);
  if (!intro.value) intro.value = readPlayIntro(routeId.value);
}
watch(Stage, (stage) => {
  clearTimeout(coverTimer);
  if (stage) coverTimer = setTimeout(() => { coverExpired.value = true; }, COVER_MAX_MS);
});
onBeforeUnmount(() => clearTimeout(coverTimer));

// 路由守衛每次導航都會把標題設回預設，換卡（同一個元件實例）之後要再蓋一次
watch(roleId, () => { document.title = pageTitle(t("play.title")); }, { immediate: true });

// 卡片 App 網域（lib/site.ts）：這一頁的 manifest 是這張卡的，瀏覽器的「安裝」與 iOS 的「加入主畫面」
// 裝下去的就是它（lib/card-manifest.ts）。私有卡也以數字卡號解析，內容仍由來源平台授權。
// 主站的對話頁不換：卡片只該有一個 App 身分，就是卡片 App 網域上那個。
const playApp = isPlayHost();
const cardNumber = shallowRef<string>("");
const cardPageUrl = computed(() => `https://${communityHost()}/${locale.value === "zh-Hant" ? "" : `${locale.value}/`}${cardNumber.value ? `cards/${cardNumber.value}` : ""}`);
const reviewPath = computed(() => `/review/${encodeURIComponent(String(route.query.review ?? ""))}`);
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
  historyBootstrap.value = {conversationId:resolved.conversationId,readOnly:resolved.readOnly,reason:resolved.reason,title:resolved.title};
  if (resolved.card && !intro.value) intro.value = { name: displayName(resolved.card.name ?? "", locale.value), art: resolved.card.avatarUrl ?? "", backdrop: resolved.card.landscapeUrl ?? "" };
  roleId.value = resolved.roleId;
  // 頁首的收藏與評論只給上架中的公開卡：作者試玩的是草稿、審核的還沒上架，都不登記。
  const listed = resolved.card && route.query.mode !== "source" && typeof route.query.review !== "string"
    && (!resolved.card.status || resolved.card.status === "approved");
  registerPlayCard(listed ? { roleId: resolved.roleId, cardId: String(resolved.card!.id), provider } : null);
  adoptShare(resolved);
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

/**
 * 卡內分享情境（lib/play-share）：朋友的情境碼只在一般遊玩開機時給，看紀錄、審核試玩不帶；
 * 分享連結與「誰打得開」照給。登入者的推薦碼跟舞台一起載，通常在殼握手前就到了。
 */
function adoptShare(resolved: Awaited<ReturnType<typeof resolvePlayCard>>) {
  const fresh = typeof route.query.review !== "string" && typeof route.query.resume !== "string";
  const raw = fresh && typeof route.query.share === "string" ? route.query.share : null;
  const enabled = resolved.card?.shareContext === true;
  setPlayShare({ roleId: resolved.roleId, cardNumber: resolved.number, context: raw, audience: resolved.card?.audience ?? null, enabled });
  // 從帶情境的連結開卡記一次（情境碼本身不送）：看得出卡內分享有沒有人點、碼有沒有壞、開關是不是關著
  if (raw !== null) track("share_context", { subject: resolved.roleId, detail: !enabled ? "disabled" : shareContextOf(raw) ? "delivered" : "invalid" });
  // 推薦碼在讀卡的同時就開始問（startShareRef），這裡只是接上；多半在殼握手前就到了
  void (pendingShareRef ?? Promise.resolve(null)).then((code) => setPlayShareRef(resolved.roleId, code), () => {});
}

/** 登入者的推薦碼：跟讀卡同時開始問，卡片腳本一跑就拿得到帶推薦碼的分享連結（作者常在載入時就備好連結與 QR）。 */
let pendingShareRef: Promise<string | null> | null = null;
function startShareRef(profileReady: Promise<unknown>) {
  const id = session.me?.accountNumId;
  // 查推薦碼要用到個人資料（服務帳號），等它好了再問，不另外觸發一次讀取
  pendingShareRef = id ? profileReady.then(() => currentReferralCode(id)).catch(() => null) : null;
}

let generation = 0;
let canonicalNavigation = "";
let playerProvider = "";
onBeforeUnmount(() => { generation++; registerPlayCard(null); setPlayShare(null); });
onMounted(() => {
  const app = getCurrentInstance()?.appContext.app;
  if (!app) return;
  watch([routeId, () => route.query.provider, () => route.query.mode, () => route.query.review, () => route.query.resume, retry], async () => {
    if (route.fullPath === canonicalNavigation) return;
    const request = ++generation;
    const stale = () => request !== generation;
    // 換卡（同一個元件實例）：上一張的封面不能留在新卡的載入畫面上
    if (roleId.value) intro.value = null;
    resetCover();
    Stage.value = null;
    roleId.value = "";
    cardNumber.value = "";
    error.value = "";
    gated.value = false;
    backToReview.value = false;
    registerPlayCard(null);
    setPlayShare(null);
    try {
      void preloadStage();
      const provider = playProvider(route.query.provider);
      // Stage installs its API and credential host once per document.
      if (playerProvider && playerProvider !== provider) { location.assign(route.fullPath); return; }
      const sameProvider = provider === currentProvider();
      const returnTo = route.fullPath;
      const publicPlay = sameProvider && route.query.mode !== "source" && typeof route.query.review !== "string" && typeof route.query.resume !== "string";
      // A library anchor starts a fresh document too. Restore the saved session
      // before asking for credentials; otherwise accessToken() can refresh an
      // empty in-memory session while App's restore is still in flight.
      if (!publicPlay && !session.me && !session.ready) await session.restore();
      if (stale()) return;
      const profileReady = session.ensureProfile();
      if (!sameProvider) await profileReady;
      if (stale()) return;
      // 遊客：本站這一家、上架中的卡，不必登入就掛舞台（只畫開場，送出時才請他登入）
      // 路由不再擋未登入的人：身分還沒確認就在這裡確認（已經知道是誰就不必等）
      if (publicPlay && !session.me && !session.ready) await session.restore();
      if (stale()) return;
      startShareRef(profileReady);
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
          typeof route.query.resume === "string" ? {id:route.query.resume,token:await session.accessToken() ?? "",providerToken:token} : undefined),
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
    } catch (err) {
      if (stale()) return;
      // lib/api 的 ApiError：伺服器原文在 code，message 已換成「請求失敗」
      const { status, code } = (err ?? {}) as { status?: number; code?: string };
      // 還沒解析出卡號：門下的「回到卡片」用網址上的 ID，卡片頁自己會換成卡號
      if (status === 403 && code === "adult_content") { gated.value = true; cardNumber.value ||= routeId.value; return; }
      backToReview.value = typeof route.query.review === "string" && (code === "claim this submission first" || status === 410);
      error.value = !backToReview.value ? t("play.loadFailed") : status === 410 ? t("review.inactive") : t("play.claimFirst");
    }
  }, { immediate: true });
});

watch(locale, () => { void remergeStageMessages(); });
</script>

<template>
  <div class="play">
    <component :is="Stage" v-if="Stage" :key="roleId" :role-id="roleId" :conversation-id="historyBootstrap.conversationId" :read-only="historyBootstrap.readOnly" :access-reason="historyBootstrap.reason" :history-title="historyBootstrap.title" />
    <div v-else-if="error || gated" class="play__state">
      <AdultGate v-if="gated" @enabled="retry++" />
      <p v-else class="play__error" role="alert">{{ error }}</p>
      <a v-if="backToReview && playApp" class="btn" :href="`https://${communityHost()}${lp(reviewPath)}`">{{ $t("play.backToReview") }}</a>
      <RouterLink v-else-if="backToReview" class="btn" :to="lp(reviewPath)">{{ $t("play.backToReview") }}</RouterLink>
      <a v-else-if="playApp" class="btn" :href="cardPageUrl">{{ $t("play.backToCard") }}</a>
      <RouterLink v-else class="btn" :to="lp(cardNumber ? `/cards/${cardNumber}` : '/')">{{ $t("play.backToCard") }}</RouterLink>
    </div>
    <Transition name="play-cover">
      <PlayLoading v-if="covering" :name="intro?.name" :art="intro?.art" :backdrop="intro?.backdrop" />
    </Transition>
    <PlayComments />
    <GuestSignInSheet v-if="signInOpen" :return-to="route.fullPath" @close="signInOpen = false" />
    <div class="play__toasts" aria-live="polite">
      <div v-for="toast in stageToasts.list" :key="toast.id" class="play__toast" :class="`play__toast--${toast.kind}`" :role="toast.kind === 'error' ? 'alert' : 'status'" :aria-live="toast.kind === 'error' ? 'assertive' : 'polite'" aria-atomic="true">
        <svg v-if="toast.kind === 'error' || toast.kind === 'warning'" class="play__toast-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 3 2 21h20L12 3Z"/><path d="M12 9v5m0 3v1"/></svg>
        <span>{{ toast.text }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.play { min-height: 100vh; min-height: 100dvh; }
.play__state { min-height: 60vh; display: grid; place-content: center; gap: var(--s-4); text-align: center; padding: var(--s-6); }
.play__error { color: var(--danger); }
.play-cover-leave-active { transition: opacity 250ms ease-out; }
.play-cover-leave-to { opacity: 0; }
.play__toasts { position: fixed; left: 50%; top: calc(var(--s-4) + env(safe-area-inset-top, 0px)); transform: translateX(-50%); z-index: 1200; display: grid; gap: var(--s-2); pointer-events: none; }
.play__toast { display: flex; align-items: center; gap: var(--s-2); padding: var(--s-2) var(--s-4); border-radius: var(--r-md); background: var(--surface); color: var(--text); box-shadow: var(--shadow-md); font-size: 14px; max-width: min(90vw, 480px); }
.play__toast:lang(ko) { word-break: keep-all; overflow-wrap: anywhere; }
.play__toast-icon { width: 20px; height: 20px; flex: 0 0 20px; }
.play__toast--warning { border-left: 3px solid var(--warning-text); }
.play__toast--error { border-left: 3px solid var(--danger); }
.play__toast--success { border-left: 3px solid var(--accent); }
</style>

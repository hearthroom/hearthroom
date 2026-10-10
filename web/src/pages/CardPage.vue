<script setup lang="ts">
/**
 * 卡片頁：還沒開始對話之前看到的那一頁（2026-10-11 改版，owner 確認過版面模擬）。
 *
 *   身分列  橫幅（作者的橫式背景圖）、封面、卡名、一句話簡介、作者／評分／對話數、開始對話、分級標示、標籤
 *   左欄    作者用 Markdown 寫的介紹，接著是評論
 *   右欄    評分、卡片資訊、同一位作者的其他作品；黏在畫面上，介紹再長也一直看得到評分
 *
 * 開場白不放在這裡：它是開始對話之後才出現的東西，而且多半是給模型看的設定，放在預覽頁沒有意義。
 * 「開始對話」一定在第一屏：桌機在身分列裡，手機固定在畫面最底部。
 */
import { cardFandom } from "@/lib/fandom";
import CommunityAvatar from "@/components/CommunityAvatar.vue";
import CommunityName from "@/components/CommunityName.vue";
import LibraryToggle from "@/components/LibraryToggle.vue";
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import CommentPanel from "@/components/CommentPanel.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import AdultGate from "@/components/AdultGate.vue";
import CardScore from "@/components/CardScore.vue";
import ReadmeView from "@/components/ReadmeView.vue";
import { ApiError, fetchBoard, fetchCard, fetchCardPlatforms, fetchCardScore, fetchRoleDetail, saveCardScore, type CardPlatform, type CardScore as Score } from "@/lib/api";
import { recallCard } from "@/lib/card-memory";
import { renderReadme } from "@/lib/card-readme";
import { currentProvider, type ProviderId } from "@/lib/provider";
import CardOwnerActions from "@/components/CardOwnerActions.vue";
import RatingMark from "@/components/RatingMark.vue";
import CardPlatforms from "@/components/CardPlatforms.vue";
import ShareMenu from "@/components/ShareMenu.vue";
import { useSession } from "@/lib/session";
import { contentLang, pageTitle, zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import { compact, dateOnly, dateTime, hueFrom } from "@/lib/format";
import { titleLayout } from "@/lib/title-layout";
import { displayName } from "@/lib/display-name";
import { confirmDialog } from "@/lib/confirm";
import { track } from "@/lib/track";
import { canInstall } from "@/lib/pwa";
import { playAppUrl } from "@/lib/site";
import { loginPath } from "@/lib/login-return";
import type { CommunityCard } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const card = ref<CommunityCard | null>(null);
// 標題照介面字形顯示（跟榜單、對話頁同一套規則）；佔位色與分享出去的標題用原文。
const shownName = computed(() => displayName(card.value?.name ?? "", locale.value));
const title = computed(() => titleLayout(shownName.value));
const loading = ref(true);
/** 手上有卡、在背景換語言重抓：舊卡留著變淡，不退回骨架 */
const revalidating = ref(false);
const missing = ref(false);
/** 成人內容、而看的人沒登入或沒開：畫門，不畫 404 */
const gated = ref(false);
const error = ref("");

/** 作者寫的介紹（Markdown 原文）；來源端的詳情約一秒才到 */
const readme = ref("");
/** 詳情還在路上：介紹那一塊先畫骨架，到了再換，評論不會整塊被往下推 */
const detailsPending = ref(false);
const session = useSession();
// 留言是本站自己的功能，不看供應商；只有作者在來源端關掉時才收起來
const showComments = ref(true);
const commentCount = ref<number | null>(null);
/**
 * 伺服器那份卡已經拿到了：成人卡要等這個才讀留言。先畫的那份是上一屏帶過來的，身分可能還在路上，
 * 這時讀留言會被成人內容的門擋下，錯誤就卡在留言區裡。一般卡不必等。
 */
const confirmed = ref(false);
/** 同一位作者的其他作品：右欄最多四張，其餘在作者頁 */
const more = ref<CommunityCard[]>([]);
const MORE_MAX = 4;
const shareUrl = computed(() => new URL(lp(`/cards/${card.value?.id ?? route.params.id}`), location.origin).href);
const copied = ref(false);
/**
 * 作者最後一次改內容的時間（來源端的資料，對話次數之類的統計不會動它）。
 * 玩家靠它判斷「這張卡有沒有更新」（玩家回報 2026-09-17）；很早期建的卡沒有這個值，就不顯示。
 */
const editedAt = ref<number | null>(null);

const hue = computed(() => hueFrom(card.value?.name ?? ""));
const broken = ref(false);
const hasArt = computed(() => !!card.value?.avatarUrl && !broken.value);
const bannerBroken = ref(false);
/** 橫幅只用作者的橫式背景圖；分享圖上壓著標題字，跟頁面標題重複，不拿來用 */
const banner = computed(() => (!bannerBroken.value && card.value?.landscapeUrl) || "");
/** 在榜才有評分與評論（跟伺服器同一個條件） */
const listed = computed(() => !card.value?.status || card.value.status === "approved");

/**
 * 介紹：作者寫了就照 Markdown 畫；沒寫的話，簡介夠長（舊卡多半把整段介紹塞在簡介裡）就把簡介當介紹，
 * 短的簡介頁首已經顯示過，不再重複一次。
 */
const LONG_SUMMARY = 120;
const readmeHtml = computed(() => (readme.value.trim() ? renderReadme(readme.value) : ""));
const summaryAsIntro = computed(() => !readmeHtml.value && [...(card.value?.summary ?? "")].length > LONG_SUMMARY);
const hasIntro = computed(() => !!readmeHtml.value || summaryAsIntro.value);

/** 介紹超過約一屏才收起來、出現「展開全文」；短的完整顯示 */
const INTRO_MAX = 900;
const introBox = ref<HTMLElement | null>(null);
const introLong = ref(false);
const introOpen = ref(false);
let introObserver: ResizeObserver | null = null;
watch(introBox, (el) => {
  introObserver?.disconnect();
  introObserver = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  introObserver = new ResizeObserver(() => { introLong.value = el.scrollHeight > INTRO_MAX + 120; });
  introObserver.observe(el);
});

// ── 評分 ───────────────────────────────────────────────────────────────
const score = ref<Score | null>(null);
const scoreBusy = ref(false);
const own = computed(() => !!session.profile?.handle && session.profile.handle === card.value?.author.handle);
async function loadScore() {
  const c = card.value;
  if (!c || !listed.value) { score.value = null; return; }
  try {
    const token = session.me ? (await session.accessToken()) ?? undefined : undefined;
    const got = await fetchCardScore(c.id, token);
    // 回應形狀不對（代理回了別的東西）就當成沒有評分，不讓右欄崩掉
    const valid = Array.isArray(got?.histogram) && got.histogram.length === 5 && typeof got.count === "number";
    if (card.value?.id === c.id) score.value = valid ? got : null;
  } catch { /* 讀不到評分只是少一塊，不擋整頁 */ }
}
async function rate(next: number | null) {
  const c = card.value;
  if (!c) return;
  if (!session.me) { await router.push(lp(loginPath(route.fullPath))); return; }
  scoreBusy.value = true;
  try {
    const token = await session.accessToken();
    if (!token) { await router.push(lp(loginPath(route.fullPath))); return; }
    await saveCardScore(c.id, next, token);
    track("card_score", { detail: next === null ? "score_clear" : `score_${next}`, subject: c.roleId });
    await loadScore();
  } catch (err) {
    track("card_score", { detail: "score_failed", subject: c.roleId, ok: false });
    await confirmDialog({ title: t("score.title"), message: err instanceof Error ? err.message : t("state.actionFailed"), single: true });
  } finally {
    scoreBusy.value = false;
  }
}
/** 「寫評論」：捲到評論、把游標放進輸入框（沒登入就停在登入鈕） */
async function writeReview() {
  const section = document.getElementById("comments");
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  await nextTick();
  section?.querySelector<HTMLTextAreaElement>("textarea")?.focus({ preventScroll: true });
}
watch(() => session.me?.accountNumId, () => { void loadScore(); });

/**
 * 主頁其餘的資料：介紹、評論開關、同一位作者的其他作品。
 * 讀不到只是少一塊，不擋整頁；跟卡片本身分開，手上一有卡就可以開始拿。
 */
function loadDetails(roleId: string, authorHandle: string | null, lang: string, provider: ProviderId) {
  detailsPending.value = true;
  void fetchRoleDetail(roleId, undefined, lang, provider)
    .then((raw) => {
      if (card.value?.roleId !== roleId) return;
      const edited = Date.parse(String(raw.contentLastEditedAt ?? ""));
      editedAt.value = Number.isFinite(edited) ? edited : null;
      readme.value = typeof raw.roleReadme === "string" ? raw.roleReadme : "";
      showComments.value = listed.value && raw.previewShowComments !== false;
    })
    .catch(() => { /* 沒有介紹也能看 */ })
    .finally(() => { if (card.value?.roleId === roleId) detailsPending.value = false; });
  void loadScore();
  // 「其他作品」要作者的本站公開 ID；作者還沒成為成員（很早期登記過、之後沒再登入）就不列
  if (authorHandle) {
    void fetchBoard({ author: authorHandle, sort: "hot", limit: MORE_MAX + 1, lang })
      .then((b) => { more.value = b.items.filter((c) => c.roleId !== roleId).slice(0, MORE_MAX); })
      .catch(() => { more.value = []; });
  } else {
    more.value = [];
  }
}

/** 標題與描述跟著手上這份卡走；先畫的那份就先寫，伺服器那份回來再寫一次。 */
function applyHead(c: { name: string; summary: string }) {
  document.title = pageTitle(displayName(c.name, locale.value));
  document.querySelector<HTMLMetaElement>('meta[name="description"]')?.setAttribute("content", c.summary);
}
// 字典在標題寫進分頁之後才載好時，再把分頁標題換成轉換後的寫法。
watch(shownName, (name) => { if (card.value) document.title = pageTitle(name); });

// 同一頁可能同時有好幾次讀卡在路上（進頁一次、身分到了再一次、開關改了又一次）。
// 只認最後一次：身分到之前發出的那次沒帶成人權限，它的 403 常常比後面那次的卡片晚回來，
// 照單全收就把已經畫好的卡蓋成門（玩家回報 2026-09-23，重新整理才好）。
let loadGeneration = 0;
/** afterIdentity：身分載好後的那次重讀。再被擋就是真的沒權限，畫門，不再重試。 */
async function load(afterIdentity = false) {
  const request = ++loadGeneration;
  // 換語言時手上還有卡：留著變淡，資料到了再換，不退回骨架
  revalidating.value = !!card.value;
  const id = route.params.id as string;
  const lang = contentLang(locale.value);
  // 剛才那一屏（榜單／搜尋／作者頁）看過這張卡：立刻整頁畫出來，不變淡也能點，
  // 伺服器那一份在背景更新。點一張卡要等一秒黑畫面的就是這一次往返（玩家回報 2026-09-17）。
  if (!card.value) card.value = recallCard(id);
  loading.value = !card.value;
  missing.value = false;
  gated.value = false;
  error.value = "";
  const shown = card.value;
  if (shown) {
    applyHead(shown);
    loadDetails(shown.roleId, shown.author.handle, lang, (shown.provider as ProviderId) ?? currentProvider());
  }
  try {
    const fetched = await fetchCard(id, lang);
    if (request !== loadGeneration) return;
    card.value = fetched;
    confirmed.value = true;
    if (card.value.num && id !== String(card.value.num)) {
      const url = new URL(window.location.href);
      url.pathname = lp(`/cards/${card.value.num}`);
      window.history.replaceState(window.history.state, '', url.pathname + url.search + url.hash);
    }
  } catch (err) {
    if (request !== loadGeneration) return;
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else if (err instanceof ApiError && err.status === 403 && err.code === "adult_content") {
      // 被擋時身分可能還在路上：先留在骨架等它，開著就帶權限再讀一次，確定沒開才畫門。
      // 直接畫門的話，開了成人內容的人每次重新整理都會先看到門閃一下（玩家回報 2026-09-26）。
      if (!afterIdentity) {
        await session.restore();
        if (request !== loadGeneration) return;
        if (session.profile?.showNsfw) { void load(true); return; }
      }
      gated.value = true; card.value = null;
    }
    else if (!shown) error.value = err instanceof Error ? err.message : t("state.loadFailed");
    // 手上那份是剛才那一屏帶過來的：背景更新失敗就讓它繼續顯示，不要把已經畫好的頁面換成錯誤
    loading.value = false;
    revalidating.value = false;
    return;
  }
  loading.value = false;
  revalidating.value = false;
  applyHead(card.value);
  if (!shown) loadDetails(card.value.roleId, card.value.author.handle, lang, (card.value.provider as ProviderId) ?? currentProvider());
  // 先畫的那份可能是別處帶過來的舊狀態（例如還沒上榜）：伺服器那份到了再讀一次評分
  else if (listed.value && !score.value) void loadScore();
}

// 卡號是本站發的永久數字（私有卡也有）：作者對外報卡、玩家在不能貼連結的地方靠它找卡
//（作者回報 2026-09-16 要 ID；2026-09-17 嫌一長串，改成短號）。搜尋框輸入卡號就會開這張卡。
// 拿不到剪貼簿就把它攤開讓人自己選。
async function copyId() {
  const id = card.value?.num ? String(card.value.num) : "";
  if (!id) return;
  try {
    await navigator.clipboard.writeText(id);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1800);
  } catch {
    await confirmDialog({ title: t("card.id"), message: t("card.copyIdManual"), detail: id, single: true });
  }
}

// 可遊玩平台和卡片本身同時查：原本要等卡片到了才掛上平台選單再查，兩趟往返疊在一起。
// 只有卡號連結先查——卡號是本站發的永久編號，一定指向同一張卡；其他形式的 ID 等卡片到了再照卡片 ID 查。
const platformsRequest = ref<{ id: string; request: Promise<CardPlatform[]> } | null>(null);
watch(() => route.params.id, () => {
  const id = String(route.params.id ?? "");
  platformsRequest.value = /^[1-9]\d*$/.test(id) ? { id, request: fetchCardPlatforms(id) } : null;
  platformsRequest.value?.request.catch(() => {});
  card.value = null; readme.value = ""; detailsPending.value = false; more.value = []; broken.value = false; bannerBroken.value = false; editedAt.value = null;
  commentCount.value = null; showComments.value = true; score.value = null; introOpen.value = false; confirmed.value = false;
  load();
}, { immediate: true });
watch(locale, () => load());

// 加到主畫面：每張卡在卡片 App 網域上各自是一個 App（lib/site.ts），安裝要在那個網域的頁面上做，
// 所以按下去先過去那張卡的對話頁（帶 install=1，那邊會把提示卡拿出來）。
const installable = canInstall();
function addToHome() {
  const c = card.value;
  if (!c) return;
  track("pwa_card_install_click", { subject: c.roleId });
  location.assign(playAppUrl(String(c.num ?? c.id), locale.value, { install: true, provider: c.provider }));
}

/**
 * 右欄常常比視窗高（評分、卡片資訊、其他作品加起來超過一個筆電螢幕）。只貼在頁首下，底部就永遠露不出來。
 * 把右欄高度交給 CSS：放得下就貼頁首，放不下就先跟著頁面捲，底部露出來再貼住。
 */
const side = ref<HTMLElement | null>(null);
let sideObserver: ResizeObserver | null = null;
watch(side, (el) => {
  sideObserver?.disconnect();
  sideObserver = null;
  if (!el || typeof ResizeObserver === "undefined") return;
  sideObserver = new ResizeObserver(() => el.style.setProperty("--side-h", `${el.offsetHeight}px`));
  sideObserver.observe(el);
});
onBeforeUnmount(() => { sideObserver?.disconnect(); introObserver?.disconnect(); });

// 開關改了要重讀。身分第一次載好（undefined → 值）只在門已經畫出來時重讀：
// 讀卡被擋時自己會等身分（見 load），卡已經讀到就不必再讀一次
watch(() => session.profile?.showNsfw, (now, before) => {
  if (now === before) return;
  if (before === undefined && !gated.value) return;
  void load();
});
</script>

<template>
  <NotFoundPage v-if="missing" :title="$t('card.notFound.title')" :hint="$t('card.notFound.hint')" />
  <div v-else-if="gated" class="page"><AdultGate @enabled="load()" /></div>

  <div v-else class="page role">
    <!-- 骨架照著真的版面畫：封面＋名字，下面左右兩欄，資料來了不跳版 -->
    <div v-if="loading" aria-hidden="true">
      <div class="role__hero role__hero--plain">
        <div class="ghost role__art" />
        <div class="role__id">
          <div class="ghost" style="height: 32px; width: 70%" />
          <div class="ghost" style="height: 44px" />
          <div class="ghost" style="height: 44px; width: 200px; border-radius: 999px" />
        </div>
      </div>
      <div class="role__body">
        <div class="role__main"><div class="ghost" style="height: 320px; border-radius: 16px" /></div>
        <div class="role__side"><div class="ghost" style="height: 220px; border-radius: 16px" /></div>
      </div>
    </div>
    <p v-else-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-else-if="card">
      <!-- 頂部橫幅：作者的橫式背景圖，下緣淡進頁面底色。沒有橫式圖就把直式圖糊掉當氛圍 -->
      <div v-if="banner" class="role__banner" aria-hidden="true">
        <img :src="banner" alt="" fetchpriority="high" @error="bannerBroken = true" />
      </div>
      <div v-else class="role__ambient" :style="{ backgroundImage: `url(${card.backgroundUrl || card.avatarUrl || ''})` }" aria-hidden="true" />

      <!-- 社群審核影響榜單收錄，詳情連結仍可分享。 -->
      <p v-if="card.status && card.status !== 'approved'" class="notice role__own" role="status">
        {{ $t(`card.own.${card.status}`) }}
      </p>

      <header class="role__hero settle" :class="{ 'role__hero--plain': !banner }" :aria-busy="revalidating || undefined">
        <div class="role__art">
          <img v-if="hasArt" :src="card.avatarUrl!" alt="" fetchpriority="high" @error="broken = true" />
          <div v-else class="role__void" :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }">
            <span>{{ [...shownName][0] }}</span>
          </div>
          <span v-if="card.featured" class="role__featured" :title="$t('card.featuredHint')">{{ $t("card.featured") }}</span>
        </div>

        <div class="role__id">
          <h1 class="role__name display" :class="{ 'role__name--designed': title.designed }" :style="title.designed ? { '--title-em': title.widestEm } : undefined">
            {{ title.text }}
          </h1>
          <div class="role__meta">
            <component :is="card.author.handle ? RouterLink : 'span'" :to="card.author.handle ? lp(`/authors/${card.author.handle}`) : undefined" class="role__by">
              <CommunityAvatar :handle="card.author.handle ?? undefined" :src="card.author.avatar" :name="card.author.name" class="role__by-avatar" />
              <CommunityName :handle="card.author.handle ?? undefined" :name="card.author.name" />
            </component>
            <a v-if="score && score.count" class="role__score" href="#score" @click.prevent="side?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })">
              <span class="role__score-star" aria-hidden="true">★</span>
              <strong>{{ score.average?.toFixed(1) }}</strong>
              <span class="subtle">{{ $t("score.count", { n: score.count }) }}</span>
            </a>
            <span v-if="card.talkNum" class="subtle">{{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</span>
          </div>
          <!-- 一句話簡介；舊卡的簡介常常是一整段，頁首只露出三行，全文在下面的介紹或卡片的說明裡 -->
          <p v-if="card.summary" class="role__tagline" :title="card.summary">{{ card.summary }}</p>

          <!-- 主行動：桌機在這一列；手機固定在畫面最底部（見樣式），不會落到第一屏外 -->
          <div class="role__actions">
            <div class="role__cta">
              <CardPlatforms class="role__platforms" :card-id="card.id" :provider="card.provider" :card-number="card.num" :pending="platformsRequest" />
              <LibraryToggle v-if="listed" kind="favorites" :target="card.id" @count="card.favoriteCount = $event" />
              <ShareMenu :url="shareUrl" :title="card.name" :subject="card.roleId" />
            </div>
          </div>
          <!-- 分級標示緊貼開始對話（遊戲軟體分級管理辦法第 11、12 條：標識與情節名稱放在說明或起始處旁）。
               評級缺失的舊一般卡不標（owner 2026-10-10），作者下次送審時補上 -->
          <div v-if="card.rating" class="role__grade" data-tour="card-grade">
            <RatingMark :rating="card.rating" :descriptors="card.ratingDescriptors ?? []" />
          </div>
          <CardOwnerActions :card="card" @submitted="load" />

          <ul v-if="card.fandom || card.tags.length" class="role__tags">
            <li v-if="card.fandom">
              <RouterLink :to="{ path: lp('/search'), query: { fandom: card.fandomKey ?? card.fandom } }" class="chip role__fandom">{{ $t("card.fandom") }} {{ cardFandom(card, locale) }}</RouterLink>
            </li>
            <li v-for="tag in card.tags" :key="tag">
              <RouterLink :to="{ path: lp('/'), query: { tag } }" class="chip">#{{ tag }}</RouterLink>
            </li>
          </ul>
        </div>
      </header>

      <div class="role__body" :aria-busy="revalidating || undefined">
        <div class="role__main">
          <!-- 介紹：沒有「介紹」標題（看到內容就知道），頂端跟右欄第一塊對齊 -->
          <section v-if="detailsPending && !hasIntro" class="role__intro-wrap" aria-hidden="true">
            <div class="ghost role__intro-ghost" />
          </section>
          <section v-else-if="hasIntro" class="role__intro-wrap" aria-labelledby="intro-h" data-tour="card-intro">
            <h2 id="intro-h" class="sr-only">{{ $t("card.about") }}</h2>
            <div ref="introBox" class="role__intro panel" :class="{ 'role__intro--clamped': introLong && !introOpen }" :style="{ '--intro-max': `${INTRO_MAX}px` }">
              <ReadmeView v-if="readmeHtml" :html="readmeHtml" />
              <p v-else class="role__text">{{ card.summary }}</p>
              <div v-if="introLong && !introOpen" class="role__intro-fade">
                <button type="button" class="btn" @click="introOpen = true">{{ $t("card.aboutMore") }}</button>
              </div>
            </div>
          </section>

          <!-- 評論：接在介紹下面；作者關掉評論、或卡還沒上榜就不放 -->
          <section v-if="showComments && listed" id="comments" class="role__comments-wrap" aria-labelledby="comments-h">
            <h2 id="comments-h" class="role__h2">{{ $t("card.tab.comments") }}<span v-if="commentCount" class="role__h2-n">{{ commentCount }}</span></h2>
            <div class="panel role__comments">
              <CommentPanel v-if="confirmed || card.rating !== 'R'" :key="card.id" :card-id="card.id" :role-id="card.roleId" :my-score="score?.mine ?? null" @count="commentCount = $event" />
            </div>
          </section>
        </div>

        <aside ref="side" class="role__side">
          <CardScore v-if="listed && score" id="score" class="role__score-box" :score="score" :own="own" :busy="scoreBusy" @rate="rate" @write="writeReview" />

          <section class="panel role__info" :aria-label="$t('card.info')">
            <dl class="role__stats">
              <div class="stat"><dt>{{ $t("card.stat.talk") }}</dt><dd>{{ compact(card.talkNum) }}</dd></div>
              <div class="stat"><dt>{{ $t("card.stat.follow") }}</dt><dd>{{ compact(card.favoriteCount ?? 0) }}</dd></div>
              <div class="stat"><dt>{{ $t("card.stat.trending") }}</dt><dd :class="{ up: card.trending > 0 }">{{ card.trending > 0 ? `+${compact(card.trending)}` : "—" }}</dd></div>
            </dl>
            <dl class="role__kv">
              <template v-if="card.num">
                <dt>{{ $t("card.id") }}</dt>
                <dd>
                  <button type="button" class="role__cid" :title="$t('card.copyId')" @click="copyId">
                    <code class="mono">#{{ card.num }}</code>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4" /><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" fill="none" stroke="currentColor" stroke-width="1.4" /></svg>
                  </button>
                </dd>
              </template>
              <dt>{{ $t("card.language") }}</dt><dd>{{ zoneLabel(card.zone) }}</dd>
              <template v-if="editedAt">
                <dt>{{ $t("card.contentUpdated") }}</dt><dd :title="dateTime(editedAt)">{{ dateOnly(Math.floor(editedAt / 1000)) }}</dd>
              </template>
            </dl>
            <div class="role__links">
              <RouterLink :to="lp(`/me?reportCard=${encodeURIComponent(String(card.num || card.id))}`)">{{ $t("community.reportCard") }}</RouterLink>
              <!-- 加到主畫面：能裝網頁的瀏覽器才出現；成人卡要過了門（有鑰匙）才有 -->
              <button v-if="installable && (card.rating !== 'R' || card.shortcutKey)" type="button" @click="addToHome">{{ $t("card.addHome") }}</button>
            </div>
          </section>

          <section v-if="more.length" class="panel role__more" aria-labelledby="more-h">
            <h2 id="more-h" class="role__more-title">
              <span>{{ $t("card.moreBy", { name: card.author.name }) }}</span>
              <RouterLink v-if="card.author.handle" :to="lp(`/authors/${card.author.handle}`)">{{ $t("card.moreAll") }}</RouterLink>
            </h2>
            <RouterLink v-for="m in more" :key="m.id" :to="lp(`/cards/${m.num ?? m.id}`)" class="role__mini">
              <img v-if="m.avatarUrl" :src="m.avatarUrl" alt="" loading="lazy" />
              <span v-else class="role__mini-void" :style="{ background: `hsl(${hueFrom(m.name)} 40% 62%)` }" />
              <span class="role__mini-text">
                <strong>{{ displayName(m.name, locale) }}</strong>
                <span class="subtle">{{ m.summary }}</span>
              </span>
            </RouterLink>
          </section>
        </aside>
      </div>
    </template>

    <!-- live region 要先存在再改內容，讀屏器才會唸；所以常駐、用 hidden 切 -->
    <div class="toast" role="status" :hidden="!copied">{{ copied ? $t("card.idCopied") : "" }}</div>
  </div>
</template>

<style scoped>
.role { position: relative; }

.role__ambient {
  position: absolute; inset: 0 -50vw auto -50vw; height: 50vh; z-index: 0;
  background-size: cover; background-position: center 30%;
  opacity: 0.28; filter: blur(64px) saturate(1.2);
  mask-image: linear-gradient(to bottom, #000 20%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, #000 20%, transparent);
  pointer-events: none;
}

/* 橫幅滿版：上半保留原圖色彩（日間也不刷白），下緣才淡進頁面底色；文字一律排在橫幅之後，只有封面壓在圖上 */
.role__banner {
  --banner-h: 320px;
  position: absolute; z-index: 0; top: calc(-1 * var(--s-5)); left: 50%; width: 100vw; height: var(--banner-h);
  transform: translateX(-50%); overflow: hidden; pointer-events: none;
}
.role__banner img { width: 100%; height: 100%; object-fit: cover; object-position: center 20%; }
.role__banner::after {
  content: ""; position: absolute; inset: 0;
  background: linear-gradient(to bottom, transparent 0%, transparent 45%, color-mix(in srgb, var(--bg) 70%, transparent) 75%, var(--bg) 97%);
}

.role__own { position: relative; z-index: 1; margin-bottom: var(--s-4); }

/* ── 身分列 ── */
/* 疊在下半部之上：手機的「開始對話」固定在畫面底部，是身分列裡的元素，要蓋得過捲上來的評論 */
.role__hero {
  position: relative; z-index: 2;
  display: grid; grid-template-columns: 240px minmax(0, 1fr); gap: var(--s-6); align-items: start;
  margin-top: 170px;
}
.role__hero > .role__id { padding-top: 106px; }
.role__hero--plain { margin-top: 0; }
.role__hero--plain > .role__id { padding-top: var(--s-2); }

.role__art { position: relative; aspect-ratio: 3 / 4; border-radius: var(--r-lg); overflow: hidden; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); }
.role__art img { width: 100%; height: 100%; object-fit: cover; }
.role__featured {
  position: absolute; left: 8px; top: 8px; max-width: calc(100% - 16px);
  display: inline-flex; align-items: center; height: 20px; padding: 0 7px;
  border-radius: 4px; background: var(--accent); color: #fff;
  font-size: 11px; font-weight: 700; letter-spacing: 0.02em; line-height: 1;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
}
.role__void { display: grid; place-items: center; height: 100%; }
.role__void span { font-size: 80px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }

.role__id { display: grid; gap: var(--s-3); min-width: 0; overflow-wrap: anywhere; container-type: inline-size; align-content: start; }
/* 名字與榜單卡片同一套規則（見 title-layout.ts）：留作者的換行、先在空格換行 */
.role__name { font-size: 30px; line-height: 1.25; white-space: pre-line; overflow-wrap: break-word; text-wrap: balance; }
.role__name--designed { word-break: keep-all; font-size: clamp(18px, 100cqi / var(--title-em, 1), 30px); }
.role__meta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2) var(--s-4); font-size: 13.5px; }
.role__by { display: inline-flex; align-items: center; gap: 8px; min-width: 0; font-weight: 600; color: var(--text); }
a.role__by:hover { color: var(--accent-text); }
.role__by :deep(img), .role__by :deep(.role__by-avatar) { width: 24px; height: 24px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 11px; }
.role__score { display: inline-flex; align-items: center; gap: 5px; color: var(--text); }
.role__score-star { color: var(--gold); }
.role__tagline {
  margin: 0; max-width: 62ch; font-size: 16px; line-height: 1.65; color: var(--text-2); white-space: pre-line;
  display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden;
}

.role__actions { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.role__cta { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.role__platforms { width: auto; min-width: 200px; }
.role__platforms :deep(.btn--primary) { min-width: 200px; }
.role__grade { display: flex; }
.role__tags { display: flex; flex-wrap: wrap; gap: 6px; margin: 0; padding: 0; list-style: none; }
.role__fandom { color: var(--text); box-shadow: inset 0 0 0 1px var(--line-strong); background: transparent; }

/* ── 下半：左欄介紹＋評論，右欄黏住 ── */
.role__body {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: var(--s-6); align-items: start;
  margin-top: var(--s-6);
}
.role__main { display: grid; gap: var(--s-6); min-width: 0; align-content: start; }
.role__side {
  display: grid; gap: var(--s-4); min-width: 0;
  position: sticky;
  top: min(calc(var(--header-h) + var(--s-4)), calc(100vh - var(--side-h, 0px) - var(--s-4)));
  top: min(calc(var(--header-h) + var(--s-4)), calc(100dvh - var(--side-h, 0px) - var(--s-4)));
}

.role__intro { position: relative; padding: var(--s-5) var(--s-6); overflow: hidden; }
.role__intro--clamped { max-height: var(--intro-max); }
.role__intro-fade {
  position: absolute; left: 0; right: 0; bottom: 0; height: 160px;
  display: flex; align-items: flex-end; justify-content: center; padding-bottom: var(--s-4);
  background: linear-gradient(to bottom, transparent, var(--surface) 70%);
}
.role__intro-ghost { height: 280px; border-radius: var(--r-lg); }
.role__text { margin: 0; max-width: 68ch; font-size: 15px; line-height: 1.8; white-space: pre-wrap; }


.role__h2 { display: flex; align-items: baseline; gap: 8px; margin: 0 0 var(--s-3); font-size: 18px; }
.role__h2-n { font-size: 13px; font-weight: 400; color: var(--text-3); font-variant-numeric: tabular-nums; }
.role__comments { padding: var(--s-5); }
#comments { scroll-margin-top: calc(var(--header-h) + var(--s-4)); }

.role__info { display: grid; gap: var(--s-3); padding: var(--s-4); }
.role__stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--s-2); margin: 0; padding-bottom: var(--s-3); box-shadow: 0 1px 0 var(--line); text-align: center; }
.role__stats .stat dd { font-size: 17px; }
.role__stats .stat dd.up { color: var(--accent-text); }
.role__kv { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 8px var(--s-4); margin: 0; font-size: 13.5px; }
.role__kv dt { color: var(--text-3); }
.role__kv dd { margin: 0; text-align: right; overflow-wrap: anywhere; }
.role__cid { display: inline-flex; align-items: center; gap: 6px; padding: 0; border: 0; background: none; color: var(--text); font: inherit; cursor: pointer; }
.role__cid code { font-size: 12.5px; }
.role__cid svg { width: 14px; height: 14px; color: var(--text-3); }
.role__cid:hover svg { color: var(--accent-text); }
.role__links { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); padding-top: var(--s-3); box-shadow: 0 -1px 0 var(--line); font-size: 13px; }
.role__links a, .role__links button { padding: 0; border: 0; background: none; font: inherit; color: var(--text-2); cursor: pointer; }
.role__links a:hover, .role__links button:hover { color: var(--accent-text); }

.role__more { display: grid; gap: 2px; padding: var(--s-4) var(--s-3); }
.role__more-title { display: flex; justify-content: space-between; align-items: baseline; gap: var(--s-2); margin: 0 var(--s-1) var(--s-2); font-size: 13px; font-weight: 600; color: var(--text-2); }
.role__more-title span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role__more-title a { flex: none; font-size: 12.5px; color: var(--accent-text); }
.role__mini { display: grid; grid-template-columns: 44px minmax(0, 1fr); gap: var(--s-3); align-items: center; padding: 6px; border-radius: var(--r-md); color: var(--text); transition: background var(--dur) var(--ease); }
.role__mini:hover { background: var(--surface-2); }
.role__mini img, .role__mini-void { width: 44px; aspect-ratio: 3 / 4; border-radius: var(--r-sm); object-fit: cover; }
.role__mini-text { display: grid; min-width: 0; }
.role__mini-text strong, .role__mini-text span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.role__mini-text strong { font-size: 13.5px; }
.role__mini-text span { font-size: 12px; }

/* ── 手機：單欄，介紹 → 評分 → 評論 → 卡片資訊 → 其他作品；開始對話固定在畫面最底部 ── */
@media (max-width: 820px) {
  .role { padding-bottom: calc(var(--s-8) + 72px); }
  .role__banner { --banner-h: 230px; top: calc(-1 * var(--s-4)); }
  .role__hero {
    grid-template-columns: 104px minmax(0, 1fr); column-gap: var(--s-4); row-gap: var(--s-3);
    grid-template-areas: "art name" "meta meta" "tagline tagline" "grade grade" "owner owner" "tags tags";
    align-items: end; margin-top: 120px;
  }
  .role__hero--plain { margin-top: 0; }
  .role__hero > .role__id { display: contents; }
  .role__art { grid-area: art; }
  .role__name { grid-area: name; font-size: 21px; align-self: end; }
  .role__name--designed { font-size: clamp(15px, 100cqi / var(--title-em, 1), 21px); }
  .role__meta { grid-area: meta; }
  .role__tagline { grid-area: tagline; font-size: 15px; }
  /* 動作列整條搬到畫面底部（收藏、分享、開始對話），身分列裡不留一行空的 */
  .role__actions { display: contents; }
  .role__grade { grid-area: grade; }
  .role__hero :deep(.card-owner-actions) { grid-area: owner; }
  .role__tags { grid-area: tags; }
  .role__cta {
    position: fixed; z-index: 15; left: 0; right: 0; bottom: 0;
    flex-wrap: nowrap; padding: 12px var(--s-4) calc(12px + env(safe-area-inset-bottom, 0px));
    background: color-mix(in srgb, var(--bg) 84%, transparent);
    backdrop-filter: blur(16px) saturate(1.2); -webkit-backdrop-filter: blur(16px) saturate(1.2);
    box-shadow: 0 -1px 0 var(--line);
  }
  .role__cta > .role__platforms { order: 2; flex: 1; min-width: 0; }
  .role__cta > .role__platforms :deep(.btn--primary) { width: 100%; min-width: 0; }
  .role__cta > .library-toggle { order: 1; flex: none; }
  .role__cta > .sh { order: 1; }

  .role__body { grid-template-columns: minmax(0, 1fr); grid-template-areas: "intro" "score" "comments" "info" "more"; gap: var(--s-5); margin-top: var(--s-5); }
  .role__main, .role__side { display: contents; }
  .role__intro-wrap { grid-area: intro; }
  .role__score-box { grid-area: score; }
  .role__comments-wrap { grid-area: comments; }
  .role__info { grid-area: info; }
  .role__more { grid-area: more; }
  .role__intro { padding: var(--s-4); }
  .role__comments { padding: var(--s-4); }
}
@media (max-width: 400px) {
  .role__hero { grid-template-columns: 92px minmax(0, 1fr); }
}
</style>

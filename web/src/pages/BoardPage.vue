<script setup lang="ts">
import { computed, defineAsyncComponent, inject, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
const HomeSidebar = defineAsyncComponent(() => import("@/components/HomeSidebar.vue"));
import { boardEndKey, boardListEndKey } from "@/lib/site-links";
import BoardCarousel from "@/components/BoardCarousel.vue";
import DownloadBanner from "@/components/DownloadBanner.vue";
import MascotWelcome from "@/components/MascotWelcome.vue";
import MascotHome from "@/components/MascotHome.vue";
import { useMascotWelcome } from "@/lib/mascot-home";
import { tourState } from "@/lib/coach-tour";
import { starterFor } from "@/lib/onboarding";
import type { CommunityCard } from "@/lib/types";
import FollowFeed from "@/components/FollowFeed.vue";
import CardGrid from "@/components/CardGrid.vue";
import { fetchBoard, fetchCard, fetchTagCounts } from "@/lib/api";
import { recallStream, rememberStream, prepareBoardScroll } from "@/lib/board-memory";
import { createBoardStream } from "@/lib/board-stream";
import { takeInlineBoard } from "@/lib/board-inline";
import { rememberCards } from "@/lib/card-memory";
import { contentLang, defaultZone } from "@/lib/i18n";
import DiscoveryTags from "@/components/DiscoveryTags.vue";
import NewcomerStrip from "@/components/checkin/NewcomerStrip.vue";
import NewcomerNudge from "@/components/checkin/NewcomerNudge.vue";
import { selectedTags } from "@/lib/discovery";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { currentStep } from "@/lib/newcomer-tour";
import { guestAdult, viewerAdult } from "@/lib/adult-consent";
import type { CardPage, Sort } from "@/lib/types";
import { petEnabled } from "@/pet/enabled";
import UpdateStrip from "@/components/UpdateStrip.vue";
import { RATINGS, RATING_NAMES, type Rating } from "../../../shared/content-rating";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const session = useSession();

/** 入門卡只在首頁引導期間插入資訊流；開關變更時只採用最後一次請求。 */
const starterCard = ref<CommunityCard | null>(null);
let starterRequest = 0;
watch(() => (tourState.step === "r18" || tourState.step === "card" || tourState.step === "choose") ? `${starterFor(locale.value, !!viewerAdult(session)?.showNsfw) ?? ""}:${contentLang(locale.value)}` : null, (key) => {
  const request = ++starterRequest;
  starterCard.value = null;
  const [num, lang] = key?.split(":") ?? [];
  if (!num) return;
  void fetchCard(num, lang, { quiet: true }).then((card) => { if (request === starterRequest) starterCard.value = card; }, () => { if (request === starterRequest) starterCard.value = null; });
}, { immediate: true });
const { t } = useI18n();

const stream = createBoardStream(fetchBoard, canLoad);
const feed = stream.state;
const boardEnded = inject(boardEndKey, ref(false));
const boardListEnd = inject(boardListEndKey, ref(false));
watch(() => feed.done && !feed.loading && !feed.error && [feed.first, feed.week, feed.month, feed.hot].some(part => !!part?.items.length), allowed => { boardListEnd.value = allowed; }, { immediate: true });
watch(() => feed.done, done => { boardEnded.value = done; }, { immediate: true });
const page = computed(() => feed.first);
const more = computed(() => [feed.week, feed.month, feed.hot].flatMap(part => part?.items ?? []));
const continuations = computed(() => {
  if (!feed.dayEnded) return [];
  const order: Array<"week" | "month" | "hot"> = defaultFeed.value ? ["week", "month", "hot"] : ["hot"];
  const current = order.indexOf(feed.phase as "week" | "month" | "hot");
  return order.slice(0, current + 1).map((sort, index) => {
    const previous = index ? order[index - 1]! : "day";
    const previousPage = previous === "day" ? feed.first : feed[previous];
    return { sort, endKey: `home.${previous === "day" ? "daily" : previous}${previousPage?.items.length ? "End" : "Empty"}`, items: feed[sort]?.items ?? [] };
  });
});
const loading = computed(() => feed.loading);
const SORTS: Sort[] = ["day", "hot", "score", "favorites", "week", "month", "new", "updated", "random"];
const restoring = ref(false);
const wide = ref(window.innerWidth >= 1080);
const sentinel = ref<HTMLElement | null>(null);
let mounted = false;
function canLoad() {
  return !mounted || (document.visibilityState !== "hidden" && ![...document.querySelectorAll<HTMLElement>('[data-discovery-overlay], [role="menu"], [role="dialog"], dialog[open]')].some(el => el.getClientRects().length > 0));
}
/** 角色卡探索或關注動態；相容舊作者榜連結。 */
const mode = computed(() => ["following", "authors"].includes(String(route.query.mode)) ? "following" : "cards");
const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return typeof s === "string" && (SORTS as string[]).includes(s) ? (s as Sort) : "day";
});
const tags = computed(() => selectedTags(route.query.tag));
/**
 * 分級「最高到這一級」（?rating=）。選單沒有限制級：那一級由頁首的成人內容開關管。
 * 沒標分級的舊卡只知道不是限制級，伺服器只把它們算進「輔15級以下」。
 */
const MENU_RATINGS = RATINGS.filter((r) => r !== "R");
const maxRating = computed<Rating | undefined>(() => (MENU_RATINGS as readonly string[]).includes(String(route.query.rating)) ? route.query.rating as Rating : undefined);
const offset = computed(() => Number(route.query.offset ?? 0) || 0);
/** Only an untouched landing feed expands the four ranking windows. Explicit tabs keep their current behavior. */
const defaultFeed = computed(() => route.query.sort === undefined && !tags.value.length && !maxRating.value && offset.value === 0);
/** 不想看的類型（設定頁勾的）：類型列少畫那幾顆，排尾一顆「已隱藏 N 類」帶去設定頁；清單本身由伺服器過濾。 */
const hidden = computed(() => session.profile?.hiddenTags ?? []);


/**
 * 語區跟著介面語言走，不另設開關：看日文介面的人要的就是日文卡。
 * 想看別的語言的卡，換介面語言即可——頁首那個選單同時就是語區選單。
 */
const zone = computed(() => defaultZone(locale.value));

let loadId = 0;
/** 身分在第一次讀榜還在路上時才到：等那一份回來再看它是不是照帳號開關讀的 */
let recheckAfterLoad = false;

/**
 * 這一份榜單是不是已經照看的人的開關讀好了。伺服器用 cookie 判斷時會在回應上標明；
 * 舊伺服器沒標，退回原本的規則（開關開著才需要重讀）。
 */
function servedFor(p: CardPage | null, showNsfw: boolean | undefined): boolean {
  if (!p) return false;
  return p.adult === undefined ? !showNsfw : p.adult === !!showNsfw;
}

/** 身份與內容設定分開記；推薦只在同一 history entry 的卡片返回時復原。 */
function memoryKey(query: Record<string, unknown>): string | null {
  // 知道是誰了（登入的人資料到了，或確定是訪客）才記
  if (session.me ? !session.profile : !session.ready) return null;
  const position = query.sort === "random" ? router.options.history.state.position : null;
  if (query.sort === "random" && typeof position !== "number") return null;
  // 遊客的開關在遊客憑證上（頁首 R18 遊客也能開），一樣算進鍵裡
  const p = session.me ? session.profile : viewerAdult(session);
  return JSON.stringify([query, defaultFeed.value, position, session.me?.accountNumId ?? null, p?.showNsfw ?? null, p?.ageVerified ?? null, p?.adultConsent ?? null, hidden.value]);
}

const currentQuery = () => ({ zone: zone.value, tag: tags.value, sort: sort.value, offset: offset.value,...(typeof route.query.cursor==='string'?{cursor:route.query.cursor}:{}), lang: contentLang(locale.value), rating: maxRating.value });

/** 身分到了、確認畫面上這份就是給他的：現在才知道該記在誰的名下 */
function adoptShown() {
  const key = memoryKey(currentQuery());
  if (key && page.value) { shownKey = key; rememberStream(key, { stream: stream.snapshot() }); }
}

let shownKey: string | null = null;
async function loadMore() {
  const id = loadId;
  await stream.next();
  if (id !== loadId) return;
  if (recheckAfterLoad && session.profile && page.value) {
    recheckAfterLoad = false;
    if (!servedFor(page.value, session.profile.showNsfw)) { void load(); return; }
  }
  adoptShown();
  await nextTick();
  scheduleCheck();
}
async function load() {
  ++loadId;
  stream.reset(currentQuery(), defaultFeed.value);
  shownKey = null;
  restoring.value = false;
  prepareBoardScroll(null);
  if (mode.value !== "cards") return;
  const query = currentQuery();
  const key = memoryKey(query);
  const remembered = key ? recallStream(key) : null;
  if (remembered) {
    restoring.value = true;
    stream.restore(query, remembered.stream, defaultFeed.value);
    shownKey = key;
    prepareBoardScroll(remembered.scroll);
    return;
  }
  const landing = route.query.sort === undefined && !tags.value.length && !maxRating.value && offset.value === 0;
  const inline = landing ? takeInlineBoard(query) : null;
  if (inline) {
    rememberCards(inline.items);
    stream.seed(inline);
    adoptShown();
    if (!feed.dayEnded) return;
  }
  await loadMore();
}

// Both IntersectionObserver and scroll/resize check the tail: an appended batch may
// leave the sentinel intersecting, which does not produce another observer transition.
let observer: IntersectionObserver | undefined;
let frame = 0;
function checkTail() {
  frame = 0;
  if (!mounted || mode.value !== "cards" || feed.loading || feed.done || feed.error || !canLoad()) return;
  if (sentinel.value && sentinel.value.getBoundingClientRect().top < window.innerHeight + 400) void loadMore();
}
function scheduleCheck() {
  wide.value = window.innerWidth >= 1080;
  if (mounted && !frame) frame = requestAnimationFrame(checkTail);
}
onMounted(() => {
  mounted = true;
  if (typeof IntersectionObserver !== "undefined") {
    observer = new IntersectionObserver(scheduleCheck, { rootMargin: "400px" });
    if (sentinel.value) observer.observe(sentinel.value);
  }
  window.addEventListener("scroll", scheduleCheck, { passive: true });
  window.addEventListener("resize", scheduleCheck);
  document.addEventListener("visibilitychange", scheduleCheck);
  document.addEventListener("click", scheduleCheck);
  document.addEventListener("keydown", scheduleCheck);
  scheduleCheck();
});
onBeforeRouteLeave(() => {
  if (shownKey && page.value) {
    const anchor = [...document.querySelectorAll<HTMLElement>('[data-board-list] .card__link')].find(el => el.getBoundingClientRect().bottom > 100);
    rememberStream(shownKey, { stream: stream.snapshot(), scroll: { top: window.scrollY, anchor: anchor?.getAttribute('href') ?? undefined, delta: anchor?.getBoundingClientRect().top } });
  }
});
onBeforeUnmount(() => {
  mounted = false;
  ++loadId;
  stream.invalidate();
  observer?.disconnect();
  cancelAnimationFrame(frame);
  window.removeEventListener("scroll", scheduleCheck);
  window.removeEventListener("resize", scheduleCheck);
  document.removeEventListener("visibilitychange", scheduleCheck);
  document.removeEventListener("click", scheduleCheck);
  document.removeEventListener("keydown", scheduleCheck);
});
/** 狀態放進網址：篩選結果可以直接分享，上一頁也回得去。 */
function navigate(patch: Record<string, string | string[] | undefined>) {
  const query: Record<string, string | string[]> = { ...(route.query as Record<string, string | string[]>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete query[k];
    else query[k] = v;
  }
  if (!("offset" in patch)) {delete query.offset;delete query.cursor;}
  router.push({ query });
}
/** 換榜的時候排序鍵不通用，一起清掉。 */
const switchMode = (m: "following") => navigate({ mode: m, sort: undefined, tag: undefined });

/** 已登入的人頂端放蘇綺面板；新訪客的歡迎橫幅還在時先放橫幅，一次只放一塊。翻到後面幾頁不放。 */
const welcome = useMascotWelcome();
const showHome = computed(() => !!session.me && session.ready && !welcome.visible.value && offset.value === 0);
/** 輪播的第一張就是頂端這塊蘇綺；兩塊都不在時輪播只放活動 */
const hasHero = computed(() => welcome.visible.value || showHome.value);
const tourHero = computed(() => currentStep()?.target === '[data-tour="home-roll"]');
const sortsEl = ref<HTMLElement | null>(null);
/**
 * 面板上的「找新卡」：不在面板裡列卡，切到日榜（上榜 24 小時內）、捲到榜單那一列。
 * 換分頁時路由會先捲回頂端，等它捲完下一個畫格再捲下來。
 */
async function toNewCards() {
  if (mode.value !== "cards" || sort.value !== "day") await router.push({ query: { ...route.query, mode: undefined, sort: "day", offset: undefined, cursor: undefined } });
  await nextTick();
  requestAnimationFrame(() => sortsEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

function reloadViewer() {
  if (route.query.cursor !== undefined || offset.value) navigate({});
  else void load();
}
watch(() => route.query, load, { immediate: true });
watch(locale, reloadViewer);
// 開關改了要重讀。身分第一次載好（undefined → 值）時，第一屏多半已經照帳號開關讀好了
// （伺服器用 cookie 判斷並標明），對得上就不再讀一次；那一份還在路上就等它回來再比。
watch(() => session.profile?.showNsfw, (now, before) => {
  if (now === before) return;
  if (before === undefined) {
    if (loading.value) { recheckAfterLoad = true; return; }
    if (servedFor(page.value, now)) { adoptShown(); return; }
  }
  reloadViewer();
});
// 遊客在頁首開關 R18：伺服器換了遊客憑證，重讀。第一次問到現況（loaded 由 false 變 true）不算改。
watch(() => (!session.me && guestAdult.loaded ? guestAdult.showNsfw : null), (now, before) => {
  if (now !== null && before !== null && now !== before) reloadViewer();
});
watch(() => session.me?.accountNumId, (now, before) => { if (now !== before && (before !== undefined || session.ready)) reloadViewer(); });
watch(() => session.profile?.ageVerified, (now, before) => { if (before !== undefined && now !== before) reloadViewer(); });
watch(() => session.profile?.adultConsent, (now, before) => { if (before !== undefined && now !== before) reloadViewer(); });
watch(() => session.ready, ready => { if (ready && servedFor(page.value, viewerAdult(session)?.showNsfw)) adoptShown(); });
// 不想看的類型載好或改了（設定頁改完回來）：同樣重讀
watch(() => hidden.value.join(","), (now, before) => { if (now !== before && (now !== "" || before !== undefined)) reloadViewer(); });

/**
 * 類型列每顆籤後面的張數。跟排序、翻頁無關，只看語區、選了什麼、看的人的開關；讀不到就不標（籤照常能點）。
 * 開關的依據跟榜單一樣：登入的人看帳號、遊客看遊客憑證。
 */
const tagCounts = ref<Record<string, number> | null>(null);
const ratingCounts = ref<Record<string, number> | null>(null);
let countsId = 0;
watch(() => mode.value === "cards" ? JSON.stringify([zone.value, tags.value, maxRating.value, hidden.value, (session.me ? session.profile : viewerAdult(session))?.showNsfw ?? null]) : null, (now) => {
  if (!now) return;
  const id = ++countsId;
  void fetchTagCounts({ zone: zone.value, tag: tags.value, rating: maxRating.value }).then((got) => {
    if (id !== countsId) return;
    tagCounts.value = got.counts;
    ratingCounts.value = got.ratings;
  }, () => { if (id === countsId) { tagCounts.value = null; ratingCounts.value = null; } });
}, { immediate: true });
/** 分級選單：數字是累計的（最高到這一級共有幾張），輔15級以下再加上沒標分級的 */
const ratingOptions = computed(() => {
  let sum = 0;
  return MENU_RATINGS.map((r) => {
    sum += ratingCounts.value?.[r] ?? 0;
    const n = ratingCounts.value ? sum + (r === "PG15" ? ratingCounts.value.none ?? 0 : 0) : null;
    const name = RATING_NAMES[r][locale.value as keyof typeof RATING_NAMES[typeof r]] ?? RATING_NAMES[r]["zh-Hant"];
    return { value: r, n, label: r === "G" ? name : t("board.rating.upTo", { level: name }) };
  });
});
</script>

<template>
  <div class="page board-page" :class="{ 'board-page--pet-enabled': petEnabled }">
    <h1 class="sr-only">{{ $t("site.tagline") }}</h1>
    <!-- 頂端輪播：第一張是蘇綺，後面接推薦到首頁的活動（翻到後面幾頁不放活動，同蘇綺面板）；沒有活動就只有蘇綺，跟以前一樣 -->
    <!-- 新手七日：常駐卡在最頂端（不是榜單裡、不是第五個選項）；每天第一次進來桌寵另外彈一張提示 -->
    <div class="board-hero">
    <NewcomerStrip v-if="offset === 0" />
    <NewcomerNudge v-if="offset === 0" />
    <BoardCarousel :hero="hasHero" :campaigns="offset === 0" :tour-hero="tourHero">
      <MascotWelcome />
      <MascotHome v-if="showHome" @discover="toNewCards" />
    </BoardCarousel>
    </div>
    <DownloadBanner />
    <UpdateStrip />

    <!--
      一列解決「看哪個榜」與「怎麼排」：六個排序在左，最右一顆「關注」是另一個榜（關注作者的新卡），
      不是排法——選中它時六個排序全部不亮。原本的分段控制與 R18 開關各佔一列，手機上第一屏只剩兩張卡（成員意見，owner 2026-10-02）；
      R18 開關搬進頁首（App.vue）。
    -->
    <div class="board-layout"><div class="board-main" :class="{ 'board-main--restored': restoring }">
    <div ref="sortsEl" class="sorts" role="group" :aria-label="$t('board.sorts')">
      <button v-for="s in SORTS" :key="s" class="sorts__item" :class="{ 'sorts__item--on': mode === 'cards' && sort === s }" :aria-pressed="mode === 'cards' && sort === s" @click="navigate({ mode: undefined, sort: s })">
        {{ $t(`board.sort.${s}`) }}
      </button>
      <button class="sorts__item sorts__mode" :class="{ 'sorts__item--on': mode === 'following' }" :aria-pressed="mode === 'following'" @click="switchMode('following')">{{ $t("board.mode.following") }}</button>
    </div>

    <!-- 類型列：固定的一排（照魅魔島），鍵進網址、名字跟介面語言走。寬螢幕摺成幾行全部看得到；窄螢幕收成兩行，點開才全展 -->
    <DiscoveryTags v-if="mode === 'cards'" :selected="tags" :hidden="hidden" :counts="tagCounts" browse @change="navigate({ tag: $event.length ? $event : undefined })" />


    <template v-if="mode === 'cards'">
      <div class="count-row">
        <p class="subtle count">{{ sort !== 'day' && page && page.total !== null ? $t("board.count", { n: page.total }) : "" }}</p>
        <label class="rating-filter">
          <span class="sr-only">{{ $t("board.rating.label") }}</span>
          <select :value="maxRating ?? ''" @change="navigate({ rating: ($event.target as HTMLSelectElement).value || undefined })">
            <option value="">{{ $t("board.rating.all") }}</option>
            <option v-for="o in ratingOptions" :key="o.value" :value="o.value" :disabled="o.n === 0 && maxRating !== o.value">{{ o.label }}{{ o.n === null ? "" : ` (${o.n})` }}</option>
          </select>
        </label>
      </div>
      <CardGrid
        v-if="page?.items.length || starterCard || (loading && !page)"
        data-board-list
        :cards="page?.items ?? []"
        :starter="offset === 0 ? starterCard : null"
        :loading="loading && !page"
        :busy="false"
        :ranked="!tags.length"
        :rank-offset="page?.offset ?? 0"
        :empty-title="$t(tags.length ? 'board.empty.search.title' : 'board.empty.title')"
        :empty-hint="$t(tags.length ? 'board.empty.search.hint' : 'board.empty.hint')"
      />
      <section v-for="part in continuations" :key="part.sort" class="more" data-board-more :data-board-segment="part.sort">
        <p class="subtle">{{ $t(part.endKey) }}</p>
        <h2 class="more__title">{{ $t(`board.sort.${part.sort}`) }}</h2>
        <CardGrid v-if="part.items.length" data-board-list :cards="part.items" />
      </section>
      <div ref="sentinel" class="stream-tail" data-board-tail>
        <div v-if="feed.error" class="notice notice--error" role="alert">
          <p>{{ $t((page?.items.length || more.length) ? 'home.appendError' : 'home.firstError') }}</p>
          <button class="btn" @click="loadMore">{{ $t('home.retry') }}</button>
        </div>
        <template v-else-if="loading">
          <p class="sr-only" role="status">{{ $t('home.loading') }}</p>
          <div v-if="page" class="tail-skeleton" aria-hidden="true"><div v-for="i in 8" :key="i" class="ghost" /></div>
        </template>
        <div v-else-if="feed.done" class="stream-end" role="status">
          <template v-if="!page?.items.length && !more.length">
            <p>{{ $t(tags.length || maxRating ? 'home.empty' : 'board.empty.title') }}</p>
            <p v-if="!tags.length && !maxRating" class="muted">{{ $t('board.empty.hint') }}</p>
            <button v-if="tags.length || maxRating" class="btn" @click="navigate({ tag: undefined, rating: undefined })">{{ $t('home.clear') }}</button>
          </template>
          <p>{{ $t('home.end') }}</p>
          <button class="btn btn--ghost" @click="sortsEl?.scrollIntoView({ behavior: 'smooth', block: 'start' })">{{ $t('home.top') }}</button>
        </div>
      </div>
    </template>

    <FollowFeed v-else />
    </div><HomeSidebar v-if="wide" class="board-sidebar" /></div>
  </div>
</template>

<style scoped>
.board-hero { --hero-gutter: var(--s-5); width: min(calc(100vw - 2 * var(--hero-gutter)), calc(var(--page) - 2 * var(--hero-gutter))); position: relative; left: 50%; transform: translateX(-50%); }
@media(max-width:640px) { .board-hero { --hero-gutter: var(--s-4); } }
.board-page { max-width: 2400px; width: calc(100% - 2 * clamp(16px, 2.5vw, 64px)); padding-inline: 0; --board-columns: 2; }
.board-page :deep(.grid), .board-page .tail-skeleton { grid-template-columns: repeat(var(--board-columns), minmax(0, 1fr)); }
@media(min-width:600px) { .board-page { --board-columns: 3; } }
@media(min-width:820px) { .board-page { --board-columns: 4; } }
@media(min-width:1440px) { .board-page { --board-columns: 5; } }
@media(min-width:1920px) { .board-page { --board-columns: 6; } .board-page .board-layout { grid-template-columns: minmax(0,1fr) 288px; } }
@media(min-width:2400px) { .board-page { --board-columns: 8; } }
/* 排序做成細字頁籤；最右那顆「關注」字重重一點、推到最右，跟排序拉開：一個是「看哪個榜」，一個是「怎麼排」。擠不下就換行，不裁字 */
.board-main { min-width: 0; }
/* Already-read cards restore in place; entrance transforms would move the scroll anchor. */
.board-main--restored :deep(.settle) { animation: none; }
.board-sidebar { display: none; }
@media(min-width:1080px) { .board-layout { display: grid; grid-template-columns: minmax(0,1fr) 264px; gap: var(--s-5); align-items: start; } .board-sidebar { display: grid; } }
.sorts { display: flex; flex-wrap: wrap; align-items: center; gap: 2px; margin-bottom: var(--s-3); scroll-margin-top: 76px; }
.sorts__item {
  height: var(--h-sm); padding: 0 10px; border: 0; border-radius: var(--r-pill);
  background: transparent; font-size: 13px; font-weight: 500; color: var(--text-3); cursor: pointer;
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.sorts__item:hover { color: var(--text); }
.sorts__item--on { color: var(--accent-text); background: var(--accent-tint); }
.sorts__mode { margin-left: auto; font-weight: 600; color: var(--text-2); }
.sorts__mode.sorts__item--on { color: var(--accent-text); }
/* 窄螢幕把每顆的左右內距收 2px：八個排序加「關注」在手機上會換成兩行，少一點內距第二行就短一些 */
@media (max-width: 400px) { .sorts__item { padding: 0 8px; } }

.count { margin: 0; font-variant-numeric: tabular-nums; }
.count-row { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-3); }
.rating-filter select {
  height: var(--h-sm); padding: 0 var(--s-6) 0 var(--s-3); border: 1px solid var(--line); border-radius: var(--r-pill);
  background: var(--surface); color: var(--text-2); font: inherit; font-size: 13px; cursor: pointer;
}
.rating-filter select:hover { border-color: var(--line-strong); color: var(--text); }
.more { margin-top: var(--s-6); padding-top: var(--s-5); border-top: 1px solid var(--line); }
.more__title { margin: 0 0 var(--s-3); font-size: 15px; font-weight: 600; color: var(--text-2); }
.stream-tail { min-height: 1px; margin-top: var(--s-5); }
.stream-end { text-align: center; padding: var(--s-6); color: var(--text-2); }
.tail-skeleton { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--s-4); }
.tail-skeleton .ghost { aspect-ratio: 3 / 5.3; }
@media(min-width:600px) { .tail-skeleton { grid-template-columns:repeat(3,minmax(0,1fr)); } }
@media(min-width:820px) { .tail-skeleton { grid-template-columns:repeat(4,minmax(0,1fr)); } }
.ghosts { display: grid; gap: 6px; }
.ghosts .ghost { height: 62px; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; }


/* The enabled pet has a real non-content lane before its assets finish loading. */
@media(min-width:640px) and (max-width:1079px) {
  .board-page--pet-enabled .board-hero { transform: translateX(calc(-50% + (48px + env(safe-area-inset-right, 0px)) / 2)); }
  .board-page--pet-enabled {
    width: calc(100% - 2 * clamp(16px, 2.5vw, 64px) - 48px - env(safe-area-inset-right, 0px));
    margin-inline-start: clamp(16px, 2.5vw, 64px);
    margin-inline-end: calc(clamp(16px, 2.5vw, 64px) + 48px + env(safe-area-inset-right, 0px));
  }
}
</style>

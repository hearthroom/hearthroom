<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
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
import { recallBoard, rememberBoard } from "@/lib/board-memory";
import { takeInlineBoard } from "@/lib/board-inline";
import { rememberCards } from "@/lib/card-memory";
import { contentLang, defaultZone } from "@/lib/i18n";
import DiscoveryTags from "@/components/DiscoveryTags.vue";
import { selectedTags } from "@/lib/discovery";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import { guestAdult, viewerAdult } from "@/lib/adult-consent";
import type { CardPage, Sort } from "@/lib/types";
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

const page = ref<CardPage | null>(null);
/** 開窗的榜卡太少時接在下面的最熱（topUp） */
const more = ref<CommunityCard[]>([]);
const loading = ref(true);
const error = ref("");

/**
 * 榜的種類照魅魔島：最熱、日榜（24h）、週榜（7 天）、月榜（30 天）、最新、推薦（隨機）。窗口看的是上榜時間。
 * 另加評分（貝氏平均，票少的不會一票衝頂）、收藏與最近更新（目前上線版本過審的時刻）（2026-10-11）。
 * 首頁預設最熱、排最左：新站一天上不了幾張卡，日榜（上榜 24 小時內）常常只有一兩張，
 * 第一屏看起來像沒人的站（2026-10-11 線上 34 張卡、日榜 2 張）。最熱是全站卡一起排，站上有卡就不會空。
 */
const SORTS: Sort[] = ["hot", "score", "favorites", "day", "week", "month", "new", "updated", "random"];
/** 三個開窗的榜才顯示「正在被聊」的增量：最熱是累積量，增量在那裡沒意義。 */
const WINDOWED = new Set<Sort>(["day", "week", "month"]);
/** 開窗的榜第一頁不到這麼多張：下面接上最熱，最多接這麼多張 */
const THIN = 8;
const MORE_LIMIT = 12;


/** 角色卡探索或關注動態；相容舊作者榜連結。 */
const mode = computed(() => ["following", "authors"].includes(String(route.query.mode)) ? "following" : "cards");
const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return typeof s === "string" && (SORTS as string[]).includes(s) ? (s as Sort) : "hot";
});
const tags = computed(() => selectedTags(route.query.tag));
/**
 * 分級「最高到這一級」（?rating=）。選單沒有限制級：那一級由頁首的成人內容開關管。
 * 沒標分級的舊卡只知道不是限制級，伺服器只把它們算進「輔15級以下」。
 */
const MENU_RATINGS = RATINGS.filter((r) => r !== "R");
const maxRating = computed<Rating | undefined>(() => (MENU_RATINGS as readonly string[]).includes(String(route.query.rating)) ? route.query.rating as Rating : undefined);
const offset = computed(() => Number(route.query.offset ?? 0) || 0);
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

/** 看過的分頁記在記憶體的鍵。身分還沒到時不記也不取：還不知道這一份是給誰看的。推薦每次都要重洗，不記。 */
function memoryKey(query: Record<string, unknown>): string | null {
  // 知道是誰了（登入的人資料到了，或確定是訪客）才記
  if (!(session.profile || session.ready) || query.sort === "random") return null;
  // 遊客的開關在遊客憑證上（頁首 R18 遊客也能開），一樣算進鍵裡
  const p = session.me ? session.profile : viewerAdult(session);
  return JSON.stringify([query, session.me?.accountNumId ?? null, p?.showNsfw ?? null, p?.ageVerified ?? null, p?.adultConsent ?? null, hidden.value]);
}

const currentQuery = () => ({ zone: zone.value, tag: tags.value, sort: sort.value, offset: offset.value, lang: contentLang(locale.value), rating: maxRating.value });
type BoardQuery = ReturnType<typeof currentQuery>;

/** 身分到了、確認畫面上這份就是給他的：現在才知道該記在誰的名下 */
function adoptShown() {
  const key = memoryKey(currentQuery());
  if (key && page.value) rememberBoard(key, page.value);
}

/**
 * 開窗的榜第一頁不到一屏：下面接上最熱（去掉上面已有的），一屏不會只剩一兩張卡。
 * 只在沒篩類型、第一頁時接——篩了類型、翻到後面是使用者自己要的範圍，不往裡塞別的。
 */
async function topUp(id: number, query: BoardQuery, shown: CardPage) {
  if (!WINDOWED.has(query.sort) || query.tag.length || query.offset || shown.items.length >= THIN) return;
  const hotQuery = { ...query, sort: "hot" as Sort };
  const hotKey = memoryKey(hotQuery);
  const hot = (hotKey ? recallBoard(hotKey) : null) ?? await fetchBoard(hotQuery).catch(() => null);
  if (!hot || id !== loadId) return;
  if (hotKey) rememberBoard(hotKey, hot);
  const seen = new Set(shown.items.map((c) => c.id));
  more.value = hot.items.filter((c) => !seen.has(c.id)).slice(0, MORE_LIMIT);
}

async function load() {
  const id = ++loadId;
  error.value = "";
  more.value = [];
  if (mode.value !== "cards") { loading.value = false; return; }
  const query = currentQuery();
  const key = memoryKey(query);
  const remembered = key ? recallBoard(key) : null;
  const landing = route.query.sort === undefined && !tags.value.length && offset.value === 0;
  // 看過的分頁先畫出來，背景照常重讀；沒看過的才讓舊畫面變淡等它
  if (remembered) page.value = remembered;
  // 新開的首頁：HTML 裡已經放好第一屏的榜單（照看的人的 cookie 讀的最熱），
  // 直接畫、不再讀一次。身分到了由下面的 watch 比對開關，對不上照舊重讀。
  const inline = landing && !remembered ? takeInlineBoard(query) : null;
  if (inline) {
    rememberCards(inline.items);
    page.value = inline;
    loading.value = false;
    if (key) rememberBoard(key, inline);
    return;
  }
  loading.value = !remembered;
  try {
    const result = await fetchBoard(query);
    if (id !== loadId) return;
    page.value = result;
    const storeKey = memoryKey(query);
    if (storeKey) rememberBoard(storeKey, result);
    void topUp(id, query, result);
    if (recheckAfterLoad && session.profile) {
      recheckAfterLoad = false;
      if (!servedFor(result, session.profile.showNsfw)) void load();
      else adoptShown();
    }
  } catch (err) {
    if (id !== loadId) return;
    // 畫面上已經有這一分頁的內容：背景重讀失敗就讓它留著
    if (!remembered) error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    if (id === loadId) loading.value = false;
  }
}

/** 狀態放進網址：篩選結果可以直接分享，上一頁也回得去。 */
function navigate(patch: Record<string, string | string[] | undefined>) {
  const query: Record<string, string | string[]> = { ...(route.query as Record<string, string | string[]>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete query[k];
    else query[k] = v;
  }
  if (!("offset" in patch)) delete query.offset;
  router.push({ query });
}
/** 換榜的時候排序鍵不通用，一起清掉。 */
const switchMode = (m: "following") => navigate({ mode: m, sort: undefined, tag: undefined });

/** 已登入的人頂端放蘇綺面板；新訪客的歡迎橫幅還在時先放橫幅，一次只放一塊。翻到後面幾頁不放。 */
const welcome = useMascotWelcome();
const showHome = computed(() => !!session.me && session.ready && !welcome.visible.value && offset.value === 0);
/** 輪播的第一張就是頂端這塊蘇綺；兩塊都不在時輪播只放活動 */
const hasHero = computed(() => welcome.visible.value || showHome.value);
const sortsEl = ref<HTMLElement | null>(null);
/**
 * 面板上的「找新卡」：不在面板裡列卡，切到日榜（上榜 24 小時內）、捲到榜單那一列。
 * 換分頁時路由會先捲回頂端，等它捲完下一個畫格再捲下來。
 */
async function toNewCards() {
  if (mode.value !== "cards" || sort.value !== "day") await router.push({ query: { ...route.query, mode: undefined, sort: "day", offset: undefined } });
  await nextTick();
  requestAnimationFrame(() => sortsEl.value?.scrollIntoView({ behavior: "smooth", block: "start" }));
}

watch([() => route.query, locale], load, { immediate: true });
// 開關改了要重讀。身分第一次載好（undefined → 值）時，第一屏多半已經照帳號開關讀好了
// （伺服器用 cookie 判斷並標明），對得上就不再讀一次；那一份還在路上就等它回來再比。
watch(() => session.profile?.showNsfw, (now, before) => {
  if (now === before) return;
  if (before === undefined) {
    if (loading.value) { recheckAfterLoad = true; return; }
    if (servedFor(page.value, now)) { adoptShown(); return; }
  }
  void load();
});
// 遊客在頁首開關 R18：伺服器換了遊客憑證，重讀。第一次問到現況（loaded 由 false 變 true）不算改。
watch(() => (!session.me && guestAdult.loaded ? guestAdult.showNsfw : null), (now, before) => {
  if (now !== null && before !== null && now !== before) void load();
});
// 不想看的類型載好或改了（設定頁改完回來）：同樣重讀
watch(() => hidden.value.join(","), (now, before) => { if (now !== before && (now !== "" || before !== undefined)) load(); });

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
  <div class="page">
    <h1 class="sr-only">{{ $t("site.tagline") }}</h1>
    <!-- 頂端輪播：第一張是蘇綺，後面接推薦到首頁的活動（翻到後面幾頁不放活動，同蘇綺面板）；沒有活動就只有蘇綺，跟以前一樣 -->
    <BoardCarousel :hero="hasHero" :campaigns="offset === 0">
      <MascotWelcome />
      <MascotHome v-if="showHome" @discover="toNewCards" />
    </BoardCarousel>
    <DownloadBanner />
    <UpdateStrip />

    <!--
      一列解決「看哪個榜」與「怎麼排」：六個排序在左，最右一顆「關注」是另一個榜（關注作者的新卡），
      不是排法——選中它時六個排序全部不亮。原本的分段控制與 R18 開關各佔一列，手機上第一屏只剩兩張卡（成員意見，owner 2026-10-02）；
      R18 開關搬進頁首（App.vue）。
    -->
    <div ref="sortsEl" class="sorts" role="group" :aria-label="$t('board.sorts')">
      <button v-for="s in SORTS" :key="s" class="sorts__item" :class="{ 'sorts__item--on': mode === 'cards' && sort === s }" :aria-pressed="mode === 'cards' && sort === s" @click="navigate({ mode: undefined, sort: s })">
        {{ $t(`board.sort.${s}`) }}
      </button>
      <button class="sorts__item sorts__mode" :class="{ 'sorts__item--on': mode === 'following' }" :aria-pressed="mode === 'following'" @click="switchMode('following')">{{ $t("board.mode.following") }}</button>
    </div>

    <!-- 類型列：固定的一排（照魅魔島），鍵進網址、名字跟介面語言走。寬螢幕摺成幾行全部看得到；窄螢幕收成兩行，點開才全展 -->
    <DiscoveryTags v-if="mode === 'cards'" :selected="tags" :hidden="hidden" :counts="tagCounts" collapsible @change="navigate({ tag: $event.length ? $event : undefined })" />

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-if="mode === 'cards'">
      <div class="count-row">
        <p class="subtle count">{{ page && page.total !== null ? $t("board.count", { n: page.total }) : "" }}</p>
        <label class="rating-filter">
          <span class="sr-only">{{ $t("board.rating.label") }}</span>
          <select :value="maxRating ?? ''" @change="navigate({ rating: ($event.target as HTMLSelectElement).value || undefined })">
            <option value="">{{ $t("board.rating.all") }}</option>
            <option v-for="o in ratingOptions" :key="o.value" :value="o.value" :disabled="o.n === 0 && maxRating !== o.value">{{ o.label }}{{ o.n === null ? "" : ` (${o.n})` }}</option>
          </select>
        </label>
      </div>
      <CardGrid
        :cards="page?.items ?? []"
        :starter="offset === 0 ? starterCard : null"
        :loading="loading && !page"
        :busy="loading"
        :ranked="!tags.length"
        :rank-offset="page?.offset ?? 0"
        :show-trending="WINDOWED.has(sort)"
        :empty-title="$t(tags.length ? 'board.empty.search.title' : 'board.empty.title')"
        :empty-hint="$t(tags.length ? 'board.empty.search.hint' : 'board.empty.hint')"
      />
      <section v-if="more.length" class="more" data-board-more>
        <h2 class="more__title">{{ $t("board.more.title") }}</h2>
        <CardGrid :cards="more" />
      </section>
      <nav v-if="page && (page.offset > 0 || page.hasNext)" class="pager">
        <button class="btn btn--sm" :disabled="page.offset === 0" @click="navigate({ offset: String(Math.max(0, page.offset - page.limit)) })">← {{ $t("pager.prev") }}</button>
        <span class="subtle">
          {{ page.total === null
            ? $t("pager.page", { n: Math.floor(page.offset / page.limit) + 1 })
            : $t("pager.pageOf", { n: Math.floor(page.offset / page.limit) + 1, total: Math.ceil(page.total / page.limit) }) }}
        </span>
        <button class="btn btn--sm" :disabled="!page.hasNext" @click="navigate({ offset: String(page.offset + page.limit) })">{{ $t("pager.next") }} →</button>
      </nav>
    </template>

    <FollowFeed v-else />
  </div>
</template>

<style scoped>
/* 排序做成細字頁籤；最右那顆「關注」字重重一點、推到最右，跟排序拉開：一個是「看哪個榜」，一個是「怎麼排」。擠不下就換行，不裁字 */
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
.ghosts { display: grid; gap: 6px; }
.ghosts .ghost { height: 62px; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; }

</style>

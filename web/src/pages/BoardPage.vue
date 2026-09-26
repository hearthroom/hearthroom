<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AdultToggle from "@/components/AdultToggle.vue";
import DownloadBanner from "@/components/DownloadBanner.vue";
import FollowFeed from "@/components/FollowFeed.vue";
import CardGrid from "@/components/CardGrid.vue";
import { fetchBoard } from "@/lib/api";
import { recallBoard, rememberBoard } from "@/lib/board-memory";
import { contentLang, defaultZone } from "@/lib/i18n";
import DiscoveryTags from "@/components/DiscoveryTags.vue";
import { selectedTags } from "@/lib/discovery";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import type { CardPage, Sort } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const session = useSession();
const { t } = useI18n();

const page = ref<CardPage | null>(null);
/** 日榜是空的、畫面上改放的是哪個榜；沒有改放時是 null */
const fallbackSort = ref<Sort | null>(null);
/** 分頁列亮哪一個、增量要不要顯示：跟著畫面上實際是哪個榜 */
const shownSort = computed<Sort>(() => fallbackSort.value ?? sort.value);
const loading = ref(true);
const error = ref("");

/** 榜的種類照魅魔島：日榜（24h）、週榜（7 天）、月榜（30 天）、最熱、最新、推薦（隨機）。窗口看的是上榜時間。 */
const SORTS: Sort[] = ["day", "week", "month", "hot", "new", "random"];
/** 三個開窗的榜才顯示「正在被聊」的增量：最熱是累積量，增量在那裡沒意義。 */
const WINDOWED = new Set<Sort>(["day", "week", "month"]);
/**
 * 一進首頁（沒指定榜、沒篩類型、第一頁）而日榜是空的：新站人少，日榜常常整天空著，
 * 第一屏一張卡都沒有看起來像沒人的站（owner 2026-09-26）。依序改放週榜（還是「最近」，有正在被聊的增量），
 * 再不行放最熱（累積量，站上有卡就不會空）。自己點了日榜的人照實看日榜。
 */
const LANDING_FALLBACK: Sort[] = ["week", "hot"];


/** 角色卡探索或關注動態；相容舊作者榜連結。 */
const mode = computed(() => ["following", "authors"].includes(String(route.query.mode)) ? "following" : "cards");
const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return typeof s === "string" && (SORTS as string[]).includes(s) ? (s as Sort) : "day";
});
const tags = computed(() => selectedTags(route.query.tag));
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
  const p = session.profile;
  return JSON.stringify([query, session.me?.accountNumId ?? null, p?.showNsfw ?? null, p?.ageVerified ?? null, p?.adultConsent ?? null, hidden.value]);
}

const currentQuery = () => ({ zone: zone.value, tag: tags.value, sort: sort.value, offset: offset.value, lang: contentLang(locale.value) });
/** 身分到了、確認畫面上這份就是給他的：現在才知道該記在誰的名下 */
function adoptShown() {
  const key = memoryKey(currentQuery());
  if (key && page.value) rememberBoard(key, page.value);
}

async function load() {
  const id = ++loadId;
  error.value = "";
  if (mode.value !== "cards") { loading.value = false; return; }
  const query = currentQuery();
  const key = memoryKey(query);
  const remembered = key ? recallBoard(key) : null;
  const landing = route.query.sort === undefined && !tags.value.length && offset.value === 0;
  // 看過的分頁先畫出來，背景照常重讀；沒看過的才讓舊畫面變淡等它
  if (remembered) { page.value = remembered; fallbackSort.value = remembered.sort !== query.sort ? remembered.sort : null; }
  loading.value = !remembered;
  try {
    let result = await fetchBoard(query);
    if (landing && !result.items.length) {
      for (const next of LANDING_FALLBACK) {
        const alternative = await fetchBoard({ ...query, sort: next });
        if (id !== loadId) return;
        result = alternative;
        if (alternative.items.length) break;
      }
    }
    if (id !== loadId) return;
    page.value = result;
    fallbackSort.value = result.sort !== query.sort && result.items.length ? result.sort : null;
    const storeKey = memoryKey(query);
    if (storeKey) rememberBoard(storeKey, result);
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
const switchMode = (m: "cards" | "following") => navigate({ mode: m === "following" ? "following" : undefined, sort: undefined, tag: undefined });

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
// 不想看的類型載好或改了（設定頁改完回來）：同樣重讀
watch(() => hidden.value.join(","), (now, before) => { if (now !== before && (now !== "" || before !== undefined)) load(); });
</script>

<template>
  <div class="page">
    <h1 class="sr-only">{{ $t("site.tagline") }}</h1>
    <DownloadBanner />

    <div class="bar">
      <!-- 左邊選看哪個榜（旁邊是 R18 開關，窄螢幕它推到同一行的最右），右邊選怎麼排 -->
      <div class="bar__lead">
        <div class="seg seg--mode">
          <button class="seg__item" :class="{ 'seg__item--on': mode === 'cards' }" :aria-pressed="mode === 'cards'" @click="switchMode('cards')">{{ $t("board.mode.cards") }}</button>
          <button class="seg__item" :class="{ 'seg__item--on': mode === 'following' }" :aria-pressed="mode === 'following'" @click="switchMode('following')">{{ $t("library.feed") }}</button>
        </div>
        <AdultToggle v-if="mode === 'cards'" />
      </div>

      <div v-if="mode === 'cards'" class="sorts" role="group" :aria-label="$t('board.sorts')">
        <button v-for="s in SORTS" :key="s" class="sorts__item" :class="{ 'sorts__item--on': shownSort === s }" :aria-pressed="shownSort === s" @click="navigate({ sort: s })">
          {{ $t(`board.sort.${s}`) }}
        </button>
      </div>

    </div>

    <!-- 類型列：固定的一排（照魅魔島），鍵進網址、名字跟介面語言走。摺成幾行，全部看得到 -->
    <DiscoveryTags v-if="mode === 'cards'" :selected="tags" :hidden="hidden" scroll @change="navigate({ tag: $event.length ? $event : undefined })" />

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-if="mode === 'cards'">
      <p v-if="fallbackSort" class="subtle count" role="status">{{ $t(`board.fallback.${fallbackSort}`) }}</p>
      <p v-if="page && page.total !== null" class="subtle count">{{ $t("board.count", { n: page.total }) }}</p>
      <CardGrid
        :cards="page?.items ?? []"
        :loading="loading && !page"
        :busy="loading"
        :ranked="!tags.length"
        :rank-offset="page?.offset ?? 0"
        :show-trending="WINDOWED.has(shownSort)"
        :empty-title="$t(tags.length ? 'board.empty.search.title' : 'board.empty.title')"
        :empty-hint="$t(tags.length ? 'board.empty.search.hint' : 'board.empty.hint')"
      />
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
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-3); }
.seg--mode .seg__item { padding: 0 16px; }
.bar__lead { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
@media (max-width: 640px) {
  .bar__lead { width: 100%; }
  .bar__lead :deep(.r18) { margin-left: auto; }
}

/* 排序做成細字頁籤，跟左邊的分段控制拉開層級：一個是「看哪個榜」，一個是「怎麼排」 */
.sorts { display: flex; gap: 2px; }
.sorts__item {
  height: var(--h-sm); padding: 0 10px; border: 0; border-radius: var(--r-pill);
  background: transparent; font-size: 13px; font-weight: 500; color: var(--text-3); cursor: pointer;
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.sorts__item:hover { color: var(--text); }
.sorts__item--on { color: var(--accent-text); background: var(--accent-tint); }

.count { margin-bottom: var(--s-3); font-variant-numeric: tabular-nums; }
.ghosts { display: grid; gap: 6px; }
.ghosts .ghost { height: 62px; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; }

</style>

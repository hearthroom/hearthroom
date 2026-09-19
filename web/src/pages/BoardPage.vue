<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthorList from "@/components/AuthorList.vue";
import CardGrid from "@/components/CardGrid.vue";
import { fetchAuthors, fetchBoard } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import DiscoveryTags from "@/components/DiscoveryTags.vue";
import { selectedTags } from "@/lib/discovery";
import { useLocalePath } from "@/lib/use-locale";
import { useSession } from "@/lib/session";
import type { AuthorPage } from "@/lib/api";
import type { AuthorSort, CardPage, Sort } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const session = useSession();
const { t } = useI18n();

const page = ref<CardPage | null>(null);
const authors = ref<AuthorPage | null>(null);
const loading = ref(true);
const error = ref("");

/** 榜的種類照魅魔島：日榜（24h）、週榜（7 天）、月榜（30 天）、最熱、最新、推薦（隨機）。窗口看的是上榜時間。 */
const SORTS: Sort[] = ["day", "week", "month", "hot", "new", "random"];
/** 三個開窗的榜才顯示「正在被聊」的增量：最熱是累積量，增量在那裡沒意義。 */
const WINDOWED = new Set<Sort>(["day", "week", "month"]);
const AUTHOR_SORTS: AuthorSort[] = ["talk", "cards", "hot"];

/** 角色卡榜或作者榜。 */
const mode = computed(() => (route.query.mode === "authors" ? "authors" : "cards"));
const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return typeof s === "string" && (SORTS as string[]).includes(s) ? (s as Sort) : "day";
});
const authorSort = computed<AuthorSort>(() => {
  const s = route.query.sort;
  return s === "cards" || s === "hot" ? s : "talk";
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
async function load() {
  const id = ++loadId;
  loading.value = true;
  error.value = "";
  try {
    if (mode.value === "authors") {
      const result = await fetchAuthors({ zone: zone.value, sort: authorSort.value, offset: offset.value });
      if (id === loadId) authors.value = result;
    } else {
      const result = await fetchBoard({
        zone: zone.value,
        tag: tags.value,
        sort: sort.value,
        offset: offset.value,
        lang: contentLang(locale.value),
      });
      if (id === loadId) page.value = result;
    }
  } catch (err) {
    if (id !== loadId) return;
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
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
const switchMode = (m: "cards" | "authors") => navigate({ mode: m === "authors" ? "authors" : undefined, sort: undefined, tag: undefined });

watch([() => route.query, locale], load, { immediate: true });
// 成人內容開關載好（登入後才知道）或改了：重讀，否則第一屏永遠是沒開的版本
// 開關改了要重讀；身分剛載好、發現本來就開著（undefined → true）也要——第一次讀多半比身分早到
watch(() => session.profile?.showNsfw, (now, before) => { if (now !== before && (now === true || before !== undefined)) load(); });
// 不想看的類型載好或改了（設定頁改完回來）：同樣重讀
watch(() => hidden.value.join(","), (now, before) => { if (now !== before && (now !== "" || before !== undefined)) load(); });
</script>

<template>
  <div class="page">
    <h1 class="sr-only">{{ $t("site.tagline") }}</h1>

    <div class="bar">
      <!-- 左邊選看哪個榜，右邊選怎麼排 -->
      <div class="seg seg--mode">
        <button class="seg__item" :class="{ 'seg__item--on': mode === 'cards' }" :aria-pressed="mode === 'cards'" @click="switchMode('cards')">{{ $t("board.mode.cards") }}</button>
        <button class="seg__item" :class="{ 'seg__item--on': mode === 'authors' }" :aria-pressed="mode === 'authors'" @click="switchMode('authors')">{{ $t("board.mode.authors") }}</button>
      </div>

      <div v-if="mode === 'cards'" class="sorts" role="group" :aria-label="$t('board.sorts')">
        <button v-for="s in SORTS" :key="s" class="sorts__item" :class="{ 'sorts__item--on': sort === s }" :aria-pressed="sort === s" @click="navigate({ sort: s })">
          {{ $t(`board.sort.${s}`) }}
        </button>
      </div>
      <div v-else class="sorts" role="group" :aria-label="$t('board.sorts')">
        <button v-for="s in AUTHOR_SORTS" :key="s" class="sorts__item" :class="{ 'sorts__item--on': authorSort === s }" :aria-pressed="authorSort === s" @click="navigate({ sort: s })">
          {{ $t(`author.sort.${s}`) }}
        </button>
      </div>
    </div>

    <!-- 類型列：固定的一排（照魅魔島），鍵進網址、名字跟介面語言走。摺成幾行，全部看得到 -->
    <DiscoveryTags v-if="mode === 'cards'" :selected="tags" :hidden="hidden" scroll @change="navigate({ tag: $event.length ? $event : undefined })" />

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-if="mode === 'cards'">
      <p v-if="page && page.total !== null" class="subtle count">{{ $t("board.count", { n: page.total }) }}</p>
      <CardGrid
        :cards="page?.items ?? []"
        :loading="loading && !page"
        :busy="loading"
        :ranked="!tags.length"
        :rank-offset="page?.offset ?? 0"
        :show-trending="WINDOWED.has(sort)"
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

    <template v-else>
      <div v-if="loading && !authors" class="ghosts"><div v-for="i in 8" :key="i" class="ghost" /></div>
      <div v-else-if="!authors?.items.length" class="empty panel">
        <p class="empty__title">{{ $t("board.empty.title") }}</p>
        <p class="empty__hint muted">{{ $t("board.empty.hint") }}</p>
      </div>
      <div v-else :aria-busy="loading || undefined"><AuthorList :authors="authors.items" ranked :rank-offset="authors.offset" :show-trending="authorSort === 'hot'" /></div>
      <nav v-if="authors && (authors.offset > 0 || authors.hasNext)" class="pager">
        <button class="btn btn--sm" :disabled="authors.offset === 0" @click="navigate({ offset: String(Math.max(0, authors.offset - authors.limit)) })">← {{ $t("pager.prev") }}</button>
        <span class="subtle">{{ $t("pager.page", { n: Math.floor(authors.offset / authors.limit) + 1 }) }}</span>
        <button class="btn btn--sm" :disabled="!authors.hasNext" @click="navigate({ offset: String(authors.offset + authors.limit) })">{{ $t("pager.next") }} →</button>
      </nav>
    </template>
  </div>
</template>

<style scoped>
.bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-3); margin-bottom: var(--s-3); }
.seg--mode .seg__item { padding: 0 16px; }

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

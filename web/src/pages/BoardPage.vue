<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute, useRouter } from "vue-router";
import AuthorList from "@/components/AuthorList.vue";
import CardGrid from "@/components/CardGrid.vue";
import { fetchAuthors, fetchBoard, fetchTags } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { AuthorPage } from "@/lib/api";
import type { AuthorSort, CardPage, Sort } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale, lp } = useLocalePath();
const { t } = useI18n();

const page = ref<CardPage | null>(null);
const authors = ref<AuthorPage | null>(null);
const tags = ref<{ tag: string; n: number }[]>([]);
const loading = ref(true);
const error = ref("");

const SORTS: Sort[] = ["hot", "new", "top"];
const AUTHOR_SORTS: AuthorSort[] = ["talk", "cards", "hot"];

/** 角色卡榜或作者榜。 */
const mode = computed(() => (route.query.mode === "authors" ? "authors" : "cards"));
const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return s === "new" || s === "top" ? s : "hot";
});
const authorSort = computed<AuthorSort>(() => {
  const s = route.query.sort;
  return s === "cards" || s === "hot" ? s : "talk";
});
const tag = computed(() => (typeof route.query.tag === "string" ? route.query.tag : ""));
const offset = computed(() => Number(route.query.offset ?? 0) || 0);

/**
 * 語區跟著介面語言走，不另設開關：看日文介面的人要的就是日文卡。
 * 想看別的語言的卡，換介面語言即可——頁首那個選單同時就是語區選單。
 */
const zone = computed(() => defaultZone(locale.value));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    if (mode.value === "authors") {
      authors.value = await fetchAuthors({ zone: zone.value, sort: authorSort.value, offset: offset.value });
    } else {
      page.value = await fetchBoard({
        zone: zone.value,
        tag: tag.value || undefined,
        sort: sort.value,
        offset: offset.value,
        lang: contentLang(locale.value),
      });
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
/** 類型列跟語區走，跟排序、分頁無關，所以分開抓、抓一次。 */
async function loadTags() {
  try { tags.value = await fetchTags(zone.value); } catch { tags.value = []; }
}

/** 狀態放進網址：篩選結果可以直接分享，上一頁也回得去。 */
function navigate(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
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
watch(zone, loadTags, { immediate: true });
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

    <!-- 類型列：作者自己打的標籤裡最常見的那些。橫向捲，手機上不折行 -->
    <nav v-if="mode === 'cards' && tags.length" class="rail" :aria-label="$t('board.tags')">
      <div class="rail__inner">
        <button class="tagchip" :class="{ 'is-on': !tag }" :aria-pressed="!tag" @click="navigate({ tag: undefined })">{{ $t("board.tag.all") }}</button>
        <button v-for="x in tags" :key="x.tag" class="tagchip" :class="{ 'is-on': tag === x.tag }" :aria-pressed="tag === x.tag" @click="navigate({ tag: tag === x.tag ? undefined : x.tag })">
          {{ x.tag }}<span class="tagchip__n">{{ x.n }}</span>
        </button>
      </div>
    </nav>

    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <template v-if="mode === 'cards'">
      <p v-if="page && page.total !== null" class="subtle count">{{ $t("board.count", { n: page.total }) }}</p>
      <CardGrid
        :cards="page?.items ?? []"
        :loading="loading && !page"
        :busy="loading"
        :ranked="!tag"
        :rank-offset="page?.offset ?? 0"
        :show-trending="sort === 'hot'"
        :empty-title="$t(tag ? 'board.empty.search.title' : 'board.empty.title')"
        :empty-hint="$t(tag ? 'board.empty.search.hint' : 'board.empty.hint')"
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

/* 右緣一道漸隱：告訴人還有更多，捲到底就消失 */
.rail { position: relative; margin: 0 calc(-1 * var(--s-5)) var(--s-4); overflow-x: auto; scrollbar-width: none; mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent); -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 40px), transparent); }
.rail::-webkit-scrollbar { display: none; }
.rail__inner { display: inline-flex; gap: 6px; padding: 2px var(--s-5); }
.tagchip {
  display: inline-flex; align-items: center; gap: 5px;
  height: var(--h-sm); padding: 0 12px; white-space: nowrap;
  background: var(--surface); border: 0; border-radius: var(--r-pill);
  box-shadow: 0 0 0 1px var(--line);
  font-size: 13px; font-weight: 500; color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), box-shadow var(--dur) var(--ease);
}
.tagchip:hover { color: var(--text); box-shadow: 0 0 0 1px var(--line-strong); }
.tagchip.is-on { background: var(--text); color: var(--surface); box-shadow: none; }
.tagchip__n { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.tagchip.is-on .tagchip__n { color: inherit; opacity: 0.7; }

.count { margin-bottom: var(--s-3); font-variant-numeric: tabular-nums; }
.ghosts { display: grid; gap: 6px; }
.ghosts .ghost { height: 62px; }
.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; }

@media (max-width: 640px) {
  .rail { margin-inline: calc(-1 * var(--s-4)); }
  .rail__inner { padding-inline: var(--s-4); }
}
</style>

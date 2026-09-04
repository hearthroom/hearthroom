<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import { fetchBoard } from "@/lib/api";
import { ZONES, contentLang, defaultZone, isZone } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { CardPage, Sort, Zone } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale } = useLocalePath();
const { t } = useI18n();

const page = ref<CardPage | null>(null);
const loading = ref(true);
const error = ref("");

const SORTS: Sort[] = ["hot", "new", "top"];

const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return s === "new" || s === "top" ? s : "hot";
});

/** 語區跟著網址走；沒指定就是介面語言那一區。 */
const zone = computed<Zone>(() => (isZone(route.query.zone) ? route.query.zone : defaultZone(locale.value)));

const searching = computed(() => Boolean(route.query.q || route.query.tag));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    page.value = await fetchBoard({
      zone: zone.value,
      q: (route.query.q as string) || undefined,
      tag: (route.query.tag as string) || undefined,
      sort: sort.value,
      offset: Number(route.query.offset ?? 0) || 0,
      // UI 語言要跟著傳，否則介面是英文、卡名還是中文
      lang: contentLang(locale.value),
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}

/** 狀態放進網址：搜尋結果可以直接分享，上一頁也回得去。 */
function navigate(patch: Record<string, string | undefined>) {
  const query: Record<string, string> = { ...(route.query as Record<string, string>) };
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === "") delete query[k];
    else query[k] = v;
  }
  if (!("offset" in patch)) delete query.offset;
  router.push({ query });
}

watch([() => route.query, locale], load, { immediate: true });
</script>

<template>
  <div class="page board">
    <h1 class="sr-only">{{ $t("site.tagline") }}</h1>

    <!-- 工具列貼在頁首下方：語區是主分區，排序是次要的，兩組都不該離開視線 -->
    <div class="toolbar">
      <nav class="tabs tabs--primary" :aria-label="$t('board.zones')">
        <button
          v-for="z in ZONES"
          :key="z.code"
          class="tabs__item"
          :class="{ 'tabs__item--on': zone === z.code }"
          :lang="z.code"
          @click="navigate({ zone: z.code })"
        >
          {{ z.label }}
        </button>
      </nav>

      <nav class="tabs toolbar__sorts" :aria-label="$t('board.sorts')">
        <button
          v-for="s in SORTS"
          :key="s"
          class="tabs__item"
          :class="{ 'tabs__item--on': sort === s }"
          @click="navigate({ sort: s })"
        >
          {{ $t(`board.sort.${s}`) }}
        </button>
      </nav>
    </div>

    <div class="status">
      <p class="subtle status__blurb">{{ $t(`board.sort.${sort}.blurb`) }}</p>
      <div v-if="searching" class="chips">
        <button v-if="route.query.q" class="chip" @click="navigate({ q: undefined })">
          「{{ route.query.q }}」<span aria-hidden="true">×</span>
        </button>
        <button v-if="route.query.tag" class="chip" @click="navigate({ tag: undefined })">
          #{{ route.query.tag }} <span aria-hidden="true">×</span>
        </button>
      </div>
      <p v-if="page && !loading && page.total !== null" class="subtle status__count">{{ $t("board.count", { n: page.total }) }}</p>
    </div>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <CardGrid
      :cards="page?.items ?? []"
      :loading="loading"
      :ranked="!searching"
      :cover="!searching && (page?.offset ?? 0) === 0"
      :rank-offset="page?.offset ?? 0"
      :show-trending="sort === 'hot'"
      :empty-title="$t(searching ? 'board.empty.search.title' : 'board.empty.title')"
      :empty-hint="$t(searching ? 'board.empty.search.hint' : 'board.empty.hint')"
    />

    <nav v-if="page && (page.offset > 0 || page.hasNext)" class="pager">
      <button
        class="btn btn--sm"
        :disabled="page.offset === 0"
        @click="navigate({ offset: String(Math.max(0, page.offset - page.limit)) })"
      >
        ← {{ $t("pager.prev") }}
      </button>
      <span class="subtle">
        {{ page.total === null
          ? $t("pager.page", { n: Math.floor(page.offset / page.limit) + 1 })
          : $t("pager.pageOf", { n: Math.floor(page.offset / page.limit) + 1, total: Math.ceil(page.total / page.limit) }) }}
      </span>
      <button
        class="btn btn--sm"
        :disabled="!page.hasNext"
        @click="navigate({ offset: String(page.offset + page.limit) })"
      >
        {{ $t("pager.next") }} →
      </button>
    </nav>
  </div>
</template>

<style scoped>
.board { padding-top: 0; }

.toolbar {
  position: sticky; top: var(--masthead-h); z-index: 20;
  display: flex; align-items: stretch; justify-content: space-between; gap: var(--s-5);
  border-bottom: 1px solid var(--rule);
  background: rgba(16, 14, 11, 0.92);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}
/* 語區列可以橫向捲，手機上四個語言名擠不下時不要折行 */
.tabs--primary { overflow-x: auto; scrollbar-width: none; }
.tabs--primary::-webkit-scrollbar { display: none; }
.toolbar__sorts { flex: none; }

.status {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3);
  padding: var(--s-4) 0 var(--s-4);
}
.status__blurb { margin: 0; }
.status__count { margin: 0 0 0 auto; font-variant-numeric: tabular-nums; }

.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.chip {
  height: 26px; padding: 0 var(--s-3);
  font-size: 12.5px; color: var(--text-dim);
  background: var(--gold-wash); border: 0; border-radius: var(--r-pill);
  cursor: pointer;
}
.chip:hover { color: var(--text); }

@media (max-width: 640px) {
  /* 小螢幕：頁首有兩行，工具列不再吸頂；語區與排序各佔一行，排序縮小靠左 */
  .toolbar { position: static; flex-direction: column; gap: 0; }
  .tabs { gap: var(--s-4); }
  .toolbar__sorts { border-top: 1px solid var(--rule); }
  .toolbar__sorts .tabs__item { font-size: 13px; padding: var(--s-2) 0; }
}
</style>

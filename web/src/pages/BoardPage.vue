<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import { fetchBoard } from "@/lib/api";
import { contentLang, defaultZone } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { CardPage, Sort } from "@/lib/types";

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

const searching = computed(() => Boolean(route.query.q || route.query.tag));

/**
 * 語區跟著介面語言走，不另設開關：看日文介面的人要的就是日文卡。
 * 想看別的語言的卡，換介面語言即可——頁首那個選單同時就是語區選單。
 */
async function load() {
  loading.value = true;
  error.value = "";
  try {
    page.value = await fetchBoard({
      zone: defaultZone(locale.value),
      q: (route.query.q as string) || undefined,
      tag: (route.query.tag as string) || undefined,
      sort: sort.value,
      offset: Number(route.query.offset ?? 0) || 0,
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
  <div class="page">
    <h1 class="sr-only">{{ $t("site.tagline") }}</h1>

    <div class="bar">
      <div class="seg" role="tablist" :aria-label="$t('board.sorts')">
        <button
          v-for="s in SORTS"
          :key="s"
          class="seg__item"
          :class="{ 'seg__item--on': sort === s }"
          role="tab"
          :aria-selected="sort === s"
          @click="navigate({ sort: s })"
        >
          {{ $t(`board.sort.${s}`) }}
        </button>
      </div>

      <div v-if="searching" class="chips">
        <button v-if="route.query.q" class="chip" @click="navigate({ q: undefined })">
          {{ route.query.q }}<span aria-hidden="true">×</span>
        </button>
        <button v-if="route.query.tag" class="chip" @click="navigate({ tag: undefined })">
          #{{ route.query.tag }}<span aria-hidden="true">×</span>
        </button>
      </div>

      <p class="subtle bar__note">
        <span>{{ $t(`board.sort.${sort}.blurb`) }}</span>
        <template v-if="page && !loading && page.total !== null"> · {{ $t("board.count", { n: page.total }) }}</template>
      </p>
    </div>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <CardGrid
      :cards="page?.items ?? []"
      :loading="loading"
      :ranked="!searching"
      :rank-offset="page?.offset ?? 0"
      :show-trending="sort === 'hot'"
      :empty-title="$t(searching ? 'board.empty.search.title' : 'board.empty.title')"
      :empty-hint="$t(searching ? 'board.empty.search.hint' : 'board.empty.hint')"
    />

    <nav v-if="page && (page.offset > 0 || page.hasNext)" class="pager">
      <button class="btn btn--sm" :disabled="page.offset === 0" @click="navigate({ offset: String(Math.max(0, page.offset - page.limit)) })">
        ← {{ $t("pager.prev") }}
      </button>
      <span class="subtle">
        {{ page.total === null
          ? $t("pager.page", { n: Math.floor(page.offset / page.limit) + 1 })
          : $t("pager.pageOf", { n: Math.floor(page.offset / page.limit) + 1, total: Math.ceil(page.total / page.limit) }) }}
      </span>
      <button class="btn btn--sm" :disabled="!page.hasNext" @click="navigate({ offset: String(page.offset + page.limit) })">
        {{ $t("pager.next") }} →
      </button>
    </nav>
  </div>
</template>

<style scoped>
.bar {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3);
  margin-bottom: var(--s-4);
}
.chips { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.chip span { margin-left: 2px; color: var(--text-3); }
.bar__note { margin-left: auto; font-variant-numeric: tabular-nums; }

@media (max-width: 640px) {
  .bar__note { margin-left: 0; width: 100%; }
}
</style>

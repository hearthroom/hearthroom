<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import { fetchBoard } from "@/lib/api";
import type { CardPage, Sort } from "@/lib/types";

const route = useRoute();
const router = useRouter();

const page = ref<CardPage | null>(null);
const loading = ref(true);
const error = ref("");
const draft = ref((route.query.q as string) ?? "");

const SORTS: { key: Sort; label: string; blurb: string }[] = [
  { key: "hot", label: "熱門", blurb: "最近一小時對話成長最多的卡" },
  { key: "new", label: "最新", blurb: "剛登記到社群的卡" },
  { key: "top", label: "累積", blurb: "歷來對話總量最高的卡" },
];

const sort = computed<Sort>(() => {
  const s = route.query.sort;
  return s === "new" || s === "top" ? s : "hot";
});
const blurb = computed(() => SORTS.find((s) => s.key === sort.value)?.blurb ?? "");
const searching = computed(() => Boolean(route.query.q || route.query.tag));

async function load() {
  loading.value = true;
  error.value = "";
  try {
    page.value = await fetchBoard({
      q: (route.query.q as string) || undefined,
      tag: (route.query.tag as string) || undefined,
      sort: sort.value,
      offset: Number(route.query.offset ?? 0) || 0,
    });
  } catch (err) {
    error.value = err instanceof Error ? err.message : "載入失敗";
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

watch(() => route.query, load, { immediate: true });
watch(() => route.query.q, (q) => { draft.value = (q as string) ?? ""; });
</script>

<template>
  <div class="page">
    <header class="lede">
      <p class="eyebrow">開源角色卡社群</p>
      <h1 class="lede__title display">角色卡榜單</h1>
      <p class="lede__sub muted">
        作者親自登記的作品。排序只看讀者實際聊了多少，不做人工推薦。
      </p>
    </header>

    <div class="bar">
      <nav class="sorts">
        <button
          v-for="s in SORTS"
          :key="s.key"
          class="sorts__item"
          :class="{ 'sorts__item--on': sort === s.key }"
          @click="navigate({ sort: s.key })"
        >
          {{ s.label }}
        </button>
      </nav>

      <form class="search" @submit.prevent="navigate({ q: draft.trim() || undefined })">
        <input
          v-model="draft"
          class="input search__input"
          type="search"
          placeholder="搜尋角色名、簡介或標籤"
          aria-label="搜尋"
        />
        <button class="btn btn--sm search__go" type="submit">搜尋</button>
      </form>
    </div>

    <div class="status">
      <p class="subtle status__blurb">{{ blurb }}</p>
      <div v-if="searching" class="chips">
        <button v-if="route.query.q" class="chip" @click="navigate({ q: undefined })">
          「{{ route.query.q }}」<span aria-hidden="true">×</span>
        </button>
        <button v-if="route.query.tag" class="chip" @click="navigate({ tag: undefined })">
          #{{ route.query.tag }} <span aria-hidden="true">×</span>
        </button>
      </div>
      <p v-if="page && !loading && page.total !== null" class="subtle status__count">{{ page.total }} 張</p>
    </div>

    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <CardGrid
      :cards="page?.items ?? []"
      :loading="loading"
      :ranked="!searching"
      :rank-offset="page?.offset ?? 0"
      :show-trending="sort === 'hot'"
      :empty-title="searching ? '沒有符合的卡片' : '榜單還是空的'"
      :empty-hint="searching ? '換個關鍵字試試。' : '第一張卡等著被登記——如果你有作品，去「我的卡片」把它放上來。'"
    />

    <nav v-if="page && (page.offset > 0 || page.hasNext)" class="pager">
      <button
        class="btn btn--sm"
        :disabled="page.offset === 0"
        @click="navigate({ offset: String(Math.max(0, page.offset - page.limit)) })"
      >
        ← 上一頁
      </button>
      <span class="subtle">
        第 {{ Math.floor(page.offset / page.limit) + 1 }} 頁<template v-if="page.total !== null"> / 共 {{ Math.ceil(page.total / page.limit) }} 頁</template>
      </span>
      <button
        class="btn btn--sm"
        :disabled="!page.hasNext"
        @click="navigate({ offset: String(page.offset + page.limit) })"
      >
        下一頁 →
      </button>
    </nav>
  </div>
</template>

<style scoped>
.lede { margin-bottom: var(--s-6); }
.lede__title { margin: var(--s-2) 0 var(--s-2); font-size: clamp(38px, 6vw, 58px); }
.lede__sub { margin: 0; font-size: 14.5px; max-width: 52ch; }

.bar {
  display: flex; flex-wrap: wrap; gap: var(--s-4);
  align-items: center; justify-content: space-between;
  padding-bottom: var(--s-3);
  border-bottom: 1px solid var(--rule);
}

/* 排序做成排版式的頁籤，不做膠囊按鈕——膠囊會跟卡片的圓角語言打架 */
.sorts { display: flex; gap: var(--s-5); }
.sorts__item {
  padding: 0 0 var(--s-2);
  background: none; border: 0; cursor: pointer;
  font-size: 14px; color: var(--text-faint);
  border-bottom: 1px solid transparent;
  margin-bottom: -13px;
  transition: color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.sorts__item:hover { color: var(--text-dim); }
.sorts__item--on { color: var(--text); border-bottom-color: var(--gold); }

.search { display: flex; gap: var(--s-2); flex: 1 1 300px; max-width: 400px; }
.search__input { flex: 1; min-width: 0; }
/* flex: none 是這裡的重點：不加的話按鈕會被壓到「搜／尋」直排 */
.search__go { flex: none; }

.status {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3);
  padding: var(--s-3) 0 var(--s-5);
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

.pager {
  display: flex; align-items: center; justify-content: center; gap: var(--s-5);
  margin-top: var(--s-7); padding-top: var(--s-5);
  border-top: 1px solid var(--rule);
}

@media (max-width: 560px) {
  .bar { align-items: stretch; }
  .search { max-width: none; }
}
</style>

<script setup lang="ts">
/**
 * 官方部落格的列表：欄目標籤（「全部」在第一個）、第一篇置頂做首屏大圖，其餘置頂與一般文章是卡片網格。
 * 欄目在網址上（/blog/<欄目>），連結分享出去看到同一欄。置頂每頁都會回來，只取第一頁那份。
 */
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import BlogPostCard from "@/components/BlogPostCard.vue";
import { allColumns, columnName, fetchColumns, fetchPosts, groupOfColumn, type BlogGroup, type PostCard } from "@/lib/blog";
import { pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";

const { t } = useI18n();
const { lp, locale } = useLocalePath();
const route = useRoute();

const group = computed(() => (typeof route.params.group === "string" && route.params.group) || undefined);
const column = computed(() => (typeof route.params.column === "string" && route.params.column) || undefined);
const groups = ref<BlogGroup[]>([]);
/** 目前所在的分組：分組頁就是那一組；欄目頁是欄目所屬的那一組 */
const activeGroup = computed(() => (group.value ? groups.value.find((g) => g.slug === group.value) : column.value ? groupOfColumn(groups.value, column.value) : undefined));
const pinned = ref<PostCard[]>([]);
const items = ref<PostCard[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(true);
const failed = ref(false);

const hero = computed(() => pinned.value[0] ?? null);
const rest = computed(() => [...pinned.value.slice(1), ...items.value]);
const hasMore = computed(() => items.value.length < total.value);
const empty = computed(() => !loading.value && !failed.value && !hero.value && !rest.value.length);
const nameOf = (slug: string) => columnName(allColumns(groups.value).find((c) => c.slug === slug), locale.value);

/** 換欄目時上一欄的回應晚到就丟掉，不蓋掉新的 */
let seq = 0;
async function load(reset = false) {
  if (reset) page.value = 1;
  const mine = ++seq;
  loading.value = true;
  failed.value = false;
  try {
    const res = await fetchPosts({ group: group.value, column: column.value }, page.value);
    if (mine !== seq) return;
    if (page.value === 1) { pinned.value = res.pinned ?? []; items.value = res.items ?? []; }
    else items.value = [...items.value, ...(res.items ?? [])];
    total.value = Number(res.total) || 0;
  } catch {
    if (mine === seq) failed.value = true;
  } finally {
    if (mine === seq) loading.value = false;
  }
}
function more() { page.value += 1; void load(); }

onMounted(() => {
  document.title = pageTitle(t("blog.title"));
  fetchColumns().then((r) => { groups.value = r.items ?? []; }).catch(() => {});
});
watch([group, column], () => load(true), { immediate: true });
watch(locale, () => { document.title = pageTitle(t("blog.title")); });
</script>

<template>
  <div class="page blog" :aria-busy="loading && !!(hero || rest.length)">
    <header class="blog__head">
      <h1>{{ t("blog.title") }}</h1>
      <nav v-if="groups.length" class="blog__tabs blog__tabs--groups" :aria-label="t('blog.columns')">
        <RouterLink :to="lp('/blog')" class="blog__tab" :class="{ 'blog__tab--on': !activeGroup }" :aria-current="!activeGroup ? 'page' : undefined">{{ t("blog.all") }}</RouterLink>
        <RouterLink v-for="g in groups" :key="g.id" :to="lp(`/blog/g/${g.slug}`)" class="blog__tab" :class="{ 'blog__tab--on': activeGroup?.id === g.id }" :aria-current="group === g.slug ? 'page' : undefined">{{ columnName(g, locale) }}</RouterLink>
      </nav>
      <nav v-if="activeGroup" class="blog__tabs blog__tabs--columns" :aria-label="columnName(activeGroup, locale)">
        <RouterLink :to="lp(`/blog/g/${activeGroup.slug}`)" class="blog__tab" :class="{ 'blog__tab--on': !column }" :aria-current="!column ? 'page' : undefined">{{ t("blog.all") }}</RouterLink>
        <RouterLink v-for="c in activeGroup.columns" :key="c.id" :to="lp(`/blog/${c.slug}`)" class="blog__tab" :class="{ 'blog__tab--on': column === c.slug }" :aria-current="column === c.slug ? 'page' : undefined">{{ columnName(c, locale) }}</RouterLink>
      </nav>
    </header>

    <p v-if="failed" class="notice notice--error" role="alert">
      {{ t("blog.error") }}
      <button type="button" class="btn btn--sm" @click="load()">{{ t("blog.retry") }}</button>
    </p>

    <!-- 骨架：一張大圖加一排卡，幾何跟真的卡一樣，資料到了不跳格 -->
    <div v-if="loading && !hero && !rest.length" class="blog__skeleton" aria-hidden="true">
      <div class="ghost blog__skeleton-hero" />
      <div class="blog__grid">
        <div v-for="i in 6" :key="i" class="blog__skeleton-card"><div class="ghost blog__skeleton-cover" /><div class="ghost blog__skeleton-line" /><div class="ghost blog__skeleton-line blog__skeleton-line--short" /></div>
      </div>
    </div>
    <p v-else-if="empty" class="blog__empty muted">{{ t("blog.empty") }}</p>

    <template v-else>
      <BlogPostCard v-if="hero" class="blog__hero" :post="hero" :column="nameOf(hero.columnSlug)" hero />
      <div v-if="rest.length" class="blog__grid">
        <BlogPostCard v-for="p in rest" :key="p.id" :post="p" :column="nameOf(p.columnSlug)" />
      </div>
      <button v-if="hasMore && !loading" type="button" class="btn btn--sm blog__more" @click="more()">{{ t("comment.loadMore") }}</button>
    </template>
  </div>
</template>

<style scoped>
.blog { display: grid; gap: var(--s-6); }
.blog__head { display: grid; gap: var(--s-3); }
.blog__head h1 { margin: 0; font-size: 24px; }
.blog__tabs { display: flex; flex-wrap: wrap; gap: 2px; }
.blog__tab {
  display: inline-flex; align-items: center; height: var(--h-sm); padding: 0 12px; border-radius: var(--r-pill);
  font-size: 13px; font-weight: 500; color: var(--text-3);
  transition: color var(--dur) var(--ease), background var(--dur) var(--ease);
}
.blog__tab:hover { color: var(--text); }
.blog__tab--on { color: var(--accent-text); background: var(--accent-tint); }
.blog__tabs--columns { padding-top: var(--s-2); border-top: 1px solid var(--line); }
.blog__tabs--columns .blog__tab { height: 28px; font-size: 12.5px; }
.blog__grid { display: grid; gap: var(--s-6) var(--s-5); grid-template-columns: minmax(0, 1fr); }
@media (min-width: 600px) { .blog__grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (min-width: 960px) { .blog__grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
.blog__more { justify-self: center; }
.blog__empty { padding: var(--s-8) 0; text-align: center; }
.blog__skeleton { display: grid; gap: var(--s-6); }
.blog__skeleton-hero { aspect-ratio: 16 / 9; max-height: 420px; }
.blog__skeleton-card { display: grid; gap: var(--s-2); }
.blog__skeleton-cover { aspect-ratio: 16 / 9; }
.blog__skeleton-line { height: 16px; border-radius: var(--r-sm); }
.blog__skeleton-line--short { width: 60%; }
</style>

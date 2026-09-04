<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import NotFoundPage from "@/pages/NotFoundPage.vue";
import { ApiError, fetchAuthor, fetchBoard } from "@/lib/api";
import { compact, hueFrom, relativeTime } from "@/lib/format";
import { contentLang, pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { Author, CardPage } from "@/lib/types";

const route = useRoute();
const router = useRouter();
const { locale } = useLocalePath();
const { t } = useI18n();
const author = ref<Author | null>(null);
const page = ref<CardPage | null>(null);
const loading = ref(true);
const missing = ref(false);
const error = ref("");
const offset = computed(() => Number(route.query.offset ?? 0) || 0);
const LIMIT = 24;

async function load() {
  loading.value = !page.value;
  missing.value = false;
  error.value = "";
  const id = Number(route.params.accountNumId);
  try {
    const [profile, board] = await Promise.all([
      fetchAuthor(id),
      fetchBoard({ author: id, sort: "new", limit: LIMIT, offset: offset.value, lang: contentLang(locale.value) }),
    ]);
    author.value = profile;
    page.value = board;
    document.title = pageTitle(profile.name);
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) missing.value = true;
    else error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
function go(offset: number) {
  router.push({ query: offset > 0 ? { offset: String(offset) } : {} });
}
watch(() => route.params.accountNumId, () => { author.value = null; page.value = null; load(); }, { immediate: true });
watch([() => route.query.offset, locale], load);
</script>

<template>
  <NotFoundPage v-if="missing" :title="$t('author.notFound.title')" :hint="$t('author.notFound.hint')" />

  <div v-else class="page">
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

    <header v-else-if="author" class="who panel rise">
      <img v-if="author.avatar" :src="author.avatar" alt="" class="who__face" />
      <div v-else class="who__face mono" :style="{ '--h': hueFrom(author.name) }">{{ [...author.name][0] }}</div>
      <div class="who__text">
        <p class="eyebrow">{{ $t("author.eyebrow") }}</p>
        <h1 class="who__name display">{{ author.name }}</h1>
      </div>
      <dl class="who__stats">
        <div class="stat"><dt>{{ $t("author.stat.cards") }}</dt><dd>{{ author.cardCount }}</dd></div>
        <div class="stat"><dt>{{ $t("author.stat.talk") }}</dt><dd>{{ compact(author.talkTotal) }}</dd></div>
        <div class="stat"><dt>{{ $t("author.stat.joined") }}</dt><dd>{{ relativeTime(author.joinedAt) }}</dd></div>
      </dl>
    </header>
    <div v-else class="ghost who--ghost" aria-hidden="true" />

    <CardGrid
      :cards="page?.items ?? []"
      :loading="loading && !page"
      :busy="loading"
      show-zone
      :empty-title="$t('author.empty.title')"
      :empty-hint="$t('author.empty.hint')"
    />
    <nav v-if="page && (page.offset > 0 || page.hasNext)" class="pager">
      <button class="btn btn--sm" :disabled="page.offset === 0" @click="go(Math.max(0, page.offset - page.limit))">← {{ $t("pager.prev") }}</button>
      <span class="subtle">
        {{ page.total === null
          ? $t("pager.page", { n: Math.floor(page.offset / page.limit) + 1 })
          : $t("pager.pageOf", { n: Math.floor(page.offset / page.limit) + 1, total: Math.ceil(page.total / page.limit) }) }}
      </span>
      <button class="btn btn--sm" :disabled="!page.hasNext" @click="go(page.offset + page.limit)">{{ $t("pager.next") }} →</button>
    </nav>
  </div>
</template>

<style scoped>
.who {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-5);
  padding: var(--s-5); margin-bottom: var(--s-5);
}
.who--ghost { height: 112px; border-radius: var(--r-lg); margin-bottom: var(--s-5); }
.who__face { width: 64px; height: 64px; border-radius: var(--r-pill); object-fit: cover; flex: none; font-size: 24px; }
.who__text { min-width: 0; margin-right: auto; }
.who__name { font-size: clamp(20px, 2.6vw, 26px); }
.who__stats { display: flex; gap: var(--s-6); }
</style>

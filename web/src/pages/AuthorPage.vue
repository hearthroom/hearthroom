<script setup lang="ts">
import { ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute } from "vue-router";
import CardGrid from "@/components/CardGrid.vue";
import { fetchAuthor, fetchBoard } from "@/lib/api";
import { compact, relativeTime } from "@/lib/format";
import { contentLang, pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { Author, CommunityCard } from "@/lib/types";

const route = useRoute();
const { locale } = useLocalePath();
const { t } = useI18n();
const author = ref<Author | null>(null);
const cards = ref<CommunityCard[]>([]);
const loading = ref(true);
const error = ref("");

async function load() {
  loading.value = true;
  error.value = "";
  const id = Number(route.params.accountNumId);
  try {
    const [profile, board] = await Promise.all([
      fetchAuthor(id),
      fetchBoard({ author: id, sort: "new", limit: 100, lang: contentLang(locale.value) }),
    ]);
    author.value = profile;
    cards.value = board.items;
    document.title = pageTitle(profile.name);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
watch([() => route.params.accountNumId, locale], load, { immediate: true });
</script>

<template>
  <div class="page">
    <p v-if="error" class="notice notice--error">{{ error }}</p>

    <header v-else-if="author" class="who panel rise">
      <img v-if="author.avatar" :src="author.avatar" :alt="author.name" class="who__face" />
      <div v-else class="who__face who__face--void">{{ [...author.name][0] }}</div>
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

    <CardGrid
      :cards="cards"
      :loading="loading"
      show-zone
      :empty-title="$t('author.empty.title')"
      :empty-hint="$t('author.empty.hint')"
    />
  </div>
</template>

<style scoped>
.who {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-5);
  padding: var(--s-5); margin-bottom: var(--s-5);
}
.who__face { width: 64px; height: 64px; border-radius: var(--r-pill); object-fit: cover; flex: none; }
.who__face--void { display: grid; place-items: center; background: var(--surface-2); font-size: 24px; font-weight: 600; color: var(--text-2); }
.who__text { min-width: 0; margin-right: auto; }
.who__name { font-size: clamp(20px, 2.6vw, 26px); }
.who__stats { display: flex; gap: var(--s-6); }
</style>

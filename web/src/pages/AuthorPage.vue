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

    <header v-else-if="author" class="who rise">
      <img v-if="author.avatar" :src="author.avatar" :alt="author.name" class="who__face" />
      <div class="who__text">
        <p class="eyebrow">{{ $t("author.eyebrow") }}</p>
        <h1 class="who__name display">{{ author.name }}</h1>
        <dl class="who__stats">
          <div><dt>{{ $t("author.stat.cards") }}</dt><dd>{{ author.cardCount }}</dd></div>
          <div><dt>{{ $t("author.stat.talk") }}</dt><dd>{{ compact(author.talkTotal) }}</dd></div>
          <div><dt>{{ $t("author.stat.joined") }}</dt><dd>{{ relativeTime(author.joinedAt) }}</dd></div>
        </dl>
      </div>
    </header>

    <CardGrid
      :cards="cards"
      :loading="loading"
      :empty-title="$t('author.empty.title')"
      :empty-hint="$t('author.empty.hint')"
    />
  </div>
</template>

<style scoped>
.who {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-5);
  padding-bottom: var(--s-5); margin-bottom: var(--s-6);
  border-bottom: 1px solid var(--rule);
}
.who__face {
  width: 84px; height: 84px; border-radius: var(--r-pill); flex: none;
  box-shadow: 0 0 0 1px var(--rule);
}
.who__text { min-width: 0; }
.who__name { margin: var(--s-1) 0 var(--s-3); font-size: clamp(30px, 4.6vw, 44px); }

.who__stats { display: flex; flex-wrap: wrap; gap: var(--s-6); margin: 0; }
.who__stats dt { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-faint); }
.who__stats dd {
  margin: 2px 0 0; font-family: var(--font-display); font-size: 22px;
  font-variant-numeric: tabular-nums;
}
</style>

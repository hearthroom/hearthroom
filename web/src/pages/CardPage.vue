<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import { UPSTREAM_API } from "@/lib/config";
import { fetchCard } from "@/lib/api";
import { contentLang, pageTitle } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";

import { compact, hueFrom, relativeTime } from "@/lib/format";
import type { CommunityCard } from "@/lib/types";

const route = useRoute();
const { locale, lp } = useLocalePath();
const { t } = useI18n();
const card = ref<CommunityCard | null>(null);
const loading = ref(true);
const error = ref("");

const hue = computed(() => hueFrom(card.value?.name ?? ""));
const playUrl = computed(() =>
  card.value ? `${UPSTREAM_API.replace("api.", "")}/role/${card.value.roleId}` : "#",
);

async function load() {
  loading.value = true;
  error.value = "";
  try {
    card.value = await fetchCard(route.params.id as string, contentLang(locale.value));
    if (card.value) document.title = pageTitle(card.value.name);
  } catch (err) {
    error.value = err instanceof Error ? err.message : t("state.loadFailed");
  } finally {
    loading.value = false;
  }
}
watch([() => route.params.id, locale], load, { immediate: true });
</script>

<template>
  <div>
    <!-- 背景圖化成一層極淡的氛圍，不直接展示：它是給對話用的，不是給列表看的 -->
    <div
      v-if="card?.backgroundUrl"
      class="ambient"
      :style="{ backgroundImage: `url(${card.backgroundUrl})` }"
      aria-hidden="true"
    />

    <div class="page">
      <p v-if="loading" class="muted">{{ $t("state.loading") }}</p>
      <p v-else-if="error" class="notice notice--error">{{ error }}</p>

      <article v-else-if="card" class="dossier rise">
        <div class="dossier__plate">
          <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" />
          <div
            v-else
            class="dossier__void"
            :style="{ background: `linear-gradient(155deg, hsl(${hue} 24% 26%), hsl(${(hue + 45) % 360} 20% 14%))` }"
          >
            <span class="display">{{ [...card.name][0] }}</span>
          </div>
        </div>

        <div class="dossier__body">
          <p class="eyebrow">{{ $t("card.eyebrow") }}</p>
          <h1 class="dossier__name display">{{ card.name }}</h1>
          <p v-if="card.summary" class="dossier__hook">{{ card.summary }}</p>

          <ul v-if="card.tags.length" class="tags">
            <li v-for="tag in card.tags" :key="tag">
              <RouterLink :to="{ path: lp('/'), query: { tag } }">{{ tag }}</RouterLink>
            </li>
          </ul>

          <dl class="stats">
            <div><dt>{{ $t("card.stat.talk") }}</dt><dd>{{ compact(card.talkNum) }}</dd></div>
            <div><dt>{{ $t("card.stat.follow") }}</dt><dd>{{ compact(card.followNum) }}</dd></div>
            <div><dt>{{ $t("card.stat.trending") }}</dt><dd>{{ card.trending > 0 ? `↑${compact(card.trending)}` : "—" }}</dd></div>
          </dl>

          <RouterLink :to="lp(`/authors/${card.author.accountNumId}`)" class="byline">
            <img v-if="card.author.avatar" :src="card.author.avatar" alt="" />
            <span>
              <span class="subtle">{{ $t("card.author") }}</span>
              <strong>{{ card.author.name }}</strong>
            </span>
          </RouterLink>

          <!-- 對話目前發生在作品所在的服務上；chat-core 接進來之後換成站內入口。 -->
          <a class="btn btn--primary dossier__cta" :href="playUrl" target="_blank" rel="noopener">
            {{ $t("card.play") }} ↗
          </a>

          <p class="subtle dossier__foot">
            {{ $t("card.meta", { registered: relativeTime(card.registeredAt), synced: relativeTime(card.syncedAt) }) }}
          </p>
        </div>
      </article>
    </div>
  </div>
</template>

<style scoped>
.ambient {
  position: fixed; inset: 0 0 auto 0; height: 62vh; z-index: -1;
  background-size: cover; background-position: center;
  opacity: 0.16;
  filter: blur(46px) saturate(0.7);
  mask-image: linear-gradient(to bottom, #000 0%, transparent 88%);
  -webkit-mask-image: linear-gradient(to bottom, #000 0%, transparent 88%);
}

.dossier {
  display: grid;
  grid-template-columns: minmax(0, 330px) minmax(0, 1fr);
  gap: var(--s-7);
  align-items: start;
}

.dossier__plate {
  aspect-ratio: 3 / 4; overflow: hidden;
  border-radius: var(--r-lg);
  background: var(--paper-sunken);
  box-shadow: inset 0 0 0 1px var(--rule), 0 24px 60px rgba(0, 0, 0, 0.5);
}
.dossier__plate img { width: 100%; height: 100%; object-fit: cover; }
.dossier__void { display: grid; place-items: center; height: 100%; }
.dossier__void span { font-size: 110px; color: rgba(255, 255, 255, 0.16); }

.dossier__name { margin: var(--s-2) 0 var(--s-3); font-size: clamp(36px, 5.4vw, 56px); }
.dossier__hook {
  margin: 0 0 var(--s-5); max-width: 58ch;
  font-size: 16px; line-height: 1.75; color: var(--text-dim); white-space: pre-wrap;
}

.tags { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0 0 var(--s-6); padding: 0; list-style: none; }
.tags a {
  display: inline-block; padding: 3px var(--s-3);
  font-size: 12.5px; color: var(--text-dim);
  border: 1px solid var(--rule); border-radius: var(--r-pill);
  transition: border-color var(--dur) var(--ease), color var(--dur) var(--ease);
}
.tags a:hover { border-color: var(--gold-deep); color: var(--text); }

/* 統計用髮絲線分隔，數字用襯線：像刊物的資料欄而不是儀表板的數字方塊 */
.stats { display: flex; gap: 0; margin: 0 0 var(--s-6); padding: 0; border-top: 1px solid var(--rule); }
.stats > div { flex: 1; padding: var(--s-3) var(--s-4) var(--s-3) 0; border-right: 1px solid var(--rule); }
.stats > div:last-child { border-right: 0; }
.stats > div:not(:first-child) { padding-left: var(--s-4); }
.stats dt { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-faint); }
.stats dd {
  margin: 2px 0 0; font-family: var(--font-display); font-size: 27px;
  font-variant-numeric: tabular-nums;
}

/* 這兩個都得是區塊級：.btn 本身是 inline-flex，署名若也用 inline-flex 會被排到同一行疊住 */
.byline { display: flex; width: fit-content; align-items: center; gap: var(--s-3); margin-bottom: var(--s-5); }
.byline img { width: 40px; height: 40px; border-radius: var(--r-pill); }
.byline span { display: grid; line-height: 1.35; }
.byline:hover strong { color: var(--gold); }

.dossier__cta { display: flex; width: 100%; max-width: 300px; height: 44px; }
.dossier__foot { margin: var(--s-5) 0 0; }

@media (max-width: 780px) {
  .dossier { grid-template-columns: 1fr; gap: var(--s-5); }
  .dossier__plate { max-width: 280px; }
}
</style>

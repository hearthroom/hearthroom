<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { RouterLink, useRoute } from "vue-router";
import { UPSTREAM_API } from "@/lib/config";
import { fetchCard } from "@/lib/api";
import { contentLang, pageTitle, zoneLabel } from "@/lib/i18n";
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
  <div class="page sheet-page">
    <!-- 背景圖化成一層很淡的氛圍，不直接展示：它是給對話用的，不是給列表看的 -->
    <div
      v-if="card?.backgroundUrl || card?.avatarUrl"
      class="ambient"
      :style="{ backgroundImage: `url(${card.backgroundUrl || card.avatarUrl})` }"
      aria-hidden="true"
    />
    <div v-if="loading" class="ghost sheet-ghost" />
    <p v-else-if="error" class="notice notice--error">{{ error }}</p>

    <article v-else-if="card" class="sheet panel rise">
      <div class="sheet__art">
        <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" />
        <div
          v-else
          class="sheet__void"
          :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
        >
          <span>{{ [...card.name][0] }}</span>
        </div>
      </div>

      <div class="sheet__body">
        <p class="eyebrow">{{ $t("card.eyebrow") }} · {{ zoneLabel(card.zone) }}</p>
        <h1 class="sheet__name display">{{ card.name }}</h1>

        <RouterLink :to="lp(`/authors/${card.author.accountNumId}`)" class="byline">
          <img v-if="card.author.avatar" :src="card.author.avatar" alt="" />
          <span>{{ card.author.name }}</span>
        </RouterLink>

        <p v-if="card.summary" class="sheet__hook">{{ card.summary }}</p>

        <ul v-if="card.tags.length" class="tags">
          <li v-for="tag in card.tags" :key="tag">
            <RouterLink :to="{ path: lp('/'), query: { tag } }" class="chip">#{{ tag }}</RouterLink>
          </li>
        </ul>

        <dl class="stats">
          <div class="stat"><dt>{{ $t("card.stat.talk") }}</dt><dd>{{ compact(card.talkNum) }}</dd></div>
          <div class="stat"><dt>{{ $t("card.stat.follow") }}</dt><dd>{{ compact(card.followNum) }}</dd></div>
          <div class="stat"><dt>{{ $t("card.stat.trending") }}</dt><dd :class="{ up: card.trending > 0 }">{{ card.trending > 0 ? `+${compact(card.trending)}` : "—" }}</dd></div>
        </dl>

        <!-- 對話目前發生在作品所在的服務上；chat-core 接進來之後換成站內入口。 -->
        <a class="btn btn--primary sheet__cta" :href="playUrl" target="_blank" rel="noopener">
          {{ $t("card.play") }} ↗
        </a>

        <p class="subtle sheet__foot">
          {{ $t("card.meta", { registered: relativeTime(card.registeredAt), synced: relativeTime(card.syncedAt) }) }}
        </p>
      </div>
    </article>
  </div>
</template>

<style scoped>
/* 氛圍層放在頁面容器裡而不是 fixed 到視窗：z-index 負值的 fixed 層會被 body 的背景蓋掉 */
.sheet-page { position: relative; }
.ambient {
  position: absolute; inset: 0 -50vw auto -50vw; height: 56vh; z-index: 0;
  background-size: cover; background-position: center 30%;
  opacity: 0.32;
  filter: blur(64px) saturate(1.2);
  mask-image: linear-gradient(to bottom, #000 20%, transparent);
  -webkit-mask-image: linear-gradient(to bottom, #000 20%, transparent);
}

.sheet-ghost { height: 480px; border-radius: var(--r-lg); }

.sheet {
  position: relative; z-index: 1;
  display: grid; grid-template-columns: 320px minmax(0, 1fr);
  gap: var(--s-6); padding: var(--s-5);
  align-items: start;
  background: color-mix(in srgb, var(--surface) 88%, transparent);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}
.sheet__art { position: relative; aspect-ratio: 3 / 4; border-radius: var(--r-md); overflow: hidden; background: var(--surface-2); box-shadow: 0 0 0 1px var(--line), var(--shadow-md); }
.sheet__art img { width: 100%; height: 100%; object-fit: cover; }
.sheet__void { display: grid; place-items: center; height: 100%; }
.sheet__void span { font-size: 96px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }

.sheet__name { font-size: clamp(24px, 3vw, 32px); margin: 4px 0 var(--s-3); }

.byline { display: inline-flex; align-items: center; gap: 8px; margin-bottom: var(--s-4); font-size: 13.5px; font-weight: 500; color: var(--text-2); }
.byline img { width: 24px; height: 24px; border-radius: var(--r-pill); object-fit: cover; }
.byline:hover { color: var(--text); }

.sheet__hook { max-width: 60ch; font-size: 14.5px; line-height: 1.75; color: var(--text); white-space: pre-wrap; margin-bottom: var(--s-4); }

.tags { display: flex; flex-wrap: wrap; gap: var(--s-2); margin: 0 0 var(--s-5); padding: 0; list-style: none; }

.stats {
  display: flex; gap: var(--s-6); margin-bottom: var(--s-5);
  padding: var(--s-4) 0; border-top: 1px solid var(--border); border-bottom: 1px solid var(--border);
}
.stat dd.up { color: var(--accent); }

.sheet__cta { height: 42px; width: 100%; max-width: 280px; font-size: 15px; }
.sheet__foot { margin-top: var(--s-4); }

@media (max-width: 720px) {
  .sheet { grid-template-columns: 1fr; padding: var(--s-4); }
  .sheet__art { max-width: 260px; }
}
</style>

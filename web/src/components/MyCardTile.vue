<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { compact, hueFrom } from "@/lib/format";
import { zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { MyCard } from "@/lib/api";

const props = defineProps<{ card: MyCard; busy: boolean }>();
defineEmits<{ toggle: [] }>();

const { lp } = useLocalePath();
const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");
</script>

<template>
  <article class="card rise">
    <RouterLink :to="lp(`/cards/${card.roleId}/edit`)" class="card__art">
      <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" loading="lazy" />
      <div
        v-else
        class="card__void"
        :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
      >
        <span>{{ initial }}</span>
      </div>
      <!-- 在榜上是這頁最重要的一個位元，標在圖上 -->
      <span v-if="card.registered" class="card__badge">{{ $t("mine.badge.listed") }}</span>
    </RouterLink>

    <div class="card__body">
      <h3 class="card__name">{{ card.name }}</h3>
      <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>
      <p class="card__meta">{{ zoneLabel(card.zone) }} · {{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</p>
      <!-- 工作區的操作不能藏在 hover 底下：觸控裝置根本碰不到 -->
      <div class="card__actions">
        <RouterLink class="btn btn--sm" :to="lp(`/cards/${card.roleId}/edit`)">{{ $t("mine.action.edit") }}</RouterLink>
        <button
          class="btn btn--sm"
          :class="card.registered ? 'btn--danger' : 'btn--primary'"
          :disabled="busy"
          @click="$emit('toggle')"
        >
          {{ busy ? "…" : card.registered ? $t("mine.action.unregister") : $t("mine.action.register") }}
        </button>
      </div>
    </div>
  </article>
</template>

<style scoped>
.card {
  display: flex; flex-direction: column; min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--r-md);
  overflow: hidden;
}
.card__art { position: relative; display: block; aspect-ratio: 3 / 4; background: var(--surface-2); overflow: hidden; }
.card__art img { width: 100%; height: 100%; object-fit: cover; }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; }
.card__void span { font-size: 40px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }

.card__badge {
  position: absolute; top: 8px; left: 8px;
  height: 22px; padding: 0 8px; display: inline-flex; align-items: center;
  border-radius: var(--r-pill);
  background: var(--accent); color: var(--on-accent);
  font-size: 11.5px; font-weight: 600;
}

.card__body { display: grid; gap: 4px; padding: 10px 12px 12px; }
.card__name { font-size: 14.5px; font-weight: 600; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__hook {
  font-size: 12.5px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  min-height: calc(12.5px * 1.5 * 2);
}
.card__meta { font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.card__actions { display: flex; gap: var(--s-2); margin-top: var(--s-2); }
.card__actions > * { flex: 1; }
</style>

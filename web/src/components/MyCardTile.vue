<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { compact, hueFrom } from "@/lib/format";
import { useLocalePath } from "@/lib/use-locale";
import type { MyCard } from "@/lib/api";

const props = defineProps<{ card: MyCard; busy: boolean; index?: number }>();
defineEmits<{ toggle: [] }>();

const { lp } = useLocalePath();
const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");
const delay = computed(() => `${Math.min(props.index ?? 0, 11) * 40}ms`);
</script>

<template>
  <article class="mine-tile rise" :style="{ animationDelay: delay }">
    <RouterLink :to="lp(`/cards/${card.roleId}/edit`)" class="mine-tile__frame">
      <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" loading="lazy" class="mine-tile__img" />
      <div
        v-else
        class="mine-tile__void"
        :style="{ background: `linear-gradient(155deg, hsl(${hue} 24% 26%), hsl(${(hue + 45) % 360} 20% 14%))` }"
      >
        <span class="display">{{ initial }}</span>
      </div>

      <!-- 在榜上是這頁最重要的一個位元，所以用金色標在圖上，不是塞在文字裡 -->
      <span v-if="card.registered" class="mine-tile__badge">{{ $t("mine.badge.listed") }}</span>

      <div class="mine-tile__scrim">
        <h3 class="mine-tile__name display">{{ card.name }}</h3>
        <p class="mine-tile__hook">{{ card.summary || $t("card.noSummary") }}</p>
      </div>
    </RouterLink>

    <div class="mine-tile__foot">
      <span class="mine-tile__num">{{ $t("card.talkCount", { n: compact(card.talkNum) }) }}</span>
      <!-- 工作區的操作不能藏在 hover 底下：觸控裝置根本碰不到 -->
      <div class="mine-tile__actions">
        <RouterLink class="btn btn--sm btn--ghost" :to="lp(`/cards/${card.roleId}/edit`)">{{ $t("mine.action.edit") }}</RouterLink>
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
.mine-tile { display: flex; flex-direction: column; min-width: 0; }

.mine-tile__frame {
  position: relative; display: block;
  aspect-ratio: 3 / 4; overflow: hidden;
  border-radius: var(--r-md);
  background: var(--paper-sunken);
  box-shadow: inset 0 0 0 1px var(--rule);
}
.mine-tile__img {
  width: 100%; height: 100%; object-fit: cover;
  filter: saturate(0.85) brightness(0.92);
  transition: transform var(--dur-slow) var(--ease), filter var(--dur) var(--ease);
}
.mine-tile__frame:hover .mine-tile__img { transform: scale(1.04); filter: none; }

.mine-tile__void { display: grid; place-items: center; width: 100%; height: 100%; }
.mine-tile__void span { font-size: 56px; color: rgba(255, 255, 255, 0.16); }

.mine-tile__badge {
  position: absolute; top: var(--s-2); left: var(--s-2);
  padding: 2px var(--s-3); border-radius: var(--r-pill);
  background: var(--gold); color: #100e0b;
  font-size: 11px; font-weight: 700; letter-spacing: 0.04em;
}

.mine-tile__scrim {
  position: absolute; inset: auto 0 0 0;
  padding: var(--s-6) var(--s-3) var(--s-3);
  background: linear-gradient(to top, rgba(10, 9, 8, 0.94) 22%, rgba(10, 9, 8, 0.55) 58%, transparent);
}
.mine-tile__name {
  margin: 0; font-size: 18px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.mine-tile__hook {
  margin: 2px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-dim);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.mine-tile__foot { display: grid; gap: var(--s-2); padding-top: var(--s-2); }
.mine-tile__num { font-size: 12px; color: var(--text-faint); font-variant-numeric: tabular-nums; }
.mine-tile__actions { display: flex; gap: var(--s-2); }
.mine-tile__actions > * { flex: 1; }
</style>

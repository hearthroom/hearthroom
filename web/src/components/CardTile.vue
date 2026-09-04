<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { compact, hueFrom } from "@/lib/format";
import type { CommunityCard } from "@/lib/types";

const props = defineProps<{
  card: CommunityCard;
  rank?: number;
  showTrending?: boolean;
  index?: number;
}>();

// 沒封面的卡用角色名決定色相：同一張卡永遠同一個顏色，一排佔位卡也彼此可辨。
const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");

// 錯落進場：整頁一次編排好的節奏，比到處撒微互動更有質感。上限避免長列表尾端等太久。
const delay = computed(() => `${Math.min(props.index ?? 0, 11) * 45}ms`);
</script>

<template>
  <RouterLink
    :to="`/cards/${card.roleId}`"
    class="tile rise"
    :style="{ animationDelay: delay }"
  >
    <div class="tile__frame">
      <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" loading="lazy" class="tile__img" />
      <div
        v-else
        class="tile__void"
        :style="{ background: `linear-gradient(155deg, hsl(${hue} 24% 26%), hsl(${(hue + 45) % 360} 20% 14%))` }"
      >
        <span class="display">{{ initial }}</span>
      </div>

      <!-- 名次是版面元素而不是徽章：大號襯線數字壓在圖角，像雜誌的排行頁 -->
      <span v-if="rank" class="tile__rank display" :class="{ 'tile__rank--top': rank <= 3 }">
        {{ String(rank).padStart(2, "0") }}
      </span>

      <div class="tile__scrim">
        <h3 class="tile__name display">{{ card.name }}</h3>
        <p class="tile__hook">{{ card.summary }}</p>
      </div>
    </div>

    <footer class="tile__meta">
      <span class="tile__author">{{ card.author.name }}</span>
      <span class="tile__num">
        <template v-if="showTrending && card.trending > 0">↑{{ compact(card.trending) }}</template>
        <template v-else>{{ compact(card.talkNum) }}</template>
      </span>
    </footer>
  </RouterLink>
</template>

<style scoped>
/*
 * min-width: 0 不能省。grid item 預設是 min-width: auto——不允許縮到內容寬度以下，
 * 於是裡面的 text-overflow: ellipsis 永遠不會觸發，一段長簡介就能把整格頂爆、
 * 讓整頁出現橫向捲軸。實測 600px 的容器會被撐到 1261px。
 */
.tile { display: block; min-width: 0; }

.tile__frame {
  position: relative;
  aspect-ratio: 3 / 4;
  overflow: hidden;
  border-radius: var(--r-md);
  background: var(--paper-sunken);
  /* 髮絲內框讓立繪跟紙分開，不用陰影——陰影在暗底上只會糊掉 */
  box-shadow: inset 0 0 0 1px var(--rule);
}

.tile__img {
  width: 100%; height: 100%; object-fit: cover;
  transition: transform var(--dur-slow) var(--ease), filter var(--dur) var(--ease);
  /* 預設稍微壓一點飽和，hover 才回到全彩：整面牆不會吵，滑過的那張才跳出來 */
  filter: saturate(0.82) brightness(0.9);
}
.tile:hover .tile__img { transform: scale(1.045); filter: none; }

.tile__void { width: 100%; height: 100%; display: grid; place-items: center; }
.tile__void span { font-size: 64px; color: rgba(255, 255, 255, 0.16); }

.tile__rank {
  position: absolute; top: -2px; left: 8px;
  font-size: 54px; line-height: 1;
  color: transparent;
  -webkit-text-stroke: 1px rgba(242, 236, 225, 0.55);
  pointer-events: none;
}
.tile__rank--top { color: var(--gold); -webkit-text-stroke: 0; }

.tile__scrim {
  position: absolute; inset: auto 0 0 0;
  padding: var(--s-6) var(--s-3) var(--s-3);
  background: linear-gradient(to top, rgba(10, 9, 8, 0.94) 22%, rgba(10, 9, 8, 0.55) 58%, transparent);
}
.tile__name {
  margin: 0;
  font-size: 19px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tile__hook {
  margin: 2px 0 0;
  font-size: 12.5px; line-height: 1.45; color: var(--text-dim);
  /* 簡介平時收起，hover 才展開——整面牆保持整齊，想看的那張才給資訊 */
  max-height: 0; opacity: 0; overflow: hidden;
  transition: max-height var(--dur-slow) var(--ease), opacity var(--dur) var(--ease);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical;
}
.tile:hover .tile__hook { max-height: 3.2em; opacity: 1; }

.tile__meta {
  display: flex; align-items: baseline; justify-content: space-between; gap: var(--s-2);
  padding-top: var(--s-2);
  font-size: 12px; color: var(--text-faint);
}
.tile__author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile__num { font-variant-numeric: tabular-nums; flex: none; }

@media (hover: none) {
  /* 觸控裝置沒有 hover，資訊不能藏起來 */
  .tile__img { filter: none; }
  .tile__hook { max-height: 3.2em; opacity: 1; }
}
</style>

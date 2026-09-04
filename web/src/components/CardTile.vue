<script setup lang="ts">
import { computed } from "vue";
import { RouterLink } from "vue-router";
import { compact, hueFrom } from "@/lib/format";
import { zoneLabel } from "@/lib/i18n";
import { useLocalePath } from "@/lib/use-locale";
import type { CommunityCard } from "@/lib/types";

const props = defineProps<{
  card: CommunityCard;
  rank?: number;
  showTrending?: boolean;
  /** 封面：佔 2×2 格，名字與簡介都放大。榜單第一頁的第一名才是。 */
  cover?: boolean;
  showZone?: boolean;
  index?: number;
}>();

// 沒封面的卡用角色名決定色相：同一張卡永遠同一個顏色，一排佔位卡也彼此可辨。
const { lp } = useLocalePath();
const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");

// 錯落進場：整頁一次編排好的節奏，比到處撒微互動更有質感。上限避免長列表尾端等太久。
const delay = computed(() => `${Math.min(props.index ?? 0, 11) * 45}ms`);
</script>

<template>
  <RouterLink
    :to="lp(`/cards/${card.roleId}`)"
    class="tile rise"
    :class="{ 'tile--cover': cover }"
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
      <span class="tile__author">{{ showZone ? zoneLabel(card.zone) : card.author.name }}</span>
      <span class="tile__num">
        <template v-if="showTrending && card.trending > 0">↑{{ compact(card.trending) }}</template>
        <template v-else>{{ compact(card.talkNum) }}</template>
      </span>
    </footer>
  </RouterLink>
</template>

<style scoped>
/*
 * min-width: 0 不能省。grid item 預設是 min-width: auto，會被最長的一行字撐開，
 * 名字再長也不會折行或截斷——實測 600px 的容器會被撐到 1261px。
 */
.tile { display: flex; flex-direction: column; min-width: 0; }

.tile__frame {
  position: relative; overflow: hidden;
  aspect-ratio: 3 / 4;
  border-radius: var(--r-md);
  background: var(--paper-sunken);
  box-shadow: inset 0 0 0 1px var(--rule);
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
}
.tile:hover .tile__frame {
  box-shadow: inset 0 0 0 1px var(--rule-strong), 0 14px 32px rgba(0, 0, 0, 0.45);
  transform: translateY(-2px);
}

.tile__img {
  width: 100%; height: 100%; object-fit: cover;
  /* 微降飽和，讓一牆五顏六色的立繪先安靜下來；hover 才給它全彩 */
  filter: saturate(0.85) brightness(0.92);
  transition: transform var(--dur-slow) var(--ease), filter var(--dur) var(--ease);
}
.tile:hover .tile__img { transform: scale(1.04); filter: none; }

/* 頂端一小段暗化：名次數字壓在亮色立繪上才讀得出來，也讓一牆卡片的上緣安靜一致 */
.tile__frame::before {
  content: ""; position: absolute; inset: 0 0 auto 0; height: 36%; z-index: 1;
  background: linear-gradient(to bottom, rgba(10, 9, 8, 0.62), transparent);
  pointer-events: none;
}

.tile__void { display: grid; place-items: center; width: 100%; height: 100%; }
.tile__void span { font-size: 56px; color: rgba(255, 255, 255, 0.16); }

.tile__rank {
  position: absolute; top: 2px; left: var(--s-3); z-index: 2;
  font-size: 44px; line-height: 1;
  color: transparent;
  -webkit-text-stroke: 1px rgba(242, 236, 225, 0.55);
  letter-spacing: -0.02em;
}
.tile__rank--top { color: var(--gold); -webkit-text-stroke: 0; text-shadow: 0 2px 12px rgba(0, 0, 0, 0.6); }

.tile__scrim {
  position: absolute; inset: auto 0 0 0; z-index: 1;
  padding: var(--s-6) var(--s-3) var(--s-3);
  background: linear-gradient(to top, rgba(10, 9, 8, 0.94) 22%, rgba(10, 9, 8, 0.55) 58%, transparent);
}
.tile__name {
  margin: 0; font-size: 19px; line-height: 1.15;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.tile__hook {
  margin: 3px 0 0; font-size: 12px; line-height: 1.45; color: var(--text-dim);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}

.tile__meta {
  display: flex; justify-content: space-between; gap: var(--s-3);
  padding: var(--s-2) 2px 0;
  font-size: 12px; color: var(--text-faint);
}
.tile__author { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tile__num { flex: none; font-variant-numeric: tabular-nums; }

/* ---- 封面：一區的第一名佔 2×2 格，圖填滿格子（比 3:4 高一點，object-fit 裁掉） ---- */
.tile--cover { grid-column: span 2; grid-row: span 2; }
.tile--cover .tile__frame { flex: 1 1 auto; min-height: 0; }
.tile--cover .tile__rank { font-size: 76px; top: 4px; left: var(--s-4); }
.tile--cover .tile__scrim { padding: var(--s-8) var(--s-5) var(--s-5); }
.tile--cover .tile__name { font-size: clamp(24px, 2.6vw, 34px); white-space: normal; line-height: 1.1; }
.tile--cover .tile__hook { margin-top: var(--s-2); font-size: 13.5px; line-height: 1.55; -webkit-line-clamp: 3; line-clamp: 3; }
.tile--cover .tile__meta { font-size: 13px; }
</style>

<style scoped>
/* 手機只有兩欄：封面佔滿寬度會變成一整屏的一張卡。退回普通格子，金色的 01 已經夠醒目。 */
@media (max-width: 640px) {
  .tile--cover { grid-column: auto; grid-row: auto; }
  .tile--cover .tile__frame { aspect-ratio: 3 / 4; flex: none; }
  .tile--cover .tile__rank { font-size: 44px; top: 2px; left: var(--s-3); }
  .tile--cover .tile__scrim { padding: var(--s-6) var(--s-3) var(--s-3); }
  .tile--cover .tile__name { font-size: 19px; white-space: nowrap; }
  .tile--cover .tile__hook { margin-top: 3px; font-size: 12px; line-height: 1.45; -webkit-line-clamp: 2; line-clamp: 2; }
  .tile--cover .tile__meta { font-size: 12px; }
}
</style>

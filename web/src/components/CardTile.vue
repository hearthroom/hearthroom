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
  showZone?: boolean;
}>();

// 沒封面的卡用角色名決定色相：同一張卡永遠同一個顏色，一排佔位卡也彼此可辨。
const { lp } = useLocalePath();
const hue = computed(() => hueFrom(props.card.name));
const initial = computed(() => [...props.card.name][0] ?? "?");
</script>

<template>
  <RouterLink :to="lp(`/cards/${card.roleId}`)" class="card rise">
    <div class="card__art">
      <img v-if="card.avatarUrl" :src="card.avatarUrl" :alt="card.name" loading="lazy" />
      <div
        v-else
        class="card__void"
        :style="{ background: `linear-gradient(160deg, hsl(${hue} 45% 78%), hsl(${(hue + 40) % 360} 40% 62%))` }"
      >
        <span>{{ initial }}</span>
      </div>
      <!-- 名次是個小徽章，前三名用慣例的金銀銅；不搶立繪的戲 -->
      <span v-if="rank" class="card__rank" :class="rank <= 3 && `card__rank--${rank}`">{{ rank }}</span>
    </div>

    <div class="card__body">
      <h3 class="card__name">{{ card.name }}</h3>
      <p class="card__hook">{{ card.summary || $t("card.noSummary") }}</p>
      <div class="card__meta">
        <span class="card__by">
          <template v-if="showZone">{{ zoneLabel(card.zone) }}</template>
          <template v-else>
            <img v-if="card.author.avatar" :src="card.author.avatar" alt="" class="card__face" />
            <span class="card__author">{{ card.author.name }}</span>
          </template>
        </span>
        <span class="card__num" :class="{ 'card__num--up': showTrending && card.trending > 0 }">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path d="M3 3.5h10a1.5 1.5 0 0 1 1.5 1.5v5a1.5 1.5 0 0 1-1.5 1.5H7.5L4.5 14v-2.5H3A1.5 1.5 0 0 1 1.5 10V5A1.5 1.5 0 0 1 3 3.5z" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" />
          </svg>
          <template v-if="showTrending && card.trending > 0">+{{ compact(card.trending) }}</template>
          <template v-else>{{ compact(card.talkNum) }}</template>
        </span>
      </div>
    </div>
  </RouterLink>
</template>

<style scoped>
/* min-width: 0 不能省：grid item 預設 min-width: auto，名字一長就把整欄撐開 */
.card {
  display: flex; flex-direction: column; min-width: 0;
  background: var(--surface);
  border: 1px solid var(--border); border-radius: var(--r-md);
  overflow: hidden;
  transition: box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.card:hover { box-shadow: var(--shadow-md); transform: translateY(-2px); border-color: var(--border-strong); }

.card__art { position: relative; aspect-ratio: 3 / 4; background: var(--surface-2); overflow: hidden; }
.card__art img { width: 100%; height: 100%; object-fit: cover; transition: transform var(--dur-slow) var(--ease); }
.card:hover .card__art img { transform: scale(1.03); }
.card__void { display: grid; place-items: center; width: 100%; height: 100%; }
.card__void span { font-size: 40px; font-weight: 600; color: rgba(255, 255, 255, 0.9); }

.card__rank {
  position: absolute; top: 8px; left: 8px;
  min-width: 22px; height: 22px; padding: 0 7px;
  display: inline-flex; align-items: center; justify-content: center;
  border-radius: var(--r-pill);
  background: rgba(20, 20, 28, 0.6); color: #fff;
  font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums;
  backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
}
.card__rank--1 { background: var(--gold); color: #3b2a00; }
.card__rank--2 { background: var(--silver); color: #1f2429; }
.card__rank--3 { background: var(--bronze); color: #3a2208; }

.card__body { display: grid; gap: 4px; padding: 10px 12px 12px; }
.card__name { font-size: 14.5px; font-weight: 600; line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__hook {
  font-size: 12.5px; line-height: 1.5; color: var(--text-2);
  display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
  /* 固定兩行高：一張沒簡介的卡不該讓整排的底線參差 */
  min-height: calc(12.5px * 1.5 * 2);
}
.card__meta {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-2);
  margin-top: 4px; font-size: 12px; color: var(--text-3);
}
.card__by { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
.card__face { width: 16px; height: 16px; border-radius: var(--r-pill); object-fit: cover; flex: none; }
.card__author { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.card__num { display: inline-flex; align-items: center; gap: 3px; flex: none; font-variant-numeric: tabular-nums; }
.card__num svg { width: 13px; height: 13px; }
.card__num--up { color: var(--accent); font-weight: 600; }
</style>

<script setup lang="ts">
import CardTile from "./CardTile.vue";
import type { CommunityCard } from "@/lib/types";

defineProps<{
  cards: CommunityCard[];
  /** 完全沒東西可畫時才是 loading（骨架屏）；手上有舊資料時用 busy，舊卡留在原地變淡 */
  loading?: boolean;
  busy?: boolean;
  showTrending?: boolean;
  /** 榜單模式：卡片帶名次。作者主頁這種非排名場景不給。 */
  ranked?: boolean;
  rankOffset?: number;
  /** 跨語區的清單（作者主頁）在卡片上標語言而不是作者。 */
  showZone?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
}>();

/** 首屏一排的張數上限：這幾張立刻載，其餘懶載入 */
const EAGER = 6;
</script>

<template>
  <!-- 骨架屏而不是遮罩 spinner：版面不跳動，也看得出接下來會出現什麼 -->
  <div v-if="loading" class="grid" aria-hidden="true">
    <div v-for="i in 12" :key="i" class="ghost ghost--card" />
  </div>

  <div v-else-if="!cards.length" class="empty panel">
    <p class="empty__title">{{ emptyTitle ?? $t("board.empty.title") }}</p>
    <p class="empty__hint muted">{{ emptyHint ?? $t("board.empty.hint") }}</p>
  </div>

  <div v-else class="grid" :aria-busy="busy || undefined">
    <CardTile
      v-for="(card, i) in cards"
      :key="card.id"
      :card="card"
      :rank="ranked ? (rankOffset ?? 0) + i + 1 : undefined"
      :show-zone="showZone"
      :show-trending="showTrending"
      :eager="i < EAGER"
    />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  gap: var(--s-5) var(--s-4);
  /*
   * 欄數釘死，不讓它隨寬度自動算：一頁 24 張，欄數必須整除 24，最後一列才不會缺角
   * （owner 2026-09-07：桌機自動算出 5 欄，最後一列只剩 4 張）。2／3／4／6 都整除 24；
   * 手機兩欄、平板三到四欄、桌機六欄——1080px 以上六欄每張仍有 158px 以上，名字放得下。
   */
  grid-template-columns: repeat(2, minmax(0, 1fr));
}
@media (min-width: 600px) { .grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (min-width: 820px) { .grid { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
@media (min-width: 1080px) { .grid { grid-template-columns: repeat(6, minmax(0, 1fr)); } }
.ghost--card { aspect-ratio: 3 / 5.3; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; max-width: 40ch; margin: 0 auto; }
</style>

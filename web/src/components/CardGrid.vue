<script setup lang="ts">
import CardTile from "./CardTile.vue";
import type { CommunityCard } from "@/lib/types";

defineProps<{
  cards: CommunityCard[];
  loading?: boolean;
  showTrending?: boolean;
  /** 榜單模式：卡片帶名次。作者主頁這種非排名場景不給。 */
  ranked?: boolean;
  rankOffset?: number;
  /** 跨語區的清單（作者主頁）在卡片上標語言而不是作者。 */
  showZone?: boolean;
  emptyTitle?: string;
  emptyHint?: string;
}>();
</script>

<template>
  <!-- 骨架屏而不是遮罩 spinner：版面不跳動，也看得出接下來會出現什麼 -->
  <div v-if="loading" class="grid">
    <div v-for="i in 12" :key="i" class="ghost ghost--card" />
  </div>

  <div v-else-if="!cards.length" class="empty panel">
    <p class="empty__title">{{ emptyTitle ?? $t("board.empty.title") }}</p>
    <p class="empty__hint muted">{{ emptyHint ?? $t("board.empty.hint") }}</p>
  </div>

  <div v-else class="grid">
    <CardTile
      v-for="(card, i) in cards"
      :key="card.id"
      :card="card"
      :rank="ranked ? (rankOffset ?? 0) + i + 1 : undefined"
      :show-zone="showZone"
      :show-trending="showTrending"
    />
  </div>
</template>

<style scoped>
.grid {
  display: grid;
  gap: var(--s-5) var(--s-4);
  /*
   * 手機兩欄、桌機 5～6 欄。184px 是海報＋兩行字讀起來舒服的最小寬度；
   * 再窄，名字就得截斷，簡介一行放不下幾個字。
   */
  grid-template-columns: repeat(auto-fill, minmax(clamp(140px, 40vw, 184px), 1fr));
}
.ghost--card { aspect-ratio: 3 / 5.3; }

.empty { padding: var(--s-8) var(--s-5); text-align: center; }
.empty__title { font-size: 16px; font-weight: 600; margin-bottom: var(--s-2); }
.empty__hint { font-size: 13.5px; max-width: 40ch; margin: 0 auto; }
</style>

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
  emptyTitle?: string;
  emptyHint?: string;
}>();
</script>

<template>
  <!-- 骨架屏而不是遮罩 spinner：版面不跳動，也看得出接下來會出現什麼 -->
  <div v-if="loading" class="wall">
    <div v-for="i in 12" :key="i" class="ghost" :style="{ animationDelay: `${i * 60}ms` }" />
  </div>

  <div v-else-if="!cards.length" class="empty">
    <p class="empty__title display">{{ emptyTitle ?? $t("board.empty.title") }}</p>
    <p class="empty__hint muted">{{ emptyHint ?? $t("board.empty.hint") }}</p>
  </div>

  <div v-else class="wall">
    <CardTile
      v-for="(card, i) in cards"
      :key="card.id"
      :card="card"
      :index="i"
      :rank="ranked ? (rankOffset ?? 0) + i + 1 : undefined"
      :show-trending="showTrending"
    />
  </div>
</template>

<style scoped>
.wall {
  display: grid;
  gap: var(--s-5) var(--s-4);
  /*
   * clamp 讓最小欄寬跟著視窗縮：手機上維持兩欄（單欄的巨型卡片在內容社群裡是反模式，
   * 一屏只看得到一張就沒有「牆」的感覺了），桌機上回到 178px 的舒適密度。
   */
  grid-template-columns: repeat(auto-fill, minmax(clamp(136px, 22vw, 178px), 1fr));
}

.ghost {
  aspect-ratio: 3 / 4.35;
  border-radius: var(--r-md);
  background: linear-gradient(100deg, var(--paper-raised) 30%, var(--rule) 48%, var(--paper-raised) 66%);
  background-size: 300% 100%;
  animation: sweep 1.5s var(--ease) infinite;
}
@keyframes sweep { from { background-position: 130% 0; } to { background-position: -30% 0; } }

.empty {
  padding: var(--s-8) 0;
  border-top: 1px solid var(--rule);
  text-align: center;
}
.empty__title { margin: 0 0 var(--s-2); font-size: 34px; color: var(--text-dim); }
.empty__hint { margin: 0; font-size: 14px; }
</style>

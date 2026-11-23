<script setup lang="ts">
/**
 * 卡片審核的四個清單：新卡、更新、不受理、我處理過的（審卡 V2，ui.md §1）。各自是獨立網址，
 * 深連結與搜尋參數留得住。390 寬放不下四格：沿用 .seg 橫滑，目前那格自動捲進可視範圍。
 *
 * counts：各頁的待審數（伺服器另外數，不受清單 200 筆上限影響）；還不知道就是 null，只寫名稱不寫 0。
 */
import { nextTick, onMounted, ref } from "vue";
import { RouterLink } from "vue-router";
import { useLocalePath } from "@/lib/use-locale";
import type { ReviewQueueCounts } from "@/lib/api";

const props = defineProps<{ active: "new" | "updates" | "dropped" | "history"; counts: ReviewQueueCounts | null }>();
const { lp } = useLocalePath();
const nav = ref<HTMLElement | null>(null);

const tabs = [
  { id: "new", path: "/review", key: "new" },
  { id: "updates", path: "/review/updates", key: "updates" },
  { id: "dropped", path: "/review/dropped", key: "dropped" },
] as const;

onMounted(() => void nextTick(() => nav.value?.querySelector<HTMLElement>("[aria-current=page]")?.scrollIntoView({ block: "nearest", inline: "nearest" })));
</script>

<template>
  <nav ref="nav" class="seg review-tabs" :aria-label="$t('review.queue.tab.label')">
    <RouterLink v-for="tab in tabs" :key="tab.id" class="seg__item" :class="{ 'seg__item--on': props.active === tab.id }"
      :aria-current="props.active === tab.id ? 'page' : undefined" :to="lp(tab.path)" :data-review-tab="tab.id">
      {{ counts === null ? $t(`reviewV2.tabs.${tab.key}NoCount`) : $t(`reviewV2.tabs.${tab.key}`, { n: counts[tab.id] }) }}
    </RouterLink>
    <RouterLink class="seg__item" :class="{ 'seg__item--on': props.active === 'history' }" :aria-current="props.active === 'history' ? 'page' : undefined" :to="lp('/review/decisions')" data-review-tab="history">
      {{ $t("review.history.title") }}
    </RouterLink>
  </nav>
</template>

<style scoped>
/* 放不下就整排橫滑，右緣漸層提示還有；捲動容器本身不加左右 padding（DESIGN §5） */
.review-tabs { display: inline-flex; max-width: 100%; overflow-x: auto; scrollbar-width: none; overscroll-behavior-x: contain;
  -webkit-mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent); mask-image: linear-gradient(to right, #000 calc(100% - 24px), transparent); }
.review-tabs::-webkit-scrollbar { display: none; }
.review-tabs .seg__item { flex: none; white-space: nowrap; min-height: var(--h-lg); display: inline-flex; align-items: center; text-decoration: none; }
.review-tabs .seg__item:last-child { margin-right: 20px; }
</style>

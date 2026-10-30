<script setup lang="ts">
/**
 * 公開列表與「喜愛與用過」共用的一列：名稱、作者、測試過的模型、近 7 天使用人數，右邊一顆喜愛鈕。
 * 點名稱開唯讀詳情。自己的預設不給喜愛鈕（上游不收），標一個中性的「我的」。
 */
import { computed } from "vue";
import { whole, monthDayOf } from "@/lib/format";
import type { PresetLibraryItem } from "@/lib/presets";
import { useLocalePath } from "@/lib/use-locale";
import { authorLabel, isNew, modelLabel } from "./preset-share";

const props = defineProps<{ item: PresetLibraryItem; busy?: boolean; showUsedOn?: boolean }>();
const emit = defineEmits<{ favorite: [item: PresetLibraryItem] }>();
const { lp } = useLocalePath();

/** 卡片格的慣例：前兩個，其餘「+N」 */
const models = computed(() => props.item.recommendedModels.slice(0, 2).map(modelLabel));
const moreModels = computed(() => Math.max(0, props.item.recommendedModels.length - 2));
const fresh = computed(() => isNew(props.item));
</script>

<template>
  <li class="panel share-row" data-testid="share-row">
    <RouterLink :to="lp(`/preset-library/${item.presetId}`)" class="share-row__main">
      <strong class="share-row__name">{{ item.title }}</strong>
      <span class="share-row__author">{{ authorLabel(item) }}</span>
      <span class="share-row__facts">
        <template v-if="!item.listed">
          <span class="chip share-row__chip share-row__chip--strong" data-testid="share-unlisted">{{ $t("preset.share.unlisted") }}</span>
          <span class="share-row__note">{{ $t("preset.share.unlisted.short") }}</span>
        </template>
        <span v-if="item.mine" class="chip share-row__chip">{{ $t("preset.share.tabs.mine") }}</span>
        <template v-if="item.recommendedModels.length">
          <span v-for="m in models" :key="m" class="chip share-row__chip">{{ $t("preset.share.tested", { model: m }) }}</span>
          <span v-if="moreModels" class="chip share-row__chip">+{{ whole(moreModels) }}</span>
        </template>
        <span v-else class="share-row__note">{{ $t("preset.share.untested") }}</span>
        <span v-if="fresh" class="chip share-row__chip share-row__chip--new">{{ $t("preset.share.new") }}</span>
        <span v-else-if="item.listed" class="share-row__note">{{ $t("preset.share.users7d", { n: whole(item.usesLast7d) }, item.usesLast7d) }}</span>
        <span v-if="showUsedOn && item.lastAppliedAt" class="share-row__note">{{ $t("preset.share.used.on", { date: monthDayOf(item.lastAppliedAt) }) }}</span>
      </span>
    </RouterLink>
    <button
      v-if="!item.mine" type="button" class="share-row__fav" :class="{ 'share-row__fav--on': item.favorited }"
      :aria-label="$t(item.favorited ? 'preset.share.fav.remove' : 'preset.share.fav.add')" :aria-pressed="item.favorited"
      :disabled="busy" data-testid="share-fav" @click="emit('favorite', item)"
    >
      <svg width="20" height="20" viewBox="0 0 24 24" :fill="item.favorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-9.3-9.4C1.4 7.2 3.5 4 6.8 4c2 0 3.6 1.1 5.2 3.1C13.6 5.1 15.2 4 17.2 4c3.3 0 5.4 3.2 4.1 6.6C19.5 15.4 12 20 12 20z" /></svg>
    </button>
  </li>
</template>

<style scoped>
.share-row { list-style: none; display: flex; align-items: flex-start; gap: var(--s-2); padding: var(--s-3) var(--s-2) var(--s-3) var(--s-4); }
.share-row__main { flex: 1; min-width: 0; display: grid; gap: 6px; color: inherit; text-decoration: none; }
.share-row__main:hover .share-row__name { color: var(--accent-text); }
.share-row__name { font-size: 15px; font-weight: 600; line-height: 1.4; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.share-row__author { font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.share-row__facts { display: flex; flex-wrap: wrap; align-items: center; gap: 6px var(--s-2); }
/* 模型名可能很長：chip 跟著字長高，不壓到上下行 */
.share-row__chip { height: auto; min-height: 22px; padding-block: 2px; cursor: default; overflow-wrap: anywhere; }
.share-row__chip:hover { background: var(--surface-2); color: var(--text-2); }
.share-row__chip--strong, .share-row__chip--strong:hover { background: var(--border); color: var(--text); font-weight: 500; }
.share-row__chip--new, .share-row__chip--new:hover { background: var(--accent-tint); color: var(--accent-text); font-weight: 500; }
.share-row__note { font-size: 12px; color: var(--text-3); }
.share-row__fav {
  flex: none; width: var(--h-lg); height: var(--h-lg); border-radius: var(--r-pill);
  display: flex; align-items: center; justify-content: center;
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--text-2); cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.share-row__fav:hover:not(:disabled) { color: var(--accent-text); }
.share-row__fav--on { background: var(--accent-tint); border-color: transparent; color: var(--accent-text); }
.share-row__fav:disabled { opacity: .45; cursor: not-allowed; }
</style>

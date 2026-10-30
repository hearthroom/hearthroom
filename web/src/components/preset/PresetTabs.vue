<script setup lang="ts">
/**
 * 預設區頂部三格「我的｜喜愛與用過｜預設庫」（PM 2026-10-30 資訊架構）。前兩格是「我的預設」頁的
 * 分頁（?tab=），預設庫是自己的一頁（/presets/library）；三格長得一樣，使用者不必知道其中一格換了頁。
 */
import { useLocalePath } from "@/lib/use-locale";

export type PresetTab = "mine" | "fav" | "library";
defineProps<{ current: PresetTab }>();
const { lp } = useLocalePath();
const TABS: PresetTab[] = ["mine", "fav", "library"];
/** 預設庫那格沿用 tabs.public（文案 §20：en／ja／ko 分頁用短名，其他地方用 library.name 全名） */
const LABEL: Record<PresetTab, string> = { mine: "preset.share.tabs.mine", fav: "preset.share.tabs.fav", library: "preset.share.tabs.public" };
const to = (k: PresetTab) => (k === "library" ? lp("/presets/library") : { path: lp("/me/presets"), query: k === "fav" ? { tab: "fav" } : {} });
</script>

<template>
  <nav class="seg preset-tabs" :aria-label="$t('preset.share.tabs.label')" data-testid="preset-tabs">
    <RouterLink
      v-for="k in TABS" :key="k" :to="to(k)" class="seg__item preset-tabs__tab" :class="{ 'seg__item--on': current === k }"
      :aria-current="current === k ? 'page' : undefined" :data-testid="`preset-tab-${k}`"
    >{{ $t(LABEL[k]) }}</RouterLink>
  </nav>
</template>

<style scoped>
.preset-tabs { display: flex; justify-self: stretch; }
.preset-tabs__tab { flex: 1; display: flex; align-items: center; justify-content: center; height: var(--h-md); text-decoration: none; }
</style>

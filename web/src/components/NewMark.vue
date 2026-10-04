<script setup lang="ts">
/**
 * 功能入口旁的「新」：說明上線 14 天內、讀者還沒點過這個入口就掛著，點了就收（規則在 lib/updates.ts）。
 *
 * 放在入口元素裡面當最後一個子元素；它自己聽父元素的點擊，入口元件不必改事件。
 * 圖示按鈕（鈴鐺、搜尋）用 dot：一個小點，不擠掉圖示。鍵要先登記在 shared/update-spotlights.ts。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { track } from "@/lib/track";
import { useUpdates } from "@/lib/updates";

const props = defineProps<{ k: string; dot?: boolean }>();
const store = useUpdates();
const el = ref<HTMLElement | null>(null);
const on = computed(() => store.spotlights.includes(props.k));
let host: HTMLElement | null = null;

function used() {
  if (!on.value) return;
  store.useSpotlight([props.k]);
  track("spotlight_click", { subject: props.k });
}
onMounted(() => {
  store.mount(props.k);
  host = (el.value?.parentElement?.closest("a, button") as HTMLElement | null) ?? el.value?.parentElement ?? null;
  host?.addEventListener("click", used);
});
onBeforeUnmount(() => {
  store.unmount(props.k);
  host?.removeEventListener("click", used);
});
</script>

<template>
  <span v-show="on" ref="el" class="new-mark" :class="{ 'new-mark--dot': dot }">
    <span :class="{ 'sr-only': dot }">{{ $t("updates.new") }}</span>
  </span>
</template>

<style scoped>
.new-mark {
  display: inline-flex; align-items: center; flex: none;
  margin-inline-start: var(--s-2); padding: 0 6px;
  border-radius: var(--r-pill); background: var(--accent); color: var(--on-accent);
  font-size: 10px; font-weight: 700; line-height: 16px; letter-spacing: .02em;
  vertical-align: middle;
}
.new-mark--dot {
  position: absolute; top: 5px; left: 5px; margin: 0; padding: 0;
  width: 8px; height: 8px; box-shadow: 0 0 0 2px var(--surface);
}
</style>

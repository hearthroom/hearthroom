<script setup lang="ts">
/**
 * 卡片頁的返回鈕：有站內上一頁就退回去（列表才會在原位、不重讀），沒有就照連結去 to（首頁）。
 * 只有一個點擊處理：RouterLink 自己的 navigate 和退回不能同時跑，否則會先推一筆首頁再退，
 * 落點忽前忽後（code-review 2026-11-21）。按著 Cmd／Ctrl／Shift 或中鍵點，照瀏覽器原本的開新分頁。
 */
import { RouterLink, useRouter } from "vue-router";
import { readEntry, stepsBack, type HistoryEntry } from "@/lib/card-back";

defineOptions({ inheritAttrs: false });
const props = defineProps<{ to: string; entry: HistoryEntry }>();
const router = useRouter();

function onClick(event: MouseEvent, navigate: (e?: MouseEvent) => unknown) {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const steps = stepsBack(props.entry, readEntry(window.history.state));
  if (steps === null) { void navigate(event); return; }
  event.preventDefault();
  router.go(-steps);
}
</script>

<template>
  <RouterLink v-slot="{ href, navigate }" :to="to" custom>
    <a :href="href" v-bind="$attrs" @click="onClick($event, navigate)"><slot /></a>
  </RouterLink>
</template>

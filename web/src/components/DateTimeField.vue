<script setup lang="ts">
/**
 * 日期＋時間兩格，值照 datetime-local 的寫法（YYYY-MM-DDTHH:mm），呼叫端不用改。
 * 不用 datetime-local：不支援它的瀏覽器會退回文字框，直接露出「2026-10-17T01:53」，
 * 使用者看不懂那個 T（owner 2026-10-17）。拆成 date 與 time，就算退回文字框也只是「2026-10-17」與「01:53」。
 */
import { reactive, watch } from "vue";

const props = defineProps<{ modelValue: string; id: string; disabled?: boolean; invalid?: boolean; describedby?: string; dateLabel: string; timeLabel: string }>();
const emit = defineEmits<{ "update:modelValue": [value: string] }>();

/** 兩格各自記著：連續改日期再改時間時，不必等外層把新值傳回來（不然第二格會用舊日期） */
const parts = reactive({ date: "", time: "" });
watch(() => props.modelValue, (v) => {
  const [date = "", time = ""] = (v ?? "").split("T");
  parts.date = date;
  parts.time = time.slice(0, 5);
}, { immediate: true });
function set(date: string, time: string) {
  parts.date = date;
  parts.time = time;
  emit("update:modelValue", date && time ? `${date}T${time}` : date ? `${date}T` : "");
}
</script>

<template>
  <span class="dtf">
    <input
      :id="id" class="input dtf__date" type="date" required :value="parts.date" :disabled="disabled"
      :aria-label="dateLabel" :aria-invalid="invalid || undefined" :aria-describedby="describedby"
      @input="set(($event.target as HTMLInputElement).value, parts.time)"
    />
    <input
      :id="`${id}-time`" class="input dtf__time" type="time" required :value="parts.time" :disabled="disabled"
      :aria-label="timeLabel" :aria-invalid="invalid || undefined" :aria-describedby="describedby"
      @input="set(parts.date, ($event.target as HTMLInputElement).value)"
    />
  </span>
</template>

<style scoped>
.dtf { display: inline-flex; flex-wrap: wrap; gap: var(--s-2); min-width: 0; }
.dtf__date { width: 168px; }
.dtf__time { width: 120px; }
</style>

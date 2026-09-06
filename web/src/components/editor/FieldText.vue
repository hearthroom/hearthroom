<script setup lang="ts">
/**
 * 一個有字數計數的欄位。
 *
 * 上限一律由外面傳進來，因為真正的上限跟卡片語區走，是 GET /role/validate 回來的。
 * 超過時只是把數字染紅、不擋輸入——貼一大段進去再刪，比「打到一半打不下去」好用得多，
 * 而且上游本來就會擋，前端多擋一次只會讓作者以為自己貼失敗了。
 */
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    id: string;
    label: string;
    modelValue: string;
    hint?: string;
    placeholder?: string;
    max?: number;
    rows?: number;
    required?: boolean;
  }>(),
  { rows: 0, required: false },
);

const emit = defineEmits<{ "update:modelValue": [string] }>();

const value = computed({
  get: () => props.modelValue,
  set: (next: string) => emit("update:modelValue", next),
});

const length = computed(() => [...props.modelValue].length);
const over = computed(() => Boolean(props.max) && length.value > (props.max as number));
</script>

<template>
  <div class="field">
    <label :for="id">
      {{ label }}
      <span v-if="required" class="req" aria-hidden="true">*</span>
    </label>
    <!-- min-height 照 rows 算：欄位會跟內容長高（見編輯頁的 field-sizing），rows 只剩「起始有多高」這個意思 -->
    <textarea v-if="rows > 0" :id="id" v-model="value" class="input" :rows="rows" :placeholder="placeholder"
              :style="{ minHeight: `calc(${rows} * 1.7em + 26px)` }" />
    <input v-else :id="id" v-model="value" class="input" :placeholder="placeholder" />
    <span v-if="hint || max" class="field__foot">
      <span class="subtle">{{ hint }}</span>
      <span v-if="max" class="subtle count" :class="{ over }">{{ length }} / {{ max }}</span>
    </span>
  </div>
</template>

<style scoped>
.req { color: var(--danger); margin-left: 2px; }
.count { font-variant-numeric: tabular-nums; }
.over { color: var(--danger); }
textarea.input { resize: vertical; min-height: 72px; }
</style>

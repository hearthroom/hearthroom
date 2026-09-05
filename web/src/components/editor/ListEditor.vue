<script setup lang="ts">
/**
 * 一組可增刪、可排序的多行文字。備選開場白與開場選項共用。
 *
 * 排序用上下鍵而不是拖曳：這兩處的順序有意義（開場選項的排列會影響玩家先看到哪一個），
 * 但一份清單通常只有三五條，做拖曳要處理觸控、鍵盤與讀屏三套互動，收益不成比例。
 */
const props = defineProps<{
  label: string;
  modelValue: string[];
  hint?: string;
  placeholder?: string;
  addLabel: string;
  removeLabel: string;
  upLabel: string;
  downLabel: string;
  rows?: number;
}>();

const emit = defineEmits<{ "update:modelValue": [string[]] }>();

const commit = (next: string[]) => emit("update:modelValue", next);

const update = (index: number, value: string) => {
  const next = props.modelValue.slice();
  next[index] = value;
  commit(next);
};

const add = () => commit([...props.modelValue, ""]);

const remove = (index: number) => commit(props.modelValue.filter((_, i) => i !== index));

const move = (index: number, delta: number) => {
  const to = index + delta;
  if (to < 0 || to >= props.modelValue.length) return;
  const next = props.modelValue.slice();
  [next[index], next[to]] = [next[to], next[index]];
  commit(next);
};
</script>

<template>
  <div class="field">
    <label>{{ label }}</label>
    <p v-if="hint" class="subtle hint">{{ hint }}</p>
    <ul class="rows">
      <li v-for="(item, index) in modelValue" :key="index" class="row">
        <textarea
          class="input"
          :rows="rows ?? 2"
          :value="item"
          :placeholder="placeholder"
          :aria-label="`${label} ${index + 1}`"
          @input="update(index, ($event.target as HTMLTextAreaElement).value)"
        />
        <div class="tools">
          <button type="button" class="btn btn--icon btn--sm" :title="upLabel" :aria-label="upLabel"
                  :disabled="index === 0" @click="move(index, -1)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 19V5M6 11l6-6 6 6" />
            </svg>
          </button>
          <button type="button" class="btn btn--icon btn--sm" :title="downLabel" :aria-label="downLabel"
                  :disabled="index === modelValue.length - 1" @click="move(index, 1)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 5v14M18 13l-6 6-6-6" />
            </svg>
          </button>
          <button type="button" class="btn btn--icon btn--sm btn--danger" :title="removeLabel" :aria-label="removeLabel"
                  @click="remove(index)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.7"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M5 7h14M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
            </svg>
          </button>
        </div>
      </li>
    </ul>
    <button type="button" class="btn btn--sm" @click="add">{{ addLabel }}</button>
  </div>
</template>

<style scoped>
.hint { margin: 0 0 var(--s-2); }
.rows { list-style: none; margin: 0 0 var(--s-2); padding: 0; display: grid; gap: var(--s-2); }
.row { display: flex; gap: var(--s-2); align-items: flex-start; }
.row .input { flex: 1; resize: vertical; }
.tools { display: flex; flex-direction: column; gap: 4px; }
</style>

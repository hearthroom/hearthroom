<script setup lang="ts">
/**
 * 頭像／背景。選檔後立刻上傳，欄位存的是上傳回來的網址。
 *
 * 為什麼不等到按儲存才傳：建立中的卡還沒有 id，而上傳本來就不需要 id；等到儲存時再傳，
 * 一次儲存就變成「傳兩張圖 + 寫一次卡」的複合操作，中間任何一步失敗都會留下半成品。
 * 先傳完拿到網址，儲存就退回成一次單純的文字寫入。
 */
import { ref } from "vue";

const props = defineProps<{
  label: string;
  modelValue: string;
  hint?: string;
  pickLabel: string;
  clearLabel: string;
  uploading: string;
  ratio?: "square" | "wide";
}>();

const emit = defineEmits<{
  "update:modelValue": [string];
  pick: [File, (url: string) => void, (message: string) => void];
}>();

const input = ref<HTMLInputElement | null>(null);
const busy = ref(false);
const error = ref("");

function choose(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  // input 的 value 要清掉，不然選同一個檔第二次不會觸發 change
  (event.target as HTMLInputElement).value = "";
  if (!file) return;
  busy.value = true;
  error.value = "";
  emit(
    "pick",
    file,
    (url) => {
      emit("update:modelValue", url);
      busy.value = false;
    },
    (message) => {
      error.value = message;
      busy.value = false;
    },
  );
}
</script>

<template>
  <div class="field">
    <label>{{ label }}</label>
    <div class="shell">
      <div class="frame" :class="`frame--${ratio ?? 'square'}`">
        <img v-if="modelValue" :src="modelValue" alt="" />
        <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
             stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="ph">
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="9" cy="10" r="1.6" />
          <path d="M4 17l4.5-4.5 3 3L15 12l5 5" />
        </svg>
      </div>
      <div class="side">
        <p v-if="hint" class="subtle">{{ hint }}</p>
        <div class="acts">
          <button type="button" class="btn btn--sm" :disabled="busy" @click="input?.click()">
            {{ busy ? uploading : pickLabel }}
          </button>
          <button v-if="modelValue" type="button" class="btn btn--sm btn--ghost" :disabled="busy"
                  @click="emit('update:modelValue', '')">
            {{ clearLabel }}
          </button>
        </div>
        <p v-if="error" class="subtle err" role="alert">{{ error }}</p>
      </div>
    </div>
    <input ref="input" type="file" accept="image/png,image/jpeg,image/webp" class="sr-only" @change="choose" />
  </div>
</template>

<style scoped>
.shell { display: flex; gap: var(--s-3); align-items: flex-start; }
.frame {
  flex: none; border: 1px solid var(--line); border-radius: var(--r-md);
  background: var(--surface-2); overflow: hidden; display: grid; place-items: center; color: var(--text-3);
}
.frame--square { width: 96px; height: 96px; }
.frame--wide { width: 160px; height: 96px; }
.frame img { width: 100%; height: 100%; object-fit: cover; display: block; }
.ph { width: 28px; height: 28px; }
.side { display: grid; gap: var(--s-2); align-content: start; }
.acts { display: flex; gap: var(--s-2); }
.err { color: var(--danger); }
</style>

<script setup lang="ts">
/**
 * 「用工具回覆」：玩家明確打開才用綺夢社自己的回覆工具（整段生成後才顯示）。匯入時一律關著；
 * 來源預設靠酒館擴充功能用工具回覆時只提示（打開後就收起），不替玩家打開。匯入報告與編輯頁共用。
 * 打開後列出工具格式，讓玩家能在提示詞裡要求 AI 照這個格式呼叫；格式只從上游來，這裡不另寫一份。
 */
import { computed, onBeforeUnmount, ref } from "vue";
import type { ReplyTool } from "@/lib/presets";

const props = defineProps<{ enabled: boolean; detected?: boolean; disabled?: boolean; tool?: ReplyTool }>();
const emit = defineEmits<{ change: [value: boolean] }>();
const id = `tool-reply-${Math.random().toString(36).slice(2)}`;

const params = computed(() => Object.entries(props.tool?.parameters.properties ?? {}).map(([name, p]) => ({ name, description: p?.description ?? "" })));
const example = computed(() => (props.tool ? JSON.stringify(props.tool.example, null, 2) : ""));
const copied = ref(false);
const pre = ref<HTMLElement | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
async function copy() {
  const t = props.tool;
  if (!t) return;
  // 整塊：工具名、說明、參數、示例，原樣
  try {
    await navigator.clipboard.writeText(JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters, example: t.example }, null, 2));
  } catch {
    // 瀏覽器不給寫剪貼簿：把示例選起來，讓玩家自己複製
    if (pre.value) getSelection()?.selectAllChildren(pre.value);
    return;
  }
  copied.value = true;
  clearTimeout(timer);
  timer = setTimeout(() => { copied.value = false; }, 2000);
}
onBeforeUnmount(() => clearTimeout(timer));
</script>

<template>
  <div class="tool-reply" data-testid="preset-tool-reply">
    <label class="tool-reply__row">
      <input type="checkbox" :checked="enabled" :disabled="disabled" :aria-describedby="id" data-testid="preset-tool-reply-toggle"
        @change="emit('change', ($event.target as HTMLInputElement).checked)" />
      <span class="tool-reply__label">{{ $t("preset.toolReply.label") }}</span>
    </label>
    <p :id="id" class="subtle tool-reply__hint">{{ $t("preset.toolReply.hint") }}</p>
    <p v-if="detected && !enabled" class="notice tool-reply__detected" data-testid="preset-tool-reply-detected">{{ $t("preset.toolReply.detected") }}</p>
    <div v-if="enabled && tool" class="tool-reply__format" data-testid="preset-tool-format">
      <div class="tool-reply__formatHead">
        <h3>{{ $t("preset.toolReply.format.title") }}</h3>
        <button type="button" class="btn btn--sm" :aria-label="$t('preset.toolReply.format.copyLabel')" data-testid="preset-tool-format-copy" @click="copy">
          {{ copied ? $t("me.copied") : $t("me.copy") }}
        </button>
      </div>
      <p class="subtle">{{ $t("preset.toolReply.format.hint") }}</p>
      <dl class="tool-reply__params">
        <dt><code>{{ tool.name }}</code></dt>
        <template v-for="p in params" :key="p.name">
          <dt><code>{{ p.name }}</code></dt>
          <dd>{{ p.description }}</dd>
        </template>
      </dl>
      <pre ref="pre" class="tool-reply__example"><code>{{ example }}</code></pre>
    </div>
  </div>
</template>

<style scoped>
.tool-reply { display: grid; gap: var(--s-1); }
.tool-reply__row { display: inline-flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); cursor: pointer; justify-self: start; }
/* 跟條目列的勾選框同一個樣子 */
.tool-reply__row input { width: 18px; height: 18px; margin: 0; flex-shrink: 0; accent-color: var(--accent); cursor: pointer; }
.tool-reply__label { font-weight: 600; }
.tool-reply__hint { margin: 0 0 0 26px; font-size: 13px; text-wrap: pretty; }
.tool-reply__detected { margin: var(--s-1) 0 0; text-wrap: pretty; }
.tool-reply__format { margin: var(--s-2) 0 0 26px; padding: var(--s-3); border: 1px solid var(--line); border-radius: var(--r-md); display: grid; gap: var(--s-2); min-width: 0; }
.tool-reply__formatHead { display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); }
.tool-reply__formatHead h3 { margin: 0; font-size: 14px; }
.tool-reply__formatHead .btn { min-height: var(--h-lg); }
.tool-reply__format p { margin: 0; font-size: 13px; text-wrap: pretty; }
.tool-reply__params { margin: 0; display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: var(--s-1) var(--s-3); font-size: 13px; }
.tool-reply__params > dt:first-child { grid-column: 1 / -1; }
.tool-reply__params dd { margin: 0; color: var(--text-2); overflow-wrap: anywhere; }
.tool-reply__example { margin: 0; padding: var(--s-2) var(--s-3); border-radius: var(--r-sm); background: var(--surface-2); font-size: 12px; overflow-x: auto; white-space: pre; }
</style>

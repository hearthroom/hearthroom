<script setup lang="ts">
/**
 * 分類與玩法：跟榜單同一份固定目錄（shared/tag-catalog，照魅魔島、去掉「類NTR」），全部鋪開。
 *
 * 籤名照介面語言顯示；落到卡上的字用**卡片語言**——讀這張卡的人看到的是卡片語言的標籤，
 * 榜單過濾對五種語言的名字都認，所以哪一種都對得上。卡上已經有任一語言的名字，籤就亮起；
 * 再點一下拿掉的是卡上原本那個字，不是換成另一種語言。
 */
import { computed, ref, useId } from "vue";
import { countPresetTags, TAG_CATALOG, tagLabel, type TagEntry } from "../../../../shared/tag-catalog";
import { useLocalePath } from "@/lib/use-locale";

const props = withDefaults(
  defineProps<{ selected: string[]; language: string; max: number; required?: boolean; prompted?: boolean; forceAlert?: boolean }>(),
  { required: false, prompted: false, forceAlert: false },
);
const emit = defineEmits<{ toggle: [string]; editCustom: [] }>();

const { locale } = useLocalePath();
const hintId = useId();
const rootEl = ref<HTMLElement | null>(null);
const editCustomBtn = ref<HTMLButtonElement | null>(null);

/** 卡上跟這個籤對得上的那個字；沒有就是 undefined。 */
const pickedName = (entry: TagEntry) => Object.values(entry.names).find((name) => props.selected.includes(name));
const full = computed(() => props.selected.length >= props.max);
const presetCount = computed(() => countPresetTags(props.selected));
const blockedByFull = computed(() => props.required && full.value && presetCount.value === 0);
const alerted = computed(() => Boolean(props.required && props.prompted && (presetCount.value === 0 || props.forceAlert)));

function toggle(entry: TagEntry) {
  emit("toggle", pickedName(entry) ?? tagLabel(entry, props.language));
}

function focusFirst() {
  if (blockedByFull.value && editCustomBtn.value) {
    editCustomBtn.value.focus();
    return;
  }
  rootEl.value?.querySelector<HTMLButtonElement>(".chip:not(:disabled)")?.focus();
}

defineExpose({ focusFirst });
</script>

<template>
  <div ref="rootEl" class="picker" :role="required ? 'group' : undefined" :aria-label="required ? $t('editor.tags.pick') : undefined"
       :aria-describedby="required ? hintId : undefined">
    <p class="eyebrow">{{ $t("editor.tags.pick") }}</p>
    <div v-if="blockedByFull" class="picker__full">
      <span :id="hintId" class="picker__hint" :class="{ 'is-alert': alerted }" :role="alerted ? 'alert' : undefined">{{ $t("editor.tags.pickFull") }}</span>
      <button ref="editCustomBtn" type="button" class="btn btn--sm" @click="emit('editCustom')">{{ $t("editor.tags.pickFullAction") }}</button>
    </div>
    <p v-else-if="required" :id="hintId" class="picker__hint" :class="{ 'is-alert': alerted }" :role="alerted ? 'alert' : undefined">
      {{ $t("editor.tags.pickHint") }}
    </p>
    <ul class="picker__tags" :class="{ 'picker__tags--danger': alerted }">
      <li v-for="entry in TAG_CATALOG" :key="entry.key">
        <button type="button" class="chip" :class="{ 'chip--on': Boolean(pickedName(entry)) }" :aria-pressed="Boolean(pickedName(entry))"
                :disabled="!pickedName(entry) && full" @click="toggle(entry)">
          {{ tagLabel(entry, locale) }}
        </button>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.picker { display: grid; gap: var(--s-2); }
.picker .eyebrow { margin: 0; }
.picker__hint { margin: 0; font-size: 13px; line-height: 1.5; color: var(--text-2); }
.picker__hint.is-alert { color: var(--danger); }
.picker__full { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--s-2); }
.picker__full .picker__hint { flex: 1 1 200px; min-width: 0; }
:lang(ko) .picker__hint { word-break: keep-all; }
:lang(ja) .picker__hint { word-break: auto-phrase; }
.picker__tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.picker__tags--danger {
  padding: var(--s-2);
  border-radius: var(--r-md);
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--danger) 45%, transparent);
}
.picker__tags .chip { min-height: var(--h-sm); cursor: pointer; }
.chip--on { background: var(--accent-tint); color: var(--accent-text); box-shadow: inset 0 0 0 1px var(--accent); }
.picker__tags .chip:disabled { opacity: 0.45; cursor: not-allowed; }
</style>

<script setup lang="ts">
/**
 * 分類與玩法：跟榜單同一份固定目錄（shared/tag-catalog，照魅魔島、去掉「類NTR」），全部鋪開。
 *
 * 籤名照介面語言顯示；落到卡上的字用**卡片語言**——讀這張卡的人看到的是卡片語言的標籤，
 * 榜單過濾對五種語言的名字都認，所以哪一種都對得上。卡上已經有任一語言的名字，籤就亮起；
 * 再點一下拿掉的是卡上原本那個字，不是換成另一種語言。
 */
import { computed } from "vue";
import { TAG_CATALOG, tagLabel, type TagEntry } from "../../../../shared/tag-catalog";
import { useLocalePath } from "@/lib/use-locale";

const props = defineProps<{ selected: string[]; language: string; max: number }>();
const emit = defineEmits<{ toggle: [string] }>();

const { locale } = useLocalePath();

/** 卡上跟這個籤對得上的那個字；沒有就是 undefined。 */
const pickedName = (entry: TagEntry) => Object.values(entry.names).find((name) => props.selected.includes(name));
const full = computed(() => props.selected.length >= props.max);

function toggle(entry: TagEntry) {
  emit("toggle", pickedName(entry) ?? tagLabel(entry, props.language));
}
</script>

<template>
  <div class="picker">
    <p class="eyebrow">{{ $t("editor.tags.pick") }}</p>
    <ul class="picker__tags">
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
.picker__tags { list-style: none; margin: 0; padding: 0; display: flex; flex-wrap: wrap; gap: 6px; }
.chip--on { background: var(--accent-tint); color: var(--accent-text); box-shadow: inset 0 0 0 1px var(--accent); }
.chip:disabled { opacity: 0.45; cursor: not-allowed; }
</style>

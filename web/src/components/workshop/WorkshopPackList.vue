<script setup lang="ts" generic="T extends { id: string }">
import { computed, ref, watch } from "vue";

const props = withDefaults(defineProps<{
  items: readonly T[];
  label: string;
  rowHeight?: number;
  resetOn?: string;
}>(), { rowHeight: 56, resetOn: "" });

const viewport = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const visibleRows = 5;
const overscan = 3;
const first = computed(() => Math.max(0, Math.floor(scrollTop.value / props.rowHeight) - overscan));
const last = computed(() => Math.min(props.items.length, first.value + visibleRows + overscan * 2));
const windowItems = computed(() => props.items.slice(first.value, last.value));

watch(() => [props.items.length, props.resetOn], () => {
  if (viewport.value) viewport.value.scrollTop = 0;
  scrollTop.value = 0;
});
</script>

<template>
  <div ref="viewport" class="pack-list__viewport" :aria-label="label" role="region" tabindex="0"
       :style="{ maxHeight: `${visibleRows * rowHeight}px` }"
       @scroll="scrollTop = ($event.target as HTMLElement).scrollTop">
    <ul class="pack-list">
      <li v-if="first" aria-hidden="true" :style="{ height: `${first * rowHeight}px` }" />
      <li v-for="(item, index) in windowItems" :key="item.id" class="pack-list__row" :style="{ height: `${rowHeight}px` }"
          :aria-posinset="first + index + 1" :aria-setsize="items.length">
        <slot :item="item" />
      </li>
      <li v-if="last < items.length" aria-hidden="true" :style="{ height: `${(items.length - last) * rowHeight}px` }" />
    </ul>
  </div>
</template>

<style scoped>
.pack-list__viewport { overflow-y: auto; overscroll-behavior: contain; min-width: 0; }
.pack-list { list-style: none; margin: 0; padding: 0; }
.pack-list__row { overflow: hidden; }
.pack-list__row + .pack-list__row { border-top: 1px solid var(--line); }
</style>

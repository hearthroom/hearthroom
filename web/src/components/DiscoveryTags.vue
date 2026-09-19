<script setup lang="ts">
import { computed } from "vue";
import { TAG_CATALOG, tagLabel, type TagEntry } from "../../../shared/tag-catalog";
import { visibleCatalog } from "@/lib/hidden-tags";
import { useLocalePath } from "@/lib/use-locale";
import { toggleTag } from "@/lib/discovery";
const props = withDefaults(defineProps<{ selected: string[]; hidden?: string[]; scroll?: boolean }>(), { hidden: () => [], scroll: false });
const emit = defineEmits<{ change: [tags: string[]] }>();
const { locale, lp } = useLocalePath();
const matches = (entry: TagEntry, tag: string) => entry.key === tag || Object.values(entry.names).includes(tag);
const active = (entry: TagEntry) => props.selected.some(tag => matches(entry, tag));
const catalog = computed(() => visibleCatalog(TAG_CATALOG, props.hidden, TAG_CATALOG.filter(active).map(x => x.key)));
const extras = computed(() => props.selected.filter(tag => !TAG_CATALOG.some(x => matches(x, tag))));
function toggle(entry: TagEntry) {
  emit('change', active(entry) ? props.selected.filter(tag => !matches(entry, tag)) : [...props.selected, entry.key]);
}
</script>
<template>
  <nav class="discovery-tags" :class="{ 'discovery-tags--scroll': scroll }" :aria-label="$t('board.tags')">
    <div class="discovery-tags__inner">
      <button type="button" class="tagchip" :class="{ 'is-on': !selected.length }" :aria-pressed="!selected.length" @click="emit('change', [])">{{ $t('board.tag.all') }}</button>
      <button v-for="x in catalog" :key="x.key" type="button" class="tagchip" :class="{ 'is-on': active(x) }" :aria-pressed="active(x)" @click="toggle(x)">{{ tagLabel(x, locale) }}</button>
      <button v-for="tag in extras" :key="tag" type="button" class="tagchip is-on" aria-pressed="true" @click="emit('change', toggleTag(selected, tag))">{{ tag }}</button>
      <RouterLink v-if="hidden.length" :to="lp('/settings') + '#hidden'" class="tagchip tagchip--hidden">{{ $t('board.hidden', { n: hidden.length }) }}</RouterLink>
    </div>
  </nav>
</template>
<style scoped>
.discovery-tags { margin-bottom: var(--s-4); }
.discovery-tags__inner { display: flex; flex-wrap: wrap; gap: var(--s-2); padding-block: var(--s-1); }
.tagchip { display: inline-flex; align-items: center; justify-content: center; min-height: var(--h-sm); padding: var(--s-1) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--surface); color: var(--text-2); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.tagchip:hover { border-color: var(--line-strong); color: var(--text); }
.tagchip.is-on { background: var(--text); color: var(--surface); border-color: transparent; }
.tagchip--hidden { border-style: dashed; text-decoration: none; }
@media (max-width: 640px) {
  .tagchip { min-height: var(--h-lg); }
  .discovery-tags--scroll { overflow-x: auto; margin-inline: calc(-1 * var(--s-4)); }
  .discovery-tags--scroll .discovery-tags__inner { flex-wrap: nowrap; width: max-content; padding-inline: var(--s-4); }
}
</style>

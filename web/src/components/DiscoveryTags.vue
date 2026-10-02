<script setup lang="ts">
import { computed, ref } from "vue";
import { TAG_CATALOG, tagLabel, type TagEntry } from "../../../shared/tag-catalog";
import { visibleCatalog } from "@/lib/hidden-tags";
import { useLocalePath } from "@/lib/use-locale";
import { useMediaQuery } from "@/lib/use-media";
import { toggleTag } from "@/lib/discovery";
/**
 * collapsible：窄螢幕（≤640px）收成兩行，右上一顆鈕展開／收合。52 顆籤每顆 44px 高，全攤開要八九行，首屏就沒有卡了；
 * 橫滑只看得到前四顆、後面的人不知道還有（成員意見，owner 2026-10-02）。有選中的籤時一律展開——看不到自己開了什麼篩選就關不掉。
 * 寬螢幕不管這個旗標，照舊全部攤開。搜尋頁不帶旗標：那裡的籤列在篩選面板裡，本來就是點開才看的。
 */
const props = withDefaults(defineProps<{ selected: string[]; hidden?: string[]; collapsible?: boolean }>(), { hidden: () => [], collapsible: false });
const emit = defineEmits<{ change: [tags: string[]] }>();
const { locale, lp } = useLocalePath();
const matches = (entry: TagEntry, tag: string) => entry.key === tag || Object.values(entry.names).includes(tag);
const active = (entry: TagEntry) => props.selected.some(tag => matches(entry, tag));
const catalog = computed(() => visibleCatalog(TAG_CATALOG, props.hidden, TAG_CATALOG.filter(active).map(x => x.key)));
const extras = computed(() => props.selected.filter(tag => !TAG_CATALOG.some(x => matches(x, tag))));
const narrow = useMediaQuery("(max-width: 640px)");
const expanded = ref(false);
/** 窄螢幕上的收合機關開不開：寬螢幕沒有這回事 */
const folding = computed(() => props.collapsible && narrow.value);
const collapsed = computed(() => folding.value && !expanded.value && !props.selected.length);
function toggle(entry: TagEntry) {
  emit('change', active(entry) ? props.selected.filter(tag => !matches(entry, tag)) : [...props.selected, entry.key]);
}
</script>
<template>
  <nav class="discovery-tags" :class="{ 'discovery-tags--collapsed': collapsed }" :aria-label="$t('board.tags')">
    <div v-if="folding" class="discovery-tags__head">
      <span class="discovery-tags__label">
        {{ $t('board.tags') }}
        <template v-if="hidden.length"> · <RouterLink :to="lp('/settings') + '#hidden'" class="discovery-tags__hidden">{{ $t('board.hidden', { n: hidden.length }) }}</RouterLink></template>
      </span>
      <!-- 有選中的籤時清單被撐開，收合鈕沒有事可做，就不畫：一顆按不下去的灰鈕只會讓人猜 -->
      <button v-if="!selected.length" type="button" class="tagchip discovery-tags__toggle" :aria-expanded="!collapsed" aria-controls="discovery-tags-list" @click="expanded = !expanded">
        {{ collapsed ? $t('board.tags.expand', { n: catalog.length }) : $t('board.tags.collapse') }}
        <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </button>
    </div>
    <div id="discovery-tags-list" class="discovery-tags__inner">
      <button type="button" class="tagchip" :class="{ 'is-on': !selected.length }" :aria-pressed="!selected.length" @click="emit('change', [])">{{ $t('board.tag.all') }}</button>
      <button v-for="x in catalog" :key="x.key" type="button" class="tagchip" :class="{ 'is-on': active(x) }" :aria-pressed="active(x)" @click="toggle(x)">{{ tagLabel(x, locale) }}</button>
      <button v-for="tag in extras" :key="tag" type="button" class="tagchip is-on" aria-pressed="true" @click="emit('change', toggleTag(selected, tag))">{{ tag }}</button>
      <RouterLink v-if="hidden.length && !folding" :to="lp('/settings') + '#hidden'" class="tagchip tagchip--hidden">{{ $t('board.hidden', { n: hidden.length }) }}</RouterLink>
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
.discovery-tags__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-lg); }
.discovery-tags__label { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); }
.discovery-tags__hidden { font-weight: 500; text-decoration: underline dashed; text-underline-offset: 3px; }
.discovery-tags__toggle { gap: 4px; min-height: var(--h-sm); padding-block: 0; border-style: dashed; color: var(--text-3); }
.discovery-tags__toggle svg { width: 12px; height: 12px; transition: transform var(--dur) var(--ease); }
.discovery-tags__toggle[aria-expanded="true"] svg { transform: rotate(180deg); }
@media (max-width: 640px) {
  .tagchip { min-height: var(--h-lg); }
  /* 收合＝兩行籤（44 ＋ 8 ＋ 44）加上下 4px 的內距；第三行從邊緣被切掉，看得出下面還有 */
  .discovery-tags--collapsed .discovery-tags__inner { max-height: 104px; overflow: hidden; }
}
</style>

<script setup lang="ts">
import { computed, ref } from "vue";
import { TAG_CATALOG, TAG_GROUPS, tagGroupOf, tagLabel, type TagEntry, type TagGroup } from "../../../shared/tag-catalog";
import { visibleCatalog } from "@/lib/hidden-tags";
import { useLocalePath } from "@/lib/use-locale";
import { useMediaQuery } from "@/lib/use-media";
import { toggleTag } from "@/lib/discovery";
/**
 * 類型照目錄分成四組（玩法、題材、角色、偏好），每組一行、前面標組名。
 *
 * collapsible（首頁）：預設只攤開前兩組，角色與偏好收進「更多類型」——52 顆全攤開佔掉半屏（2026-10-11）。
 * 窄螢幕（≤640px）再收成兩行，右上一顆鈕展開／收合：每顆籤 44px 高，全攤開要八九行，首屏就沒有卡了；
 * 橫滑只看得到前四顆、後面的人不知道還有（成員意見，owner 2026-10-02）。
 * 有選中的籤時一律展開——看不到自己開了什麼篩選就關不掉。收起來的組只是不顯示，籤仍在文件裡。
 * 搜尋頁不帶旗標：那裡的籤列在篩選面板裡，本來就是點開才看的，四組全攤開。
 *
 * counts：每顆籤後面的張數（再加上這一類會剩幾張）；0 張的變灰、點不下去，已選中的照樣點得掉。沒給就不標。
 */
const props = withDefaults(defineProps<{ selected: string[]; hidden?: string[]; collapsible?: boolean; counts?: Record<string, number> | null }>(), { hidden: () => [], collapsible: false, counts: null });
const emit = defineEmits<{ change: [tags: string[]] }>();
const { locale, lp } = useLocalePath();
const matches = (entry: TagEntry, tag: string) => entry.key === tag || Object.values(entry.names).includes(tag);
const active = (entry: TagEntry) => props.selected.some(tag => matches(entry, tag));
const empty = (entry: TagEntry) => !!props.counts && (props.counts[entry.key] ?? 0) === 0 && !active(entry);
const catalog = computed(() => visibleCatalog(TAG_CATALOG, props.hidden, TAG_CATALOG.filter(active).map(x => x.key)));
const extras = computed(() => props.selected.filter(tag => !TAG_CATALOG.some(x => matches(x, tag))));
/** 首頁預設攤開的組；其餘收進「更多類型」 */
const OPEN_GROUPS: TagGroup[] = ["play", "setting"];
const groups = computed(() => TAG_GROUPS.map(group => ({ group, entries: catalog.value.filter(x => tagGroupOf(x.key) === group) })).filter(g => g.entries.length));
const narrow = useMediaQuery("(max-width: 640px)");
const expanded = ref(false);
/** 窄螢幕上的收合機關開不開：寬螢幕沒有這回事 */
const folding = computed(() => props.collapsible && narrow.value);
const collapsed = computed(() => folding.value && !expanded.value && !props.selected.length);
const foldedCount = computed(() => groups.value.filter(g => !OPEN_GROUPS.includes(g.group)).reduce((n, g) => n + g.entries.length, 0));
const canFold = computed(() => props.collapsible && foldedCount.value > 0);
/** 收起來的組裡有選中的籤：整個展開，這時收合鈕沒有事可做，不畫 */
const forced = computed(() => groups.value.some(g => !OPEN_GROUPS.includes(g.group) && g.entries.some(active)));
const open = computed(() => !props.collapsible || expanded.value || forced.value);
const folded = (group: TagGroup) => !open.value && !OPEN_GROUPS.includes(group);
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
      <div class="discovery-tags__row">
        <button type="button" class="tagchip" :class="{ 'is-on': !selected.length }" :aria-pressed="!selected.length" @click="emit('change', [])">{{ $t('board.tag.all') }}</button>
        <button v-for="tag in extras" :key="tag" type="button" class="tagchip is-on" aria-pressed="true" @click="emit('change', toggleTag(selected, tag))">{{ tag }}</button>
      </div>
      <div v-for="g in groups" v-show="!folded(g.group)" :key="g.group" class="discovery-tags__row" :data-group="g.group">
        <span class="discovery-tags__group">{{ $t(`board.tagGroup.${g.group}`) }}</span>
        <button v-for="x in g.entries" :key="x.key" type="button" class="tagchip" :class="{ 'is-on': active(x), 'is-empty': empty(x) }" :aria-pressed="active(x)" :disabled="empty(x)" @click="toggle(x)">
          <span class="tagchip__label">{{ tagLabel(x, locale) }}</span>
          <span v-if="counts" class="tagchip__n">{{ counts[x.key] ?? 0 }}</span>
        </button>
      </div>
      <div v-if="!folding && ((canFold && !forced) || hidden.length)" class="discovery-tags__row discovery-tags__tail">
        <button v-if="canFold && !forced" type="button" class="tagchip discovery-tags__more" :aria-expanded="open" aria-controls="discovery-tags-list" @click="expanded = !expanded">
          {{ open ? $t('board.tags.collapse') : $t('board.tags.more', { n: foldedCount }) }}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <RouterLink v-if="hidden.length" :to="lp('/settings') + '#hidden'" class="tagchip tagchip--hidden">{{ $t('board.hidden', { n: hidden.length }) }}</RouterLink>
      </div>
    </div>
  </nav>
</template>
<style scoped>
.discovery-tags { margin-bottom: var(--s-4); }
.discovery-tags__inner { display: grid; gap: var(--s-2); padding-block: var(--s-1); }
.discovery-tags__row { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
/* 組名跟籤同一行：寬螢幕固定寬度讓每組的第一顆籤對齊；窄螢幕自己佔一點就好 */
.discovery-tags__group { min-width: 3.5em; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); }
.tagchip { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--h-sm); padding: var(--s-1) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--surface); color: var(--text-2); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.tagchip:hover { border-color: var(--line-strong); color: var(--text); }
.tagchip.is-on { background: var(--text); color: var(--surface); border-color: transparent; }
.tagchip__n { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.tagchip.is-on .tagchip__n { color: inherit; opacity: 0.7; }
/* 0 張：點下去只會是空榜，變灰、不能點 */
.tagchip.is-empty, .tagchip.is-empty:hover { opacity: 0.45; border-color: var(--line); color: var(--text-2); cursor: default; }
.tagchip--hidden { border-style: dashed; text-decoration: none; }
.discovery-tags__head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-lg); }
.discovery-tags__label { font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); }
.discovery-tags__hidden { font-weight: 500; text-decoration: underline dashed; text-underline-offset: 3px; }
.discovery-tags__toggle, .discovery-tags__more { gap: 4px; min-height: var(--h-sm); padding-block: 0; border-style: dashed; color: var(--text-3); }
.discovery-tags__toggle svg, .discovery-tags__more svg { width: 12px; height: 12px; transition: transform var(--dur) var(--ease); }
.discovery-tags__toggle[aria-expanded="true"] svg, .discovery-tags__more[aria-expanded="true"] svg { transform: rotate(180deg); }
/* 籤的高度各寬度一致（30px）：窄螢幕原本撐到 44px，字四周留白太多、一顆顆顯得胖，跟橫放時判若兩物（owner 2026-10-03） */
@media (max-width: 640px) {
  .discovery-tags__group { min-width: 0; }
  /* 收合＝「全部」那行加玩法的兩行籤（3 × 30 ＋ 2 × 8）加上下 4px 的內距；下一行從邊緣被切掉，看得出下面還有 */
  .discovery-tags--collapsed .discovery-tags__inner { max-height: 114px; overflow: hidden; }
}
</style>

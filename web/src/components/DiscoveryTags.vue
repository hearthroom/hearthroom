<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import { TAG_CATALOG, TAG_GROUPS, tagGroupOf, tagLabel, type TagEntry } from "../../../shared/tag-catalog";
import { visibleCatalog } from "@/lib/hidden-tags";
import { useLocalePath } from "@/lib/use-locale";
/**
 * 類型照目錄分成四組（玩法、題材、角色、偏好）。
 *
 * 攤開的清單（首頁寬螢幕、搜尋頁的篩選面板）：組名一欄、籤一欄，籤擠不下就在自己那一欄裡換行，
 * 四組的第一顆籤對齊在同一條線上。組名跟籤同一個 flex 流時，換行的籤會折到組名底下、組名寬度又隨語言變，
 * 站方說「完全不對齊，分類標題和分類按鈕混在一起」（2026-11-02）。
 * 窄螢幕（≤640px）一欄放不下組名加長籤，組名改放在籤的上方。
 *
 * popover（首頁窄螢幕）：只畫一顆「類型」鈕，點開浮層列出全部分類；選中的籤攤在鈕旁邊，點一下就拿掉。
 * 先前手機上每組一列橫捲、籤 44px 高，四列佔掉半屏、每列只看得到兩三顆（站方 2026-11-02：「這樣的 tag 欄
 * 就不應該存在」，提議改成一顆按鈕點開氣泡；owner 2026-11-03「按照他的意思改」）。
 * 選中的籤一定要在浮層外看得到：看不到自己開了什麼篩選就關不掉（owner 2026-10-02）。
 * 浮層是非模態的：Tab 走得出去、點外面或 Esc 就收，收起時焦點回到鈕上；選籤不收，可以一次選好幾個。
 * 浮層不帶 data-discovery-overlay：那個標記讓首頁在頁首選單開著時暫停載卡（BoardPage canLoad），
 * 但這個浮層的用途就是換榜單內容，選了類型要立刻載新的第一頁，不能等浮層收起來。
 *
 * 沒選類型時不畫「全部」：分組之後它孤零零佔一行、永遠亮著又點不動，看不出是什麼（owner 2026-10-11）。
 * 選了類型才出現「清除類型」（browse／popover）。搜尋頁的篩選面板自己有清除鈕，不重複畫。
 *
 * counts：每顆籤後面的張數（再加上這一類會剩幾張）；0 張的變灰、點不下去，已選中的照樣點得掉。沒給就不標。
 */
const props = withDefaults(defineProps<{ selected: string[]; hidden?: string[]; browse?: boolean; popover?: boolean; counts?: Record<string, number> | null }>(), { hidden: () => [], counts: null });
const emit = defineEmits<{ change: [tags: string[]] }>();
const { locale, lp } = useLocalePath();
const matches = (entry: TagEntry, tag: string) => entry.key === tag || Object.values(entry.names).includes(tag);
const active = (entry: TagEntry) => props.selected.some(tag => matches(entry, tag));
const empty = (entry: TagEntry) => !!props.counts && (props.counts[entry.key] ?? 0) === 0 && !active(entry);
const catalog = computed(() => visibleCatalog(TAG_CATALOG, props.hidden, TAG_CATALOG.filter(active).map(x => x.key)));
const extras = computed(() => props.selected.filter(tag => !TAG_CATALOG.some(x => matches(x, tag))));
const groups = computed(() => TAG_GROUPS.map(group => ({ group, entries: catalog.value.filter(x => tagGroupOf(x.key) === group) })).filter(g => g.entries.length));
const clearable = computed(() => (props.browse || props.popover) && props.selected.length > 0);
/** 浮層外那排已選的籤：網址裡可能是名字不是鍵，照目錄換成介面語言的名字 */
const picked = computed(() => props.selected.map(tag => { const entry = TAG_CATALOG.find(x => matches(x, tag)); return { tag, label: entry ? tagLabel(entry, locale.value) : tag }; }));
function toggle(entry: TagEntry) {
  emit('change', active(entry) ? props.selected.filter(tag => !matches(entry, tag)) : [...props.selected, entry.key]);
}

const open = ref(false);
const root = ref<HTMLElement | null>(null);
const opener = ref<HTMLButtonElement | null>(null);
const panel = ref<HTMLElement | null>(null);
async function show() {
  open.value = true;
  await nextTick();
  // 鈕在畫面下半時，浮層的下緣會在畫面外：捲到看得見整個浮層為止
  panel.value?.scrollIntoView({ block: "nearest" });
  panel.value?.querySelector<HTMLElement>("button:not(:disabled)")?.focus({ preventScroll: true });
}
function close(refocus = true) {
  if (!open.value) return;
  open.value = false;
  if (refocus) opener.value?.focus();
}
function onDocClick(e: MouseEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close(false);
}
function onKey(e: KeyboardEvent) {
  // 焦點已經走到別處（浮層不是模態的）就只收起來，不把焦點拉回鈕上
  if (e.key === "Escape" && open.value) close(!!panel.value?.contains(document.activeElement) || document.activeElement === opener.value);
}
// 只有浮層版需要聽整頁的點擊與按鍵；攤開的清單（寬螢幕、搜尋頁）不掛
onMounted(() => { if (props.popover) { document.addEventListener("click", onDocClick); document.addEventListener("keydown", onKey); } });
onBeforeUnmount(() => { document.removeEventListener("click", onDocClick); document.removeEventListener("keydown", onKey); });
</script>
<template>
  <nav ref="root" class="discovery-tags" :class="{ 'discovery-tags--popover': popover }" :aria-label="$t('board.tags')">
    <template v-if="popover">
      <div class="discovery-tags__bar">
        <button ref="opener" type="button" class="tagchip discovery-tags__button" :class="{ 'is-on': selected.length }" :aria-expanded="open" aria-controls="discovery-tags-panel" @click="open ? close() : show()">
          {{ $t('board.tags') }}
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>
        </button>
        <button v-for="p in picked" :key="p.tag" type="button" class="tagchip is-on discovery-tags__picked" :aria-label="$t('board.tags.remove', { name: p.label })" @click="emit('change', selected.filter(tag => tag !== p.tag))">
          <span class="tagchip__label">{{ p.label }}</span><span aria-hidden="true">×</span>
        </button>
      </div>
    </template>
    <!-- 同一份清單：寬螢幕直接攤開，窄螢幕裝進浮層 -->
    <div v-if="!popover || open" v-bind="popover ? { id: 'discovery-tags-panel', role: 'group', 'aria-label': $t('board.tags') } : {}" ref="panel" :class="{ 'discovery-tags__panel panel': popover }">
      <div v-if="popover" class="discovery-tags__panel-head">
        <span class="discovery-tags__title">{{ $t('board.tags') }}</span>
        <button type="button" class="discovery-tags__close" :aria-label="$t('dialog.close')" @click="close()">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" /></svg>
        </button>
      </div>
      <div class="discovery-tags__inner">
        <!-- 網址裡不在目錄的類型（舊連結、手打的字）：窄螢幕已經攤在鈕旁邊 -->
        <div v-if="extras.length && !popover" class="discovery-tags__chips discovery-tags__extras">
          <button v-for="tag in extras" :key="tag" type="button" class="tagchip is-on" aria-pressed="true" @click="emit('change', selected.filter(x => x !== tag))">{{ tag }}</button>
        </div>
        <template v-for="g in groups" :key="g.group">
          <span class="discovery-tags__group" :data-group-label="g.group">{{ $t(`board.tagGroup.${g.group}`) }}</span>
          <div class="discovery-tags__chips" :data-group="g.group">
            <button v-for="x in g.entries" :key="x.key" type="button" class="tagchip" :class="{ 'is-on': active(x), 'is-empty': empty(x) }" :aria-pressed="active(x)" :disabled="empty(x)" @click="toggle(x)">
              <span class="tagchip__label">{{ tagLabel(x, locale) }}</span>
              <span v-if="counts" class="tagchip__n">{{ counts[x.key] ?? 0 }}</span>
            </button>
          </div>
        </template>
        <div v-if="((browse || popover) && hidden.length) || clearable" class="discovery-tags__chips discovery-tags__tail">
          <button v-if="clearable" type="button" class="tagchip discovery-tags__clear" @click="emit('change', [])">{{ $t('board.tags.clear') }}</button>
          <RouterLink v-if="(browse || popover) && hidden.length" :to="lp('/settings/content') + '#hidden'" class="tagchip tagchip--hidden">{{ $t('board.hidden', { n: hidden.length }) }}</RouterLink>
        </div>
      </div>
    </div>
  </nav>
</template>
<style scoped>
.discovery-tags { margin-bottom: var(--s-4); }
/* 組名一欄（取四組裡最寬的那個，五種語言都對齊）、籤一欄；組名對齊該組第一行籤的中線。組與組的間距比籤的換行間距大，看得出分組 */
.discovery-tags__inner { display: grid; grid-template-columns: max-content minmax(0, 1fr); column-gap: var(--s-4); row-gap: var(--s-3); align-items: start; padding-block: var(--s-1); }
.discovery-tags__chips { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); min-width: 0; }
.discovery-tags__extras, .discovery-tags__tail { grid-column: 2; }
.discovery-tags__group { display: flex; align-items: center; min-height: var(--h-sm); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; color: var(--text-3); white-space: nowrap; }
.tagchip { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: var(--h-sm); padding: var(--s-1) var(--s-3); border: 1px solid var(--line); border-radius: var(--r-pill); background: var(--surface); color: var(--text-2); font: inherit; font-size: 13px; white-space: nowrap; cursor: pointer; }
.tagchip:hover { border-color: var(--line-strong); color: var(--text); }
.tagchip.is-on { background: var(--accent-tint); color: var(--accent-text); border-color: var(--accent); }
.tagchip__n { font-size: 11px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.tagchip.is-on .tagchip__n { color: inherit; opacity: 0.7; }
/* 0 張：點下去只會是空榜，變灰、不能點 */
.tagchip.is-empty, .tagchip.is-empty:hover { opacity: 0.45; border-color: var(--line); color: var(--text-2); cursor: default; }
.tagchip--hidden { border-style: dashed; text-decoration: none; }
.discovery-tags__clear { border-style: dashed; color: var(--text-3); }

/* ── 窄螢幕：一顆鈕＋浮層 ── */
.discovery-tags--popover { flex: 1 1 auto; max-width: 100%; margin-bottom: 0; }
.discovery-tags__bar { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-2); }
.discovery-tags__button { gap: 4px; padding-inline: var(--s-3) 10px; font-weight: 500; }
.discovery-tags__button svg { width: 12px; height: 12px; transition: transform var(--dur) var(--ease); }
.discovery-tags__button[aria-expanded="true"] svg { transform: rotate(180deg); }
.discovery-tags__picked { gap: 4px; max-width: 100%; }
.discovery-tags__picked .tagchip__label { overflow: hidden; text-overflow: ellipsis; }
/* 浮層錨在外層那一列（呼叫端給它 position: relative）：跟整列一樣寬，不只是鈕那一格 */
.discovery-tags__panel {
  position: absolute; top: calc(100% + var(--s-2)); left: 0; right: 0; z-index: 40; max-height: min(70dvh, 600px); overflow-y: auto; overscroll-behavior: contain;
  display: grid; gap: var(--s-2); padding: var(--s-2) var(--s-3) var(--s-3);
  border-radius: var(--r-md); box-shadow: 0 0 0 1px var(--line), var(--shadow-md);
  animation: discovery-pop var(--dur) var(--ease);
}
@keyframes discovery-pop { from { opacity: 0; transform: translateY(-4px) scale(0.98); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .discovery-tags__panel { animation: none; } }
.discovery-tags__panel-head { display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); }
.discovery-tags__title { font-size: 14px; font-weight: 600; color: var(--text); }
.discovery-tags__close { display: inline-flex; align-items: center; justify-content: center; width: var(--h-sm); height: var(--h-sm); margin-inline-end: calc(-1 * var(--s-2)); padding: 0; border: 0; border-radius: var(--r-pill); background: none; color: var(--text-2); cursor: pointer; }
.discovery-tags__close:hover { background: var(--surface-2); color: var(--text); }
.discovery-tags__close svg { width: 16px; height: 16px; }
/*
  窄螢幕（首頁浮層、搜尋頁篩選面板）組名放在籤的上方：手機寬度扣掉組名那一欄，英文、日文的長籤只能一顆一行，
  首頁浮層要捲兩三屏（360 寬實測英文 1284px → 1054px、日文 1027px → 907px）。
*/
@media (max-width: 640px) {
  .discovery-tags__inner { grid-template-columns: minmax(0, 1fr); row-gap: 6px; }
  .discovery-tags__group { min-height: 0; }
  [data-group-label]:not(:first-child) { margin-top: 6px; }
  .discovery-tags__extras, .discovery-tags__tail { grid-column: 1; }
}
.discovery-tags__panel .discovery-tags__inner { padding-block: 0; }
.discovery-tags__panel .discovery-tags__chips { gap: 6px; }
.discovery-tags__panel .tagchip { gap: 4px; padding-inline: 10px; }
</style>

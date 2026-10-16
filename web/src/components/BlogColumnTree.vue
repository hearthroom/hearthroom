<script setup lang="ts">
/**
 * 部落格後台左欄：全部文章、分組、分組底下的欄目，每項帶文章數（含草稿）。
 * 點名稱是選取；「＋」在分組裡新增欄目；「⋯」是編輯、上移、下移、刪除。停用的淡色顯示並標「不顯示」。
 *
 * 每一列尾端都保留同寬的動作區（分組兩顆、欄目一顆靠右、全部文章留空），數字才會落在同一欄。
 * 有滑鼠的桌面上動作區平常隱藏，滑過或鍵盤焦點進來才出現；觸控裝置一律顯示。
 *
 * 「⋯」選單用 position: fixed 定位在按鈕旁邊：左欄是可捲動的面板，絕對定位的選單會被它裁掉。
 * 下方放不下就往上翻；捲動、縮放視窗、點外面、按 Esc 都收起來（固定定位不會跟著列移動）。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { columnName, type BlogColumn, type BlogGroup, type TreePick } from '@/lib/blog';

const props = defineProps<{ groups: BlogGroup[]; picked: TreePick; total: number }>();
const emit = defineEmits<{
  pick: [TreePick]; addGroup: []; addColumn: [groupId: string];
  edit: [item: BlogColumn, kind: 'group' | 'column']; move: [item: BlogColumn, dir: -1 | 1]; remove: [item: BlogColumn, kind: 'group' | 'column'];
}>();
const { t, locale } = useI18n();
const name = (c: BlogColumn) => columnName(c, String(locale.value));
const isOn = (kind: 'group' | 'column', id: string) => props.picked.kind === kind && props.picked.id === id;
const root = ref<HTMLElement | null>(null);

const openMenus = () => Array.from(root.value?.querySelectorAll<HTMLDetailsElement>('details[open]') ?? []);
function closeMenus(except?: Element) {
  for (const d of openMenus()) if (d !== except) d.removeAttribute('open');
}
/** 選單裡按了一項：先把選單收起來再做事 */
function run(e: Event, fn: () => void) {
  (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  fn();
}

/** 打開時：收掉別的選單、把這個選單放到按鈕旁邊（放不下就往上），焦點移到第一個可按的項目 */
function place(e: Event) {
  const menu = e.currentTarget as HTMLDetailsElement;
  if (!menu.open) return;
  closeMenus(menu);
  const anchor = menu.querySelector('summary')!.getBoundingClientRect();
  const pop = menu.querySelector<HTMLElement>('[role=menu]')!;
  const gap = 4, edge = 8;
  const { offsetWidth: w, offsetHeight: h } = pop;
  const below = anchor.bottom + gap;
  pop.style.top = `${below + h > window.innerHeight - edge ? Math.max(edge, anchor.top - gap - h) : below}px`;
  pop.style.left = `${Math.max(edge, Math.min(anchor.right - w, window.innerWidth - w - edge))}px`;
  pop.querySelector<HTMLElement>('button:not(:disabled)')?.focus({ preventScroll: true });
}

/** 選單內上下鍵移動、Home／End 跳頭尾 */
function onMenuKey(e: KeyboardEvent) {
  const items = Array.from((e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
  const i = items.indexOf(document.activeElement as HTMLButtonElement);
  const next = e.key === 'ArrowDown' ? (i + 1) % items.length : e.key === 'ArrowUp' ? (i - 1 + items.length) % items.length
    : e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : -1;
  if (next < 0) return;
  e.preventDefault();
  items[next]?.focus();
}

function onPointerDown(e: PointerEvent) {
  if (!openMenus().some((d) => d.contains(e.target as Node))) closeMenus();
}
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  const open = openMenus()[0];
  if (!open) return;
  closeMenus();
  open.querySelector('summary')?.focus();
}
const onViewportChange = () => closeMenus();
onMounted(() => {
  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKey);
  // 捲動不冒泡：用捕獲階段才收得到左欄自己的捲動
  window.addEventListener('scroll', onViewportChange, true);
  window.addEventListener('resize', onViewportChange);
});
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', onPointerDown);
  document.removeEventListener('keydown', onKey);
  window.removeEventListener('scroll', onViewportChange, true);
  window.removeEventListener('resize', onViewportChange);
});
</script>

<template>
  <nav ref="root" class="btree" :aria-label="t('blog.admin.columns')">
    <div class="btree__row" :class="{ 'is-on': picked.kind === 'all' }">
      <button type="button" class="btree__item btree__item--all" :aria-current="picked.kind === 'all' ? 'true' : undefined" data-pick="all" @click="emit('pick', { kind: 'all' })">
        <span class="btree__name">{{ t('blog.admin.allPosts') }}</span><span class="btree__n">{{ total }}</span>
      </button>
    </div>

    <div class="btree__head">
      <span class="btree__label">{{ t('blog.admin.columns') }}</span>
      <button type="button" class="btree__add" data-action="new-group" @click="emit('addGroup')"><span aria-hidden="true">＋</span>{{ t('blog.admin.newGroup') }}</button>
    </div>

    <ul class="btree__groups">
      <li v-for="(g, gi) in groups" :key="g.id" class="btree__group">
        <div class="btree__row" :class="{ 'is-on': isOn('group', g.id), 'is-off': !g.enabled }">
          <button type="button" class="btree__item btree__item--group" :aria-current="isOn('group', g.id) ? 'true' : undefined" :data-pick="`group:${g.slug}`" @click="emit('pick', { kind: 'group', id: g.id })">
            <span class="btree__name">{{ name(g) }}<small v-if="!g.enabled" class="btree__off">{{ t('blog.admin.hidden') }}</small></span>
            <span class="btree__n">{{ g.postCount ?? 0 }}</span>
          </button>
          <div class="btree__acts">
            <button type="button" class="btree__icon" :aria-label="t('blog.admin.newColumnIn', { name: name(g) })" :title="t('blog.admin.newColumnIn', { name: name(g) })" :data-add-column="g.slug" @click="emit('addColumn', g.id)">＋</button>
            <details class="btree__menu" :data-menu="g.slug" @toggle="place">
              <summary class="btree__icon" :aria-label="t('blog.admin.more')" :title="t('blog.admin.more')">⋯</summary>
              <div class="btree__pop" role="menu" @keydown="onMenuKey">
                <button type="button" role="menuitem" @click="run($event, () => emit('edit', g, 'group'))">{{ t('blog.admin.edit') }}</button>
                <button type="button" role="menuitem" :disabled="gi === 0" @click="run($event, () => emit('move', g, -1))">{{ t('blog.admin.moveUp') }}</button>
                <button type="button" role="menuitem" :disabled="gi === groups.length - 1" @click="run($event, () => emit('move', g, 1))">{{ t('blog.admin.moveDown') }}</button>
                <div class="btree__sep" role="separator" />
                <button type="button" role="menuitem" class="btree__danger" data-action="delete" @click="run($event, () => emit('remove', g, 'group'))">{{ t('blog.admin.delete') }}</button>
              </div>
            </details>
          </div>
        </div>
        <ul v-if="g.columns.length" class="btree__columns">
          <li v-for="(c, ci) in g.columns" :key="c.id" class="btree__row" :class="{ 'is-on': isOn('column', c.id), 'is-off': !c.enabled }">
            <button type="button" class="btree__item btree__item--column" :aria-current="isOn('column', c.id) ? 'true' : undefined" :data-pick="`column:${c.slug}`" @click="emit('pick', { kind: 'column', id: c.id })">
              <span class="btree__name">{{ name(c) }}<small v-if="!c.enabled" class="btree__off">{{ t('blog.admin.hidden') }}</small></span>
              <span class="btree__n">{{ c.postCount ?? 0 }}</span>
            </button>
            <div class="btree__acts">
              <details class="btree__menu" :data-menu="c.slug" @toggle="place">
                <summary class="btree__icon" :aria-label="t('blog.admin.more')" :title="t('blog.admin.more')">⋯</summary>
                <div class="btree__pop" role="menu" @keydown="onMenuKey">
                  <button type="button" role="menuitem" @click="run($event, () => emit('edit', c, 'column'))">{{ t('blog.admin.edit') }}</button>
                  <button type="button" role="menuitem" :disabled="ci === 0" @click="run($event, () => emit('move', c, -1))">{{ t('blog.admin.moveUp') }}</button>
                  <button type="button" role="menuitem" :disabled="ci === g.columns.length - 1" @click="run($event, () => emit('move', c, 1))">{{ t('blog.admin.moveDown') }}</button>
                  <div class="btree__sep" role="separator" />
                  <button type="button" role="menuitem" class="btree__danger" data-action="delete" @click="run($event, () => emit('remove', c, 'column'))">{{ t('blog.admin.delete') }}</button>
                </div>
              </details>
            </div>
          </li>
        </ul>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
/* 列高與動作鈕尺寸集中在這兩個變數：觸控裝置在下面一起放大 */
.btree { --row-h: var(--h-md); --icon: 28px; display: grid; gap: 2px; align-content: start; min-width: 0; }
.btree__groups, .btree__columns { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.btree__group { display: grid; gap: 2px; }
.btree__group + .btree__group { margin-top: var(--s-1); }
/* 欄目：縮排，左邊一條細線對齊分組名稱的起點，看得出誰屬於誰 */
.btree__columns { margin-inline-start: var(--s-3); padding-inline-start: var(--s-1); border-inline-start: 1px solid var(--line); }

.btree__row {
  position: relative; display: grid; grid-template-columns: minmax(0, 1fr) calc(var(--icon) * 2 + 2px); align-items: center;
  min-height: var(--row-h); border-radius: var(--r-sm); transition: background var(--dur) var(--ease);
}
.btree__row:hover { background: color-mix(in srgb, var(--surface-2) 70%, transparent); }
/* 選取：淡灰底、強調色字、左緣一條短色條；不用整塊強調色，免得壓過整欄 */
.btree__row.is-on { background: var(--surface-2); }
.btree__row.is-on::before {
  content: ''; position: absolute; inset-block: var(--s-2); inset-inline-start: 0; width: 3px;
  border-radius: var(--r-pill); background: var(--accent);
}
/* 欄目的色條壓在縮排細線上 */
.btree__columns .btree__row.is-on::before { inset-inline-start: calc(-1 * var(--s-1) - 2px); }

.btree__item {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); min-width: 0;
  min-height: var(--row-h); padding: 0 var(--s-2) 0 var(--s-3); border: 0; border-radius: var(--r-sm);
  background: transparent; color: var(--text-2); font: inherit; font-size: 14px; text-align: start; cursor: pointer;
}
.btree__item:focus-visible { outline-offset: -2px; }
.btree__row:hover .btree__item { color: var(--text); }
.btree__item--all, .btree__item--group { color: var(--text); font-weight: 500; }
.btree__item--group { font-weight: 600; }
.btree__row.is-on .btree__item { color: var(--accent-text); font-weight: 600; }
.btree__row.is-off .btree__name { opacity: 0.6; }
.btree__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btree__off { margin-inline-start: var(--s-2); font-size: 11px; font-weight: 500; color: var(--text-3); }
.btree__n { flex: none; font-size: 12px; font-weight: 500; color: var(--text-3); font-variant-numeric: tabular-nums; }
.btree__row.is-on .btree__n { color: var(--text-2); }

/* 分組區的標題列：左邊小標，右邊新增分組 */
.btree__head {
  display: flex; align-items: center; justify-content: space-between; gap: var(--s-2);
  margin-top: var(--s-2); padding: var(--s-2) 0 var(--s-1) var(--s-3); border-top: 1px solid var(--line);
}
.btree__label { font-size: 12px; font-weight: 600; color: var(--text-3); }
.btree__add {
  display: inline-flex; align-items: center; gap: var(--s-1); height: var(--h-sm); padding: 0 var(--s-2);
  border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-2); font: inherit; font-size: 13px; font-weight: 500;
  white-space: nowrap; cursor: pointer; transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.btree__add:hover { background: var(--surface-2); color: var(--text); }

.btree__acts { display: flex; justify-content: flex-end; gap: 2px; }
.btree__icon {
  flex: none; display: grid; place-items: center; width: var(--icon); height: var(--icon); border: 0; border-radius: var(--r-sm);
  background: transparent; color: var(--text-3); font-size: 15px; line-height: 1; cursor: pointer; list-style: none;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease);
}
.btree__icon::-webkit-details-marker { display: none; }
.btree__icon:hover, .btree__menu[open] > .btree__icon { background: var(--surface); color: var(--text); box-shadow: 0 0 0 1px var(--line); }

/* 有滑鼠的桌面：動作區滑過或焦點進來才出現；opacity 而不是 display，鍵盤仍然 Tab 得到 */
@media (hover: hover) and (pointer: fine) {
  .btree__acts { opacity: 0; transition: opacity var(--dur) var(--ease); }
  .btree__row:hover .btree__acts, .btree__row:focus-within .btree__acts, .btree__acts:has(details[open]) { opacity: 1; }
}
/* 觸控：列高與按鈕都到 44px，動作一律顯示 */
@media (pointer: coarse) {
  .btree { --row-h: var(--h-lg); --icon: 40px; }
  .btree__icon { height: var(--h-lg); }
  .btree__add { height: var(--h-lg); }
}

.btree__menu { position: relative; }
/* 位置由 place() 寫入 top／left；固定定位才不會被可捲動的左欄裁掉 */
.btree__pop {
  position: fixed; z-index: 50; display: grid; min-width: 160px; padding: var(--s-1);
  background: var(--surface); border-radius: var(--r-md);
  box-shadow: 0 0 0 1px var(--line-strong), var(--shadow-md);
}
.btree__pop button {
  min-height: var(--row-h); padding: 0 var(--s-3); border: 0; border-radius: var(--r-sm);
  background: transparent; color: var(--text); font: inherit; font-size: 14px; text-align: start; white-space: nowrap; cursor: pointer;
}
.btree__pop button:hover:not(:disabled), .btree__pop button:focus-visible { background: var(--surface-2); }
.btree__pop button:focus-visible { outline-offset: -2px; }
.btree__pop button:disabled { color: var(--text-3); opacity: 0.6; cursor: default; }
.btree__pop .btree__danger { color: var(--danger); }
.btree__pop .btree__danger:hover, .btree__pop .btree__danger:focus-visible { background: color-mix(in srgb, var(--danger) 10%, var(--surface)); }
.btree__sep { height: 1px; margin: var(--s-1) var(--s-2); background: var(--line); }
</style>

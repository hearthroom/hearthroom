<script setup lang="ts">
/**
 * 部落格後台左欄：全部文章、分組、分組底下的欄目，每項帶文章數（含草稿）。
 * 點名稱是選取；「＋」在分組裡新增欄目；「⋯」是編輯、上移、下移、刪除。停用的淡色顯示並標「不顯示」。
 */
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
/** 選單裡按了一項：先把選單收起來再做事 */
function run(e: Event, fn: () => void) {
  (e.currentTarget as HTMLElement).closest('details')?.removeAttribute('open');
  fn();
}
</script>

<template>
  <nav class="btree" :aria-label="t('blog.admin.columns')">
    <button type="button" class="btree__item btree__item--all" :class="{ 'is-on': picked.kind === 'all' }" :aria-current="picked.kind === 'all' ? 'true' : undefined" data-pick="all" @click="emit('pick', { kind: 'all' })">
      <span class="btree__name">{{ t('blog.admin.allPosts') }}</span><span class="btree__n">{{ total }}</span>
    </button>
    <button type="button" class="btn btn--sm btree__add" data-action="new-group" @click="emit('addGroup')">＋ {{ t('blog.admin.newGroup') }}</button>
    <ul class="btree__groups">
      <li v-for="(g, gi) in groups" :key="g.id" class="btree__group">
        <div class="btree__row">
          <button type="button" class="btree__item btree__item--group" :class="{ 'is-on': isOn('group', g.id), 'is-off': !g.enabled }" :aria-current="isOn('group', g.id) ? 'true' : undefined" :data-pick="`group:${g.slug}`" @click="emit('pick', { kind: 'group', id: g.id })">
            <span class="btree__name">{{ name(g) }}<small v-if="!g.enabled" class="btree__off">{{ t('blog.admin.hidden') }}</small></span>
            <span class="btree__n">{{ g.postCount ?? 0 }}</span>
          </button>
          <button type="button" class="btree__icon" :aria-label="t('blog.admin.newColumnIn', { name: name(g) })" :title="t('blog.admin.newColumnIn', { name: name(g) })" :data-add-column="g.slug" @click="emit('addColumn', g.id)">＋</button>
          <details class="btree__menu" :data-menu="g.slug">
            <summary class="btree__icon" :aria-label="t('blog.admin.more')">⋯</summary>
            <div class="btree__pop panel" role="menu">
              <button type="button" role="menuitem" @click="run($event, () => emit('edit', g, 'group'))">{{ t('blog.admin.edit') }}</button>
              <button type="button" role="menuitem" :disabled="gi === 0" @click="run($event, () => emit('move', g, -1))">{{ t('blog.admin.moveUp') }}</button>
              <button type="button" role="menuitem" :disabled="gi === groups.length - 1" @click="run($event, () => emit('move', g, 1))">{{ t('blog.admin.moveDown') }}</button>
              <button type="button" role="menuitem" class="btree__danger" data-action="delete" @click="run($event, () => emit('remove', g, 'group'))">{{ t('blog.admin.delete') }}</button>
            </div>
          </details>
        </div>
        <ul class="btree__columns">
          <li v-for="(c, ci) in g.columns" :key="c.id" class="btree__row">
            <button type="button" class="btree__item btree__item--column" :class="{ 'is-on': isOn('column', c.id), 'is-off': !c.enabled }" :aria-current="isOn('column', c.id) ? 'true' : undefined" :data-pick="`column:${c.slug}`" @click="emit('pick', { kind: 'column', id: c.id })">
              <span class="btree__name">{{ name(c) }}<small v-if="!c.enabled" class="btree__off">{{ t('blog.admin.hidden') }}</small></span>
              <span class="btree__n">{{ c.postCount ?? 0 }}</span>
            </button>
            <details class="btree__menu" :data-menu="c.slug">
              <summary class="btree__icon" :aria-label="t('blog.admin.more')">⋯</summary>
              <div class="btree__pop panel" role="menu">
                <button type="button" role="menuitem" @click="run($event, () => emit('edit', c, 'column'))">{{ t('blog.admin.edit') }}</button>
                <button type="button" role="menuitem" :disabled="ci === 0" @click="run($event, () => emit('move', c, -1))">{{ t('blog.admin.moveUp') }}</button>
                <button type="button" role="menuitem" :disabled="ci === g.columns.length - 1" @click="run($event, () => emit('move', c, 1))">{{ t('blog.admin.moveDown') }}</button>
                <button type="button" role="menuitem" class="btree__danger" data-action="delete" @click="run($event, () => emit('remove', c, 'column'))">{{ t('blog.admin.delete') }}</button>
              </div>
            </details>
          </li>
        </ul>
      </li>
    </ul>
  </nav>
</template>

<style scoped>
.btree { display: grid; gap: var(--s-2); align-content: start; min-width: 0; }
.btree__groups, .btree__columns { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; }
.btree__columns { padding-left: var(--s-3); }
.btree__group { display: grid; gap: 2px; }
.btree__row { position: relative; display: flex; align-items: center; gap: 2px; min-width: 0; }
.btree__item { flex: 1; min-width: 0; display: flex; align-items: center; justify-content: space-between; gap: var(--s-2); min-height: 36px; padding: 0 var(--s-3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-2); font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.btree__item:hover { background: var(--surface-2); color: var(--text); }
.btree__item.is-on { background: var(--accent-tint); color: var(--accent-text); font-weight: 600; }
.btree__item.is-off .btree__name { opacity: 0.6; }
.btree__item--group { font-weight: 600; color: var(--text); }
.btree__name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.btree__off { margin-left: var(--s-2); font-size: 11px; font-weight: 500; color: var(--text-3); }
.btree__n { flex: none; font-size: 12px; color: var(--text-3); font-variant-numeric: tabular-nums; }
.btree__add { justify-self: start; }
.btree__icon { flex: none; display: grid; place-items: center; width: 32px; height: 32px; border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text-3); font-size: 16px; cursor: pointer; list-style: none; }
.btree__icon::-webkit-details-marker { display: none; }
.btree__icon:hover { background: var(--surface-2); color: var(--text); }
.btree__menu { position: relative; }
.btree__pop { position: absolute; right: 0; top: 34px; z-index: 40; display: grid; min-width: 140px; padding: var(--s-1); }
.btree__pop button { min-height: 36px; padding: 0 var(--s-3); border: 0; border-radius: var(--r-sm); background: transparent; color: var(--text); font: inherit; font-size: 14px; text-align: start; cursor: pointer; }
.btree__pop button:hover:not(:disabled) { background: var(--surface-2); }
.btree__pop button:disabled { color: var(--text-3); cursor: default; }
.btree__pop .btree__danger { color: var(--danger); }
</style>

<script setup lang="ts">
/**
 * 新增或編輯一個分組／欄目。每打開一次配一個操作編號：送失敗重按沿用，服務端認得出重送。
 * 分組沒有「所屬分組」；欄目一定掛在某個分組底下（可以改到別的分組）。
 */
import { nextTick, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import { columnName, POST_LOCALES, saveColumn, type BlogColumn, type BlogGroup } from '@/lib/blog';
import { LOCALES } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { wrapTab } from '@/lib/focus-trap';

const props = defineProps<{ kind: 'group' | 'column'; groups: BlogGroup[]; initial?: BlogColumn | null; parentId?: string | null; nextSort: number }>();
const emit = defineEmits<{ close: []; saved: [BlogColumn] }>();
const { t, locale } = useI18n();
const session = useSession();

const blank = (src: Partial<Record<string, string>> = {}) => Object.fromEntries(POST_LOCALES.map((l) => [l, src[l] ?? ''])) as Record<string, string>;
const form = reactive({
  slug: props.initial?.slug ?? '',
  name: blank(props.initial?.name),
  description: blank(props.initial?.description),
  enabled: props.initial?.enabled ?? true,
  parentId: props.kind === 'column' ? (props.initial?.parentId ?? props.parentId ?? props.groups[0]?.id ?? '') : null,
});
const operationId = crypto.randomUUID();
const busy = ref(false);
const error = ref('');
const box = ref<HTMLElement | null>(null);
const localeLabel = (code: string) => LOCALES.find((l) => l.code === code)?.label ?? code;
const title = () => t(props.initial ? (props.kind === 'group' ? 'blog.admin.editGroup' : 'blog.admin.editColumn') : props.kind === 'group' ? 'blog.admin.newGroup' : 'blog.admin.newColumn');

async function submit() {
  if (busy.value) return;
  busy.value = true; error.value = '';
  try {
    const token = await session.accessToken();
    if (!token) throw new Error(t('auth.expired'));
    const saved = await saveColumn(token, {
      id: props.initial?.id, slug: form.slug.trim(), name: form.name, description: form.description,
      sort: props.initial?.sort ?? props.nextSort, enabled: form.enabled, parentId: form.parentId,
    }, operationId);
    emit('saved', saved);
  } catch (e) { error.value = e instanceof Error ? e.message : t('moderation.error.retry'); } finally { busy.value = false; }
}

/** 開啟前的焦點：關掉時還回去 */
let restore: HTMLElement | null = null;
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') { e.preventDefault(); emit('close'); return; }
  wrapTab(e, box.value);
}
onMounted(async () => {
  restore = document.activeElement as HTMLElement | null;
  document.addEventListener('keydown', onKey);
  await nextTick();
  box.value?.querySelector<HTMLElement>('select, input')?.focus();
});
onBeforeUnmount(() => { document.removeEventListener('keydown', onKey); restore?.focus?.(); });
</script>

<template>
  <Teleport to="body">
    <div class="modal-backdrop" @click.self="emit('close')">
      <form ref="box" class="modal panel bcd" role="dialog" aria-modal="true" aria-labelledby="bcd-title" @submit.prevent="submit">
        <h2 id="bcd-title" class="modal__title">{{ title() }}</h2>
        <label v-if="kind === 'column'" class="field">
          <span>{{ t('blog.admin.parentGroup') }}</span>
          <select v-model="form.parentId" class="input" required data-field="parent">
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ columnName(g, String(locale)) }}</option>
          </select>
        </label>
        <fieldset class="bcd-set">
          <legend>{{ t(kind === 'group' ? 'blog.admin.groupName' : 'blog.admin.columnName') }}</legend>
          <label v-for="l in POST_LOCALES" :key="l" class="bcd-row">
            <span class="subtle">{{ localeLabel(l) }}</span>
            <input v-model="form.name[l]" class="input" maxlength="40" :required="l === 'zh-Hant'" :data-name="l" />
          </label>
        </fieldset>
        <label class="field">
          <span>{{ t('blog.admin.slug') }}</span>
          <input v-model="form.slug" class="input" maxlength="40" required pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" spellcheck="false" data-field="slug" />
          <span class="subtle">{{ t('blog.admin.slugHint') }}</span>
        </label>
        <details class="bcd-more">
          <summary>{{ t(kind === 'group' ? 'blog.admin.groupDescription' : 'blog.admin.columnDescription') }}</summary>
          <label v-for="l in POST_LOCALES" :key="l" class="bcd-row">
            <span class="subtle">{{ localeLabel(l) }}</span>
            <textarea v-model="form.description[l]" class="input" rows="2" maxlength="300" />
          </label>
        </details>
        <label class="bcd-check"><input v-model="form.enabled" type="checkbox" /> {{ t('blog.admin.enabled') }}</label>
        <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
        <div class="modal__actions">
          <button type="button" class="btn" @click="emit('close')">{{ t('dialog.cancel') }}</button>
          <button type="submit" class="btn btn--primary" :disabled="busy" data-action="save-column">{{ t('blog.admin.save') }}</button>
        </div>
      </form>
    </div>
  </Teleport>
</template>

<style scoped>
.bcd { width: min(520px, 100%); max-height: min(90vh, 760px); overflow-y: auto; display: grid; gap: var(--s-4); }
.bcd .field { display: grid; gap: 6px; }
.bcd .field > span:first-child, .bcd-set legend, .bcd-more summary { font-size: 13px; font-weight: 600; }
.bcd-set { margin: 0; padding: 0; border: 0; display: grid; gap: var(--s-2); min-width: 0; }
.bcd-set legend { margin-bottom: var(--s-2); }
.bcd-row { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: var(--s-2); align-items: center; }
.bcd-more { display: grid; gap: var(--s-2); }
.bcd-more summary { cursor: pointer; }
.bcd-more[open] summary { margin-bottom: var(--s-2); }
.bcd-more textarea.input { height: auto; padding: 8px 12px; resize: vertical; }
.bcd-check { display: flex; align-items: center; gap: var(--s-2); font-size: 14px; }
.bcd .input { width: 100%; }
@media (max-width: 520px) { .bcd-row { grid-template-columns: minmax(0, 1fr); gap: 4px; } }
</style>

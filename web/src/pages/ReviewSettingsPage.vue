<script setup lang="ts">
/**
 * 社群管理的「運營設定」：每個審核人都看得到現在的設定，只有應用管理員能改（canEdit 由服務端判）。
 * 每一格留空＝那條規則不啟用；程式不替站方選預設數字。活動設定在 CampaignSettingsPanel，自己讀自己的權限。
 */
import { onMounted, ref } from 'vue';
import { useI18n } from 'vue-i18n';
import CampaignSettingsPanel from '@/components/CampaignSettingsPanel.vue';
import { fetchSettings, saveSettings, type CommentSettings } from '@/lib/api';
import { useSession } from '@/lib/session';
import { pageTitle } from '@/lib/i18n';

const { t } = useI18n();
const session = useSession();
type Key = keyof CommentSettings;
/** 範圍跟服務端的檢查一致（community-settings.ts）；瀏覽器的表單驗證先擋一次。 */
const fields: { key: Key; label: string; min: number; max: number }[] = [
  { key: 'commentNewAccountDays', label: 'moderation.settings.newAccountDays', min: 0, max: 365 },
  { key: 'commentMaxLinks', label: 'moderation.settings.maxLinks', min: 0, max: 20 },
  { key: 'commentReportFoldThreshold', label: 'moderation.settings.reportFold', min: 1, max: 100 },
];
// type=number 的 v-model 給數字；清空時給空字串
const values = ref<Record<Key, number | ''>>({ commentNewAccountDays: '', commentMaxLinks: '', commentReportFoldThreshold: '' });
const canEdit = ref(false);
const loading = ref(true);
const saving = ref(false);
const error = ref('');
const done = ref('');
/** 這一次儲存的操作編號：失敗重送沿用，成功後換新的 */
const operation = ref(crypto.randomUUID());

function show(s: CommentSettings) {
  for (const f of fields) values.value[f.key] = s[f.key] ?? '';
}
async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}
async function load() {
  loading.value = true; error.value = '';
  try {
    const res = await fetchSettings(await token());
    show(res.settings); canEdit.value = res.canEdit;
  } catch (e) { error.value = e instanceof Error ? e.message : t('state.loadFailed'); } finally { loading.value = false; }
}
async function save() {
  if (!canEdit.value || saving.value) return;
  saving.value = true; error.value = ''; done.value = '';
  try {
    const settings = Object.fromEntries(fields.map((f) => [f.key, values.value[f.key] === '' ? null : Number(values.value[f.key])])) as unknown as CommentSettings;
    const res = await saveSettings(settings, operation.value, await token());
    show(res.settings); canEdit.value = res.canEdit;
    operation.value = crypto.randomUUID();
    done.value = t('moderation.settings.saved');
  } catch (e) { error.value = e instanceof Error ? e.message : t('moderation.error.retry'); } finally { saving.value = false; }
}
onMounted(() => { document.title = pageTitle(t('moderation.title')); void load(); });
</script>

<template>
  <section class="settings-page" :aria-label="t('moderation.tab.settings')">
    <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>
    <p v-if="done" class="notice" role="status">{{ done }}</p>
    <form class="panel settings-block" :aria-busy="loading" @submit.prevent="save">
      <h2>{{ t('moderation.settings.comments') }}</h2>
      <p v-if="!loading && !canEdit" class="notice" data-read-only>{{ t('moderation.settings.readOnly') }}</p>
      <div v-for="f in fields" :key="f.key" class="field">
        <label :for="`setting-${f.key}`">{{ t(f.label) }}</label>
        <input :id="`setting-${f.key}`" v-model="values[f.key]" class="input" type="number" inputmode="numeric" step="1" :min="f.min" :max="f.max" :placeholder="t('moderation.settings.empty')" :disabled="!canEdit || saving" />
      </div>
      <button v-if="canEdit" class="btn btn--primary settings-save" :disabled="saving">{{ t('settings.save') }}</button>
    </form>
    <CampaignSettingsPanel />
  </section>
</template>

<style scoped>
.settings-page { display: grid; gap: var(--s-4); max-width: 640px; }
.settings-block { padding: var(--s-5); display: grid; gap: var(--s-1); min-width: 0; }
.settings-block h2 { font-size: 17px; margin-bottom: var(--s-3); }
.settings-block .field { margin-bottom: var(--s-4); }
.settings-block .field > label { font-weight: 500; line-height: 1.5; }
.settings-block .input { width: 100%; max-width: 200px; }
.settings-save { justify-self: start; }
@media (max-width: 760px) { .settings-block { padding: var(--s-4); } .settings-block .input, .settings-save { min-height: 44px; } }
</style>

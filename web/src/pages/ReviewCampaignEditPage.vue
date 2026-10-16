<script setup lang="ts">
/**
 * 運營設定裡單一活動的編輯頁：/review/settings/campaigns/<id>，新活動是 campaigns/new。
 * 只有應用管理員能改（canEdit 由服務端判）；其他審核員看得到同一張表單，但每一格都鎖著。
 *
 * 時間欄位是 datetime-local，照表單上選的時區當牆上時間換成 epoch，不看瀏覽器的時區。
 * 金額、門檻、保留天數一律留空＝不設定，這裡不替站方填任何數字（保留天數沒給時由服務端決定）。
 *
 * 存檔與狀態變更照部落格編輯器：存檔帶上次讀到的版本號，撞到 campaign_version_conflict 停下來給「載入最新版本」；
 * 狀態變更的回應若帶著別人存的內容（版本號跳了不只一號、或內容不同），只收狀態、版本號留在原處並標成衝突。
 * 操作編號：同一件事送失敗再按沿用同一個，成功後丟掉；內容改過就是另一件事。
 * 新活動第一次存好換成自己的網址（不重讀）；有沒存的修改時，站內換頁與關分頁都先問。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import { RouterLink, onBeforeRouteLeave, onBeforeRouteUpdate, useRoute, useRouter } from 'vue-router';
import {
  CampaignError, DEFAULT_TIMEZONE, epochToZoned, fetchCampaigns, fieldLabel, localized, saveCampaign,
  setCampaignStatus, TIERS, TIMEZONES, uploadCampaignBanner, zonedToEpoch, zoneName, type Campaign, type CampaignInput, type Tier,
} from '@/lib/campaign';
import { POST_LOCALES, type Localized } from '@/lib/blog';
import { confirmDialog } from '@/lib/confirm';
import { LOCALES, pageTitle } from '@/lib/i18n';
import { useSession } from '@/lib/session';
import { useLocalePath } from '@/lib/use-locale';

const { t, locale } = useI18n();
const session = useSession();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();

type Lc = (typeof POST_LOCALES)[number];
type Num = number | '';
const TIMES = ['startsAt', 'endsAt', 'submitDeadline', 'payoutDeadline'] as const;
type TimeKey = (typeof TIMES)[number];
type Form = {
  slug: string; title: Record<Lc, string>; intro: Record<Lc, string>; bannerKey: string | null; timezone: string;
  times: Record<TimeKey, string>; tiers: Record<Tier, Num>; extraPlacementAmount: Num; lightLimit: Num; flagBurstThreshold: Num; evidenceRetentionDays: Num; featured: boolean;
};
const perLocale = (l: Localized = {}) => Object.fromEntries(POST_LOCALES.map((k) => [k, l[k] ?? ''])) as Record<Lc, string>;
const num = (v: number | null | undefined): Num => (v ?? '');
const empty = (): Form => ({
  slug: '', title: perLocale(), intro: perLocale(), bannerKey: null, timezone: DEFAULT_TIMEZONE,
  times: { startsAt: '', endsAt: '', submitDeadline: '', payoutDeadline: '' },
  tiers: { light: '', original: '', guide: '', video: '' }, extraPlacementAmount: '', lightLimit: '', flagBurstThreshold: '', evidenceRetentionDays: '', featured: false,
});
const fromCampaign = (c: Campaign): Form => {
  const tz = c.timezone || DEFAULT_TIMEZONE;
  return {
    slug: c.slug, title: perLocale(c.title), intro: perLocale(c.intro), bannerKey: c.bannerKey, timezone: tz,
    times: Object.fromEntries(TIMES.map((k) => [k, c[k] === null ? '' : epochToZoned(c[k]!, tz)])) as Record<TimeKey, string>,
    tiers: Object.fromEntries(TIERS.map((k) => [k, num(c.tiers[k])])) as Record<Tier, Num>,
    extraPlacementAmount: num(c.extraPlacementAmount), lightLimit: num(c.lightLimit), flagBurstThreshold: num(c.flagBurstThreshold), evidenceRetentionDays: num(c.evidenceRetentionDays), featured: c.featured,
  };
};
const compact = (l: Record<Lc, string>) => Object.fromEntries(Object.entries(l).filter(([, v]) => v.trim())) as Localized;
const orNull = (v: Num) => (v === '' ? null : Number(v));
const toInput = (f: Form): CampaignInput => ({
  slug: f.slug.trim(), title: compact(f.title), intro: compact(f.intro), bannerKey: f.bannerKey, timezone: f.timezone,
  ...(Object.fromEntries(TIMES.map((k) => [k, zonedToEpoch(f.times[k], f.timezone)])) as Record<TimeKey, number | null>),
  tiers: Object.fromEntries(TIERS.filter((k) => f.tiers[k] !== '').map((k) => [k, Number(f.tiers[k])])),
  extraPlacementAmount: orNull(f.extraPlacementAmount), lightLimit: orNull(f.lightLimit), flagBurstThreshold: orNull(f.flagBurstThreshold), featured: f.featured,
  ...(f.evidenceRetentionDays === '' ? {} : { evidenceRetentionDays: Number(f.evidenceRetentionDays) }),
});


const canEdit = ref(false);
const loading = ref(true);
const error = ref('');
const done = ref('');
/** 這一頁的基準：新活動還沒存過是 null */
const base = ref<Campaign | null>(null);
const form = ref<Form>(empty());
const saved = ref(JSON.stringify(form.value));
const dirty = computed(() => JSON.stringify(form.value) !== saved.value);
const bannerUrl = ref<string | null>(null);
const lang = ref<Lc>('zh-Hant');
const busy = ref(false);
const conflict = ref(false);
const formError = ref('');
/** 服務端說缺的那一格（startsAt、tiers.video…） */
const fieldError = ref('');
const locked = computed(() => !canEdit.value || busy.value);

const ops = new Map<string, string>();
const opFor = (key: string) => { let id = ops.get(key); if (!id) { id = crypto.randomUUID(); ops.set(key, id); } return id; };
const message = (e: unknown) => (e instanceof Error ? e.message : t('moderation.error.retry'));
const nameOf = (c: Campaign) => localized(c.title, String(locale.value)) || c.slug;
const zoneLabel = computed(() => zoneName(form.value.timezone, String(locale.value)));
const localeLabel = (code: string) => LOCALES.find((l) => l.code === code)?.label ?? code;
const bad = (key: string) => fieldError.value === key || (key === 'tiers' && fieldError.value.startsWith('tiers'));
const routeId = () => (route.params.id && route.params.id !== 'new' ? String(route.params.id) : '');

async function token() {
  const value = await session.accessToken();
  if (!value) throw new Error(t('auth.expired'));
  return value;
}

function apply(c: Campaign | null) {
  ops.clear();
  base.value = c;
  form.value = c ? fromCampaign(c) : empty();
  saved.value = JSON.stringify(form.value);
  bannerUrl.value = c?.bannerUrl ?? null;
  conflict.value = false; formError.value = ''; fieldError.value = '';
}

/** 沒有單筆讀取的接口：活動不多，讀列表挑出這一筆 */
async function load() {
  loading.value = true; error.value = ''; done.value = '';
  try {
    const res = await fetchCampaigns(await token());
    canEdit.value = res.canEdit;
    const id = routeId();
    const found = id ? res.items.find((c) => c.id === id) : null;
    if (id && !found) throw new Error(t('state.notFound'));
    apply(found ?? null); lang.value = 'zh-Hant';
  } catch (e) { error.value = message(e); } finally { loading.value = false; }
}

async function save() {
  if (!canEdit.value || busy.value) return;
  const input = toInput(form.value);
  const sent = JSON.stringify(form.value);
  const key = `save:${JSON.stringify(input)}`;
  busy.value = true; formError.value = ''; fieldError.value = ''; done.value = '';
  try {
    const prev = base.value;
    const res = await saveCampaign(await token(), input, opFor(key), prev?.id, prev?.version);
    ops.delete(key);
    // 重送被認成同一次時，回來的可能是別人較新的版本；存檔途中我又改了的話不拿它當基準
    if (prev && res.version !== prev.version + 1 && JSON.stringify(form.value) !== sent) { conflict.value = true; return; }
    base.value = res;
    bannerUrl.value = res.bannerUrl;
    saved.value = JSON.stringify(fromCampaign(res));
    if (JSON.stringify(form.value) === sent) form.value = fromCampaign(res);
    done.value = t('campaign.settings.saved');
    if (!prev) await router.replace(lp(`/review/settings/campaigns/${res.id}`));
  } catch (e) {
    if (e instanceof CampaignError && e.code === 'campaign_version_conflict') conflict.value = true;
    else { formError.value = message(e); if (e instanceof CampaignError) fieldError.value = e.field; }
  } finally { busy.value = false; }
}

async function loadLatest() {
  const id = base.value?.id;
  if (!id) return;
  busy.value = true; formError.value = '';
  try {
    const res = await fetchCampaigns(await token());
    canEdit.value = res.canEdit;
    const latest = res.items.find((c) => c.id === id);
    if (latest) apply(latest);
  } catch (e) { formError.value = message(e); } finally { busy.value = false; }
}

/** 收狀態；回應帶著別人存的內容時版本號留在原處、標成衝突，下一次存檔會被擋下。 */
function holdBase(prev: Campaign, res: Campaign) {
  const moved = res.version !== prev.version + 1 || JSON.stringify(fromCampaign(res)) !== JSON.stringify(fromCampaign(prev));
  if (moved) { base.value = { ...prev, status: res.status }; conflict.value = true; }
  else base.value = res;
}
async function change(status: 'active' | 'ended') {
  const prev = base.value;
  if (!prev || !canEdit.value || busy.value) return;
  const title = t(status === 'active' ? 'campaign.activate' : 'campaign.end');
  if (!(await confirmDialog({ title, message: t(status === 'active' ? 'campaign.activateConfirm' : 'campaign.endConfirm'), confirmText: title, danger: status === 'ended' }))) return;
  const key = `status:${prev.id}:${status}`;
  busy.value = true; formError.value = ''; fieldError.value = ''; done.value = '';
  try {
    const res = await setCampaignStatus(await token(), prev.id, status, opFor(key));
    ops.delete(key);
    holdBase(prev, res);
    done.value = t('campaign.settings.saved');
  } catch (e) {
    formError.value = message(e);
    if (e instanceof CampaignError) fieldError.value = e.field;
  } finally { busy.value = false; }
}

async function uploadBanner(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  busy.value = true; formError.value = '';
  try {
    const res = await uploadCampaignBanner(await token(), file);
    form.value.bannerKey = res.key; bannerUrl.value = res.url;
  } catch (err) { formError.value = message(err); } finally { busy.value = false; }
}

const ask = async () => !dirty.value || (await confirmDialog({ message: t('blog.admin.unsaved'), confirmText: t('dialog.leave'), danger: true }));
onBeforeRouteLeave(ask);
// 換到另一個活動（或回到新活動）也要問；第一次存好換成自己的網址不問
onBeforeRouteUpdate((to) => (base.value && to.params.id === base.value.id ? true : ask()));
const guard = (e: BeforeUnloadEvent) => { if (dirty.value) { e.preventDefault(); e.returnValue = ''; } };
onMounted(() => {
  document.title = pageTitle(t('moderation.title'));
  window.addEventListener('beforeunload', guard);
  void load();
});
onBeforeUnmount(() => window.removeEventListener('beforeunload', guard));
// 新活動第一次存好會換到它自己的網址：那一筆已經在表單裡，不必重讀
watch(() => route.params.id, (id) => { if (/\/review\/settings\/campaigns\/[^/]+$/.test(route.path) && (!id || id !== base.value?.id)) void load(); });
</script>

<template>
  <section class="cedit" data-campaign-editor :aria-busy="loading" :aria-label="t('campaign.settings.title')">
    <RouterLink class="btn btn--sm btn--ghost cedit-back" :to="lp('/review/settings')" data-action="back">← {{ t('campaign.settings.back') }}</RouterLink>
    <p v-if="error" class="notice notice--error" role="alert">{{ error }} <button type="button" class="btn btn--sm" @click="load">{{ t('blog.retry') }}</button></p>
    <div v-else-if="loading" class="panel ghost cedit-ghost" />
    <form v-else class="panel cset-form" data-campaign-form @submit.prevent="save">
      <div class="cset-form__head">
        <h2>{{ base ? nameOf(base) : t('campaign.settings.new') }}</h2>
        <span v-if="base" class="chip cset-status" :class="`cset-status--${base.status}`">{{ t(`campaign.status.${base.status}`) }}</span>
      </div>
      <p v-if="!canEdit" class="notice" data-campaign-read-only>{{ t('moderation.settings.readOnly') }}</p>
      <p v-if="formError" class="notice notice--error" role="alert">{{ formError }}</p>
      <p v-if="done && !formError" class="notice" role="status">{{ done }}</p>
      <div v-if="conflict" class="notice notice--error cset-conflict" role="alert" data-conflict>
        <span>{{ t('campaign.error.conflict') }}</span>
        <button type="button" class="btn btn--sm" data-action="load-latest" :disabled="busy" @click="loadLatest">{{ t('campaign.loadLatest') }}</button>
      </div>

      <div class="cset-sec">
      <div class="seg cset-lang" role="group" :aria-label="t('campaign.field.language')">
        <button v-for="l in POST_LOCALES" :key="l" type="button" class="seg__item" :class="{ 'seg__item--on': lang === l }" :aria-pressed="lang === l" @click="lang = l">{{ localeLabel(l) }}</button>
      </div>
      <label class="field">
        <span>{{ t('campaign.field.title') }}</span>
        <input v-model="form.title[lang]" class="input" data-field="title" maxlength="120" :disabled="locked" :aria-invalid="bad('title') || undefined" />
        <span class="subtle">{{ t('campaign.field.titleHint') }}</span>
        <span v-if="bad('title')" class="cset-err" data-field-error="title">{{ t('campaign.error.fieldMissing', { field: fieldLabel('title') }) }}</span>
      </label>
      <label class="field">
        <span>{{ t('campaign.field.intro') }}</span>
        <textarea v-model="form.intro[lang]" class="input" data-field="intro" rows="5" maxlength="20000" :disabled="locked" :aria-invalid="bad('intro') || undefined" />
      </label>
      <label class="field">
        <span>{{ t('campaign.field.slug') }}</span>
        <input v-model="form.slug" class="input" data-field="slug" maxlength="40" pattern="[a-z0-9][a-z0-9\-]*" autocapitalize="off" spellcheck="false" :disabled="locked" :aria-invalid="bad('slug') || undefined" />
        <span class="subtle">{{ t('campaign.field.slugHint') }}</span>
        <span v-if="bad('slug')" class="cset-err" data-field-error="slug">{{ t('campaign.error.fieldMissing', { field: fieldLabel('slug') }) }}</span>
      </label>
      <div class="field">
        <span class="cset-label">{{ t('campaign.field.banner') }}</span>
        <img v-if="bannerUrl && form.bannerKey" class="cset-banner" :src="bannerUrl" alt="" />
        <span v-if="canEdit" class="cset-row-actions">
          <label class="btn btn--sm">{{ t('campaign.field.upload') }}<input type="file" accept="image/*" class="cset-file" :disabled="locked" @change="uploadBanner" /></label>
          <button v-if="form.bannerKey" type="button" class="btn btn--sm btn--ghost" :disabled="locked" @click="form.bannerKey = null">{{ t('campaign.field.removeBanner') }}</button>
        </span>
      </div>
      </div>

      <div class="cset-sec">

      <label class="field">
        <span>{{ t('campaign.field.timezone') }}</span>
        <select v-model="form.timezone" class="input cset-short" data-field="timezone" :disabled="locked" :aria-invalid="bad('timezone') || undefined">
          <option v-for="z in TIMEZONES" :key="z" :value="z">{{ zoneName(z, String(locale)) }} ({{ z }})</option>
        </select>
        <span class="subtle">{{ t('campaign.field.timezoneHint') }}</span>
      </label>
      <div class="cset-grid cset-grid--2">
        <label v-for="k in TIMES" :key="k" class="field">
          <span>{{ t(`campaign.field.${k}`) }}</span>
          <input v-model="form.times[k]" class="input" type="datetime-local" :data-field="k" :disabled="locked" :aria-invalid="bad(k) || undefined" />
          <span class="subtle" :data-zone="k">{{ zoneLabel }}</span>
          <span v-if="bad(k)" class="cset-err" :data-field-error="k">{{ t('campaign.error.fieldMissing', { field: fieldLabel(k) }) }}</span>
        </label>
      </div>

      </div>

      <fieldset class="cset-sec cset-group">
        <legend>{{ t('campaign.field.tiers') }}</legend>
        <div class="cset-grid cset-grid--4">
          <label v-for="k in TIERS" :key="k" class="field">
            <span>{{ t(`campaign.tier.${k}`) }}</span>
            <input v-model="form.tiers[k]" class="input" type="number" inputmode="numeric" min="1" step="1" :data-field="`tiers.${k}`" :placeholder="t('campaign.field.unset')" :disabled="locked" :aria-invalid="bad(`tiers.${k}`) || undefined" />
            <span v-if="bad(`tiers.${k}`)" class="cset-err" :data-field-error="`tiers.${k}`">{{ t('campaign.error.fieldMissing', { field: fieldLabel(`tiers.${k}`) }) }}</span>
          </label>
        </div>
      </fieldset>

      <div class="cset-sec cset-grid">
      <label class="field">
        <span>{{ t('campaign.field.extra') }}</span>
        <input v-model="form.extraPlacementAmount" class="input cset-short" type="number" inputmode="numeric" min="0" step="1" data-field="extraPlacementAmount" :placeholder="t('campaign.field.unset')" :disabled="locked" :aria-invalid="bad('extraPlacementAmount') || undefined" />
        <span v-if="bad('extraPlacementAmount')" class="cset-err" data-field-error="extraPlacementAmount">{{ t('campaign.error.fieldMissing', { field: fieldLabel('extraPlacementAmount') }) }}</span>
      </label>
      <label class="field">
        <span>{{ t('campaign.field.lightLimit') }}</span>
        <input v-model="form.lightLimit" class="input cset-short" type="number" inputmode="numeric" min="1" step="1" data-field="lightLimit" :placeholder="t('campaign.field.unset')" :disabled="locked" :aria-invalid="bad('lightLimit') || undefined" />
        <span v-if="bad('lightLimit')" class="cset-err" data-field-error="lightLimit">{{ t('campaign.error.fieldMissing', { field: fieldLabel('lightLimit') }) }}</span>
      </label>
      <label class="field">
        <span>{{ t('campaign.field.burst') }}</span>
        <input v-model="form.flagBurstThreshold" class="input cset-short" type="number" inputmode="numeric" min="1" step="1" data-field="flagBurstThreshold" :placeholder="t('campaign.field.unset')" :disabled="locked" :aria-invalid="bad('flagBurstThreshold') || undefined" />
      </label>
      <label class="field">
        <span>{{ t('campaign.field.retention') }}</span>
        <input v-model="form.evidenceRetentionDays" class="input cset-short" type="number" inputmode="numeric" min="1" max="3650" step="1" data-field="evidenceRetentionDays" :disabled="locked" :aria-invalid="bad('evidenceRetentionDays') || undefined" />
      </label>
      </div>
      <div class="field">
        <label class="cset-check"><input v-model="form.featured" type="checkbox" data-field="featured" :disabled="locked" aria-describedby="cset-featured-hint" />{{ t('campaign.field.featured') }}</label>
        <span id="cset-featured-hint" class="subtle">{{ t('campaign.field.featuredHint') }}</span>
      </div>

      <div v-if="canEdit" class="cset-actions">
        <button type="submit" class="btn btn--primary" data-action="save-campaign" :disabled="busy || !form.title['zh-Hant'].trim() || !form.slug.trim()">{{ t('campaign.settings.save') }}</button>
        <button v-if="base?.status === 'draft'" type="button" class="btn" data-action="activate" :disabled="busy || dirty" :title="dirty ? t('campaign.settings.saveFirst') : undefined" @click="change('active')">{{ t('campaign.activate') }}</button>
        <button v-if="base?.status === 'active'" type="button" class="btn btn--danger" data-action="end" :disabled="busy || dirty" :title="dirty ? t('campaign.settings.saveFirst') : undefined" @click="change('ended')">{{ t('campaign.end') }}</button>
      </div>
      <p v-if="canEdit && base && base.status !== 'ended' && dirty" class="subtle">{{ t('campaign.settings.saveFirst') }}</p>
    </form>
  </section>
</template>

<style scoped>
.cedit { display: grid; gap: var(--s-4); max-width: 960px; min-width: 0; }
.cedit-back { justify-self: start; }
.cedit-ghost { height: 480px; }
.cset-form__head { display: flex; align-items: center; gap: var(--s-3); flex-wrap: wrap; }
.cset-form__head h2 { font-size: 20px; margin: 0; min-width: 0; overflow-wrap: anywhere; }
.cset-status { cursor: default; height: 22px; }
.cset-status:hover { background: var(--surface-2); color: var(--text-2); }
.cset-status--active, .cset-status--active:hover { background: var(--success-soft); color: var(--success); }
.cset-form { display: grid; gap: var(--s-4); padding: var(--s-5); min-width: 0; }
/* 表單分組：基本資料、時間、金額檔位、其他規則；組與組之間一條髮絲線 */
.cset-sec { display: grid; gap: var(--s-4); min-width: 0; }
.cset-sec + .cset-sec { padding-top: var(--s-4); border-top: 1px solid var(--line); }
.cset-form .field { margin-bottom: 0; gap: 6px; min-width: 0; }
.cset-form .field > span:first-child, .cset-label { font-size: 13px; font-weight: 600; }
.cset-form .input { width: 100%; }
.cset-form .cset-short { max-width: 280px; }
.cset-lang { justify-self: start; max-width: 100%; overflow-x: auto; }
.cset-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: var(--s-4); }
.cset-grid .cset-short { max-width: none; }
/* 四個時間二乘二（datetime-local 太窄會溢出）；四個檔位寬螢幕一列四格：都不讓最後一格落單 */
.cset-grid--2 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
.cset-grid--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
@media (max-width: 1240px) { .cset-grid--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 520px) { .cset-grid--2, .cset-grid--4 { grid-template-columns: minmax(0, 1fr); } }
.cset-group { border: 0; margin: 0; padding: 0; min-width: 0; }
.cset-group legend { font-size: 13px; font-weight: 600; margin-bottom: var(--s-2); padding: 0; }
.cset-check { display: flex; align-items: center; gap: var(--s-2); min-height: 44px; font-size: 14px; font-weight: 600; }
.cset-check input { flex: none; width: 1.125rem; height: 1.125rem; accent-color: var(--accent); }
.cset-err { font-size: 12.5px; color: var(--danger); }
.cset-form [aria-invalid="true"] { border-color: var(--danger); }
.cset-banner { display: block; max-width: 100%; max-height: 160px; border-radius: var(--r-sm); object-fit: cover; box-shadow: 0 0 0 1px var(--line); }
.cset-row-actions { display: flex; gap: var(--s-2); flex-wrap: wrap; }
.cset-row-actions .btn { position: relative; cursor: pointer; }
.cset-file { position: absolute; width: 1px; height: 1px; opacity: 0; pointer-events: none; }
.cset-conflict { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-3); }
.cset-actions { display: flex; gap: var(--s-2); flex-wrap: wrap; padding-top: var(--s-4); border-top: 1px solid var(--line); }

@media (max-width: 760px) {
  .cset-form { padding: var(--s-4); }
  .cset-form .input, .cset-actions .btn, .cedit-back { min-height: 44px; }
}
</style>

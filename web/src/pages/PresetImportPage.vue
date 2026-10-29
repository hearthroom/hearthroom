<script setup lang="ts">
/**
 * 匯入酒館預設：選檔 → （有多組排序時）選一組 → 看報告、決定要採用哪些條目 → 存成私人預設。
 *
 * 報告只分三類：可直接用（不標示）、需調整（玩家確認調整，或選擇不採用）、不支援（不會執行）。
 * 不支援的條目和綺夢社不執行的酒館設定都留在預設裡，匯出回酒館時原樣帶回。
 * 匯入只建私人預設：不套用到任何卡、不發布，也不需要勾權利聲明（聲明只在發布時）。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { useRouter } from "vue-router";
import { ApiError } from "@/lib/api";
import { pageTitle } from "@/lib/i18n";
import { whole } from "@/lib/format";
import { confirmImport, previewImport, readLocalProfiles, resultUnknown, updateImportSelection, type ImportPreview, type LocalProfile } from "@/lib/presets";
import { adaptationId, entryRows, type PresetSelection } from "@/lib/st-preset";
import { operationKeys, usePresetAccess } from "@/lib/use-preset-access";
import { useLocalePath } from "@/lib/use-locale";
import { settingLabel } from "@/components/preset/preset-params";
import PresetReauth from "@/components/preset/PresetReauth.vue";

const { t, te } = useI18n();
const { lp } = useLocalePath();
const router = useRouter();
const { token, needsConsent, consentNeeded, reauthorize } = usePresetAccess();
const ops = operationKeys();

const LIMIT = "1 MB";
const LOCAL_ERROR = { too_large: "preset.error.tooLarge", not_json: "preset.error.json", not_preset: "preset.error.format" } as const;

const picker = ref<HTMLInputElement | null>(null);
const file = ref<File | null>(null);
const profiles = ref<LocalProfile[]>([]);
const profileId = ref<number | null>(null);
const profileAsked = ref(false);
const fileError = ref("");
const preview = ref<ImportPreview | null>(null);
const title = ref("");
const analyzing = ref(false);
const updating = ref(false);
const confirming = ref(false);
const unconfirmed = ref(false);
const error = ref("");
const expired = ref(false);
const stale = ref(false);

const report = computed(() => preview.value?.report);
const selection = computed(() => preview.value?.document.selection);
const rows = computed(() => (preview.value ? entryRows(preview.value.document) : []));
const compatOf = (id: string) => report.value?.entries.find((e) => e.identifier === id);
const custom = computed(() => rows.value.filter((r) => r.slot !== "F"));
const statusOf = (id: string) => compatOf(id)?.uiStatus;
const counts = computed(() => ({
  ok: custom.value.filter((r) => !statusOf(r.identifier)).length,
  adjust: custom.value.filter((r) => statusOf(r.identifier) === "needs_adjustment").length,
  unsupported: custom.value.filter((r) => statusOf(r.identifier) === "unsupported").length,
}));
const excluded = (id: string) => !!selection.value?.excludedEntryIds.includes(id);
const accepted = (id: string) => !!selection.value?.acceptedAdaptationIds.includes(adaptationId(id));
/** 要採用、但還沒確認調整的條目：不處理就不能存 */
const needFix = computed(() => custom.value.filter((r) => r.enabled && statusOf(r.identifier) === "needs_adjustment" && !accepted(r.identifier)).length);
const fields = computed(() => [...new Set((report.value?.fields ?? []).filter((f) => f.uiStatus === "unsupported").flatMap((f) => f.inertSettings.length ? f.inertSettings : [f.path]).map((k) => settingLabel(k, t, te)))]);
const reasonText = (id: string, code: string) => {
  const role = rows.value.find((r) => r.identifier === id)?.prompt.role === "assistant" ? "assistant" : "user";
  return te(`preset.reason.entry.${code}`) ? t(`preset.reason.entry.${code}`, { role: t(`preset.entry.role.${role}`) }) : "";
};

// 每組附條目數與前三條自訂條目的名稱：只有序號的話玩家分不出要選哪一組
const profileLabel = (p: LocalProfile, index: number) => t("preset.import.profile.option", {
  index: index + 1, n: whole(p.count), names: p.names.join(t("preset.setting.separator")) + (p.more ? "…" : ""),
}, p.count);

function choose() {
  picker.value?.click();
}

async function onFile(e: Event) {
  const picked = (e.target as HTMLInputElement).files?.[0];
  (e.target as HTMLInputElement).value = "";
  if (!picked) return;
  fileError.value = "";
  error.value = "";
  expired.value = false;
  preview.value = null;
  const local = await readLocalProfiles(picked);
  if (!local.ok) { fileError.value = t(LOCAL_ERROR[local.reason], { limit: LIMIT }); file.value = null; return; }
  file.value = picked;
  title.value = picked.name.replace(/\.(json|settings)$/i, "").slice(0, 60);
  profiles.value = local.profiles;
  // 只有一組排序就用那組；多組時不替玩家選（每組可能是完全不同的寫法）
  profileAsked.value = local.profiles.length > 1;
  profileId.value = local.profiles.length === 1 ? local.profiles[0]!.id : null;
  if (!profileAsked.value) await analyze();
}

async function analyze() {
  if (!file.value || analyzing.value) return;
  analyzing.value = true;
  error.value = "";
  expired.value = false;
  try {
    const out = await previewImport(await token(), file.value, profileId.value);
    profileAsked.value = false;
    preview.value = out;
    // 不支援的條目不會執行：先列為不採用，玩家在報告裡看得到它
    const unsupported = entryRows(out.document).filter((r) => r.slot !== "F" && out.report.entries.find((e) => e.identifier === r.identifier)?.uiStatus === "unsupported").map((r) => r.identifier);
    const missing = unsupported.filter((id) => !out.document.selection.excludedEntryIds.includes(id));
    if (missing.length) await select({ ...out.document.selection, excludedEntryIds: [...out.document.selection.excludedEntryIds, ...missing] }, false);
  } catch (err) {
    if (consentNeeded(err)) return;
    if (err instanceof ApiError && err.code === "preset_profile_required") profileAsked.value = true;
    else error.value = resultUnknown(err) ? t("preset.error.unavailable") : err instanceof Error ? err.message : t("preset.error.unavailable");
  } finally {
    analyzing.value = false;
  }
}

let seq = 0;
async function select(next: PresetSelection, announce = true) {
  const p = preview.value;
  if (!p) return;
  const mine = ++seq;
  updating.value = true;
  error.value = "";
  try {
    const out = await updateImportSelection(await token(), p.previewId, p.version, next);
    if (mine !== seq) return;
    // 上游重算後判定有變（例如換了編譯規則）：告訴玩家結果更新了，他的選擇還在
    stale.value = announce && JSON.stringify(out.report.entries.map((e) => [e.identifier, e.uiStatus])) !== JSON.stringify(p.report.entries.map((e) => [e.identifier, e.uiStatus]));
    preview.value = out;
  } catch (err) {
    if (consentNeeded(err) || mine !== seq) return;
    if (err instanceof ApiError && err.code === "preset_preview_expired") expired.value = true;
    else error.value = err instanceof Error ? err.message : t("preset.error.unavailable");
  } finally {
    if (mine === seq) updating.value = false;
  }
}

function setUse(id: string, use: boolean) {
  const s = selection.value;
  if (!s) return;
  const ex = s.excludedEntryIds.filter((x) => x !== id);
  if (!use) ex.push(id);
  void select({ ...s, excludedEntryIds: ex, acceptedAdaptationIds: use ? s.acceptedAdaptationIds : s.acceptedAdaptationIds.filter((x) => x !== adaptationId(id)) });
}

function accept(id: string) {
  const s = selection.value;
  if (!s) return;
  void select({ ...s, excludedEntryIds: s.excludedEntryIds.filter((x) => x !== id), acceptedAdaptationIds: [...new Set([...s.acceptedAdaptationIds, adaptationId(id)])] });
}

async function confirm() {
  const p = preview.value;
  if (!p || confirming.value || updating.value || needFix.value || !title.value.trim()) return;
  confirming.value = true;
  error.value = "";
  const name = title.value.trim();
  const action = `confirm:${p.previewId}:${p.selectionDigest}:${name}`;
  try {
    for (let attempt = 0; ; attempt++) {
      try {
        const receipt = await confirmImport(await token(), p.previewId, { expectedPreviewVersion: p.version, selectionDigest: p.selectionDigest, title: name, recommendedModels: [] }, ops.key(action));
        ops.done(action);
        await router.replace({ path: lp(`/me/presets/${receipt.presetId}`), query: { imported: name } });
        return;
      } catch (err) {
        // 送出後沒收到回應：用同一把鍵再問一次，拿回原本的收據，不會多存一份
        if (!resultUnknown(err) || attempt >= 3) throw err;
        unconfirmed.value = true;
        await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
      }
    }
  } catch (err) {
    if (!resultUnknown(err)) ops.done(action);
    if (consentNeeded(err)) return;
    if (err instanceof ApiError && err.code === "preset_preview_expired") expired.value = true;
    else error.value = resultUnknown(err) ? t("preset.error.unknown") : err instanceof Error ? err.message : t("preset.error.unavailable");
  } finally {
    unconfirmed.value = false;
    confirming.value = false;
  }
}

onMounted(() => { document.title = pageTitle(t("preset.import.title")); });
</script>

<template>
  <div class="page page--narrow preset-import">
    <nav class="preset-import__crumb"><RouterLink :to="lp('/me/presets')" class="preset-crumb">{{ $t("preset.editor.back") }}</RouterLink></nav>
    <header>
      <h1 class="display">{{ $t("preset.import.title") }}</h1>
      <p class="muted">{{ $t("preset.import.lede") }}</p>
    </header>

    <PresetReauth v-if="needsConsent" @confirm="reauthorize" @cancel="router.push(lp('/me/presets'))" />

    <template v-else>
      <section class="panel preset-import__card">
        <input ref="picker" type="file" accept=".json,application/json" hidden data-testid="import-file" @change="onFile" />
        <button type="button" class="btn" :class="{ 'btn--primary': !file }" :disabled="analyzing" @click="choose">{{ $t(file ? "preset.import.change" : "preset.import.pick") }}</button>
        <p class="subtle">{{ file ? file.name : $t("preset.import.formats", { limit: LIMIT }) }}</p>
        <p v-if="fileError" class="notice notice--error" role="alert" data-testid="import-file-error">{{ fileError }}</p>
        <p v-if="analyzing" class="subtle" role="status">{{ $t("preset.import.analyzing") }}</p>
      </section>

      <section v-if="profileAsked && file" class="panel preset-import__card" data-testid="import-profile-step">
        <h2>{{ $t("preset.import.profile.title") }}</h2>
        <p class="muted">{{ $t("preset.import.profile.body") }}</p>
        <fieldset class="preset-import__profiles">
          <legend class="sr-only">{{ $t("preset.import.profile.title") }}</legend>
          <label v-for="(p, index) in profiles" :key="p.id" class="preset-import__pick">
            <input v-model="profileId" type="radio" name="import-profile" :value="p.id" data-testid="import-profile" />
            <span class="preset-import__name">{{ profileLabel(p, index) }}</span>
          </label>
        </fieldset>
        <button type="button" class="btn btn--primary" :disabled="profileId === null || analyzing" data-testid="import-profile-confirm" @click="analyze">{{ $t("preset.import.profile.confirm") }}</button>
      </section>

      <p v-if="expired" class="notice" role="alert">{{ $t("preset.import.expired") }} <button type="button" class="btn btn--sm" @click="choose">{{ $t("preset.import.expired.action") }}</button></p>
      <p v-if="error" class="notice notice--error" role="alert">{{ error }}</p>

      <template v-if="preview && report">
        <section class="panel preset-import__card" data-testid="import-report">
          <h2>{{ $t("preset.report.title") }}</h2>
          <p class="preset-import__summary">
            <span>{{ $t("preset.report.summary.ok", { n: whole(counts.ok) }, counts.ok) }}</span>
            <span>{{ $t("preset.report.summary.adjust", { n: whole(counts.adjust) }, counts.adjust) }}</span>
            <span>{{ $t("preset.report.summary.unsupported", { n: whole(counts.unsupported) }, counts.unsupported) }}</span>
          </p>
          <p v-if="counts.unsupported" class="subtle">{{ $t("preset.report.unsupported.note") }}</p>
          <p v-if="stale" class="notice" role="status">{{ $t("preset.report.stale") }}</p>

          <ul class="preset-import__entries">
            <li v-for="r in rows" :key="r.identifier" data-testid="import-entry">
              <template v-if="r.slot === 'F'">
                <svg class="preset-import__lock" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                <span class="preset-import__name">{{ r.prompt.name || r.identifier }}</span>
                <span class="subtle">{{ $t("preset.provided.label") }}</span>
              </template>
              <template v-else>
                <label class="preset-import__pick">
                  <!-- 來源本來就關著的條目：照來源，不在這裡打開（要用的話匯入後在編輯器裡開） -->
                  <input type="checkbox" :checked="r.enabled" :disabled="statusOf(r.identifier) === 'unsupported' || !r.sourceEnabled || updating" @change="setUse(r.identifier, ($event.target as HTMLInputElement).checked)" />
                  <span class="preset-import__name">{{ r.prompt.name || $t("preset.entry.untitled") }}</span>
                  <span class="sr-only">{{ $t("preset.report.use") }}</span>
                </label>
                <span v-if="statusOf(r.identifier)" class="preset-import__tag" :class="`preset-import__tag--${statusOf(r.identifier)}`">{{ $t(statusOf(r.identifier) === "needs_adjustment" ? "preset.report.status.adjust" : "preset.report.status.unsupported") }}</span>
                <span v-else-if="excluded(r.identifier)" class="subtle">{{ $t("preset.report.skip") }}</span>
                <div v-if="compatOf(r.identifier)?.reasonCodes.length" class="preset-import__reason">
                  <p v-for="code in compatOf(r.identifier)!.reasonCodes" :key="code">{{ reasonText(r.identifier, code) }}</p>
                  <template v-if="statusOf(r.identifier) === 'needs_adjustment' && !excluded(r.identifier)">
                    <p v-if="accepted(r.identifier)">{{ $t("preset.adapt.moveToSuffix.done") }}</p>
                    <template v-else>
                      <p class="subtle">{{ $t("preset.adapt.moveToSuffix.from") }}<br />{{ $t("preset.adapt.moveToSuffix.to") }}</p>
                      <button type="button" class="btn btn--sm preset-import__accept" :disabled="updating" data-testid="import-accept" @click="accept(r.identifier)">{{ $t("preset.adapt.moveToSuffix.accept") }}</button>
                    </template>
                  </template>
                </div>
              </template>
            </li>
          </ul>

          <div v-if="fields.length" class="preset-import__fields" data-testid="import-fields">
            <h3>{{ $t("preset.report.fields.title") }}</h3>
            <p class="subtle">{{ $t("preset.report.fields.body") }}</p>
            <ul><li v-for="f in fields" :key="f">{{ $t("preset.report.fields.item", { name: f }) }}</li></ul>
          </div>
        </section>

        <section class="panel preset-import__card">
          <div class="field">
            <label for="import-title">{{ $t("preset.report.name") }}</label>
            <input id="import-title" v-model="title" class="input" maxlength="60" required data-testid="import-title" />
          </div>
          <p v-if="needFix" class="subtle" role="status" data-testid="import-needfix">{{ $t("preset.report.needFix", { n: whole(needFix) }, needFix) }}</p>
          <p v-if="unconfirmed" class="subtle" role="status">{{ $t("preset.error.unknown") }} {{ $t("preset.error.unknown.hint") }}</p>
          <button type="button" class="btn btn--primary btn--lg" :disabled="confirming || updating || expired || needFix > 0 || !title.trim()" data-testid="import-confirm" @click="confirm">
            {{ confirming ? $t("preset.report.confirming") : $t("preset.report.confirm") }}
          </button>
        </section>
      </template>
    </template>
  </div>
</template>

<style scoped>
.preset-import { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-5) var(--s-8); }
.preset-import header p { margin: var(--s-2) 0 0; }
.preset-import__crumb { font-size: 13px; }
/* 返回連結用內文次要色＋底線（站上的粉色小字在這裡只有 3.2:1） */
.preset-crumb { color: var(--text-2); text-decoration: underline; text-underline-offset: 3px; display: inline-flex; align-items: center; min-height: var(--h-sm); }
.preset-crumb:hover { color: var(--text); }

.preset-import__card { padding: var(--s-5); display: grid; gap: var(--s-3); justify-items: start; }
.preset-import__card h2 { margin: 0; font-size: 16px; }
.preset-import__card > p, .preset-import__card .field { margin: 0; justify-self: stretch; }
.preset-import__profiles { border: 0; margin: 0; padding: 0; display: grid; gap: var(--s-1); justify-self: stretch; }
.preset-import__summary { display: flex; flex-wrap: wrap; gap: var(--s-2) var(--s-4); font-weight: 600; }
.preset-import__summary span { white-space: nowrap; }
.preset-import__entries { list-style: none; margin: 0; padding: 0; display: grid; justify-self: stretch; }
.preset-import__entries li { display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); min-height: var(--h-lg); border-bottom: 1px solid var(--line); }
.preset-import__pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: var(--s-2); min-height: var(--h-lg); cursor: pointer; }
.preset-import__pick input { width: 18px; height: 18px; accent-color: var(--accent); flex-shrink: 0; }
.preset-import__name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.preset-import__lock { flex-shrink: 0; width: 18px; color: var(--text-3); }
.preset-import__tag { font-size: 12px; font-weight: 600; }
.preset-import__tag--needs_adjustment { color: var(--warning-text); }
.preset-import__tag--unsupported { color: var(--danger); }
.preset-import__reason { flex-basis: 100%; margin: 0 0 var(--s-3) 26px; display: grid; gap: var(--s-1); justify-items: start; }
.preset-import__reason p { margin: 0; font-size: 13px; color: var(--text-2); overflow-wrap: anywhere; }
.preset-import__accept { height: auto; min-height: var(--h-sm); white-space: normal; }
.preset-import__fields { justify-self: stretch; display: grid; gap: var(--s-1); }
.preset-import__fields h3 { margin: 0; font-size: 14px; }
.preset-import__fields p { margin: 0; }
.preset-import__fields ul { margin: 0; padding-left: var(--s-5); font-size: 13px; color: var(--text-2); }
@media (max-width: 480px) { .preset-import__card .btn--lg { width: 100%; } }
</style>

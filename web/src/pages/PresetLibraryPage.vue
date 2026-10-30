<script setup lang="ts">
/**
 * 別人公開的預設，唯讀：條目、取樣參數、測試過的模型、來源與作者。
 *
 * 網頁上沒有「套用」：套用只在遊玩畫布的回覆偏好裡為某一張卡做（卡片層，沿用 P1 的決定），
 * 這裡用一行字指過去。主行動是加入喜愛——加了之後在畫布選擇器的「喜愛與用過」就找得到。
 * 沒有匯出、沒有另存副本（owner 2026-10-30：不做 fork）。
 *
 * 看得到的條件由上游判斷（公開中、在我的喜愛與用過裡，或我是作者），否則 404。
 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { ApiError } from "@/lib/api";
import { confirmDialog } from "@/lib/confirm";
import { pageTitle } from "@/lib/i18n";
import { dateOnly, whole } from "@/lib/format";
import { favoritePreset, fetchLibraryPreset, type PresetLibraryDetail } from "@/lib/presets";
import { entryRows, type ParamKey } from "@/lib/st-preset";
import { usePresetAccess } from "@/lib/use-preset-access";
import { useLocalePath } from "@/lib/use-locale";
import { paramLabelKey } from "@/components/preset/preset-params";
import { authorLabel, modelLabel, useModelOptions } from "@/components/preset/preset-share";
import PresetReauth from "@/components/preset/PresetReauth.vue";
import PresetReportDialog from "@/components/preset/PresetReportDialog.vue";

const { t, te } = useI18n();
const route = useRoute();
const router = useRouter();
const { lp } = useLocalePath();
const { token, needsConsent, consentNeeded, reauthorize } = usePresetAccess();
useModelOptions(token);

const presetId = computed(() => String(route.params.presetId ?? ""));
const data = ref<PresetLibraryDetail | null>(null);
const loading = ref(true);
const notFound = ref(false);
const failed = ref(false);
const favBusy = ref(false);
const reporting = ref(false);
const showAll = ref(false);
const toast = ref("");
let toastTimer: ReturnType<typeof setTimeout> | undefined;

const PREVIEW = 4;
const item = computed(() => data.value?.item ?? null);
/** 只列會執行的自訂條目：數量對得上上方的「共 N 條」；由綺夢社提供的那幾格（歷史、角色卡）不在這裡 */
const entries = computed(() => {
  if (!data.value) return [];
  const compat = new Map(data.value.compatibility.entries.map((e) => [e.identifier, e]));
  return entryRows(data.value.revision.document)
    .filter((r) => r.slot !== "F" && r.enabled)
    .map((r) => ({ row: r, unsupported: compat.get(r.identifier)?.uiStatus === "unsupported" }));
});
const shown = computed(() => (showAll.value ? entries.value : entries.value.slice(0, PREVIEW)));
const params = computed(() => Object.entries(data.value?.parameters ?? {})
  .map(([k, v]) => {
    const key = paramLabelKey(k as ParamKey);
    return te(key) ? `${t(key)} ${typeof v === "number" ? v : String(v)}` : "";
  })
  .filter(Boolean));
/** 數的是下面列得出來的條目（含收在「看其餘」裡的），不是上游的 enabledEntryCount：那個連綺夢社提供的幾格也算進去，對不上列表 */
const summary = computed(() => [t("preset.share.detail.summary", { n: whole(entries.value.length) }, entries.value.length), ...params.value].join(" · "));
const roleLabel = (role?: string) => t(`preset.entry.role.${role === "user" || role === "assistant" ? role : "system"}`);

async function load() {
  loading.value = true;
  notFound.value = false;
  failed.value = false;
  try {
    data.value = await fetchLibraryPreset(await token(), presetId.value);
    document.title = pageTitle(data.value.item.title);
  } catch (err) {
    if (consentNeeded(err)) return;
    if (err instanceof ApiError && err.status === 404) notFound.value = true;
    else failed.value = true;
  } finally {
    loading.value = false;
  }
}

function say(text: string) {
  toast.value = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.value = ""; }, 4000);
}

/** 已不公開的取消喜愛就再也看不到、加不回來：先確認，取消後回到喜愛與用過 */
async function toggleFavorite() {
  if (!item.value || favBusy.value) return;
  const losing = item.value.favorited && !item.value.listed;
  if (losing && !(await confirmDialog({
    title: t("preset.share.unfavorite.title", { name: item.value.title }), message: t("preset.share.unfavorite.body"),
    confirmText: t("preset.share.unfavorite.confirm"), cancelText: t("preset.share.unfavorite.keep"), danger: true, dangerAppearance: "subdued", focusCancel: true,
  }))) return;
  favBusy.value = true;
  try {
    const res = await favoritePreset(await token(), item.value.presetId, !item.value.favorited);
    item.value.favorited = res.favorited;
    if (losing && !res.favorited) { void router.replace({ path: lp("/me/presets"), query: { tab: "fav" } }); return; }
    say(t(res.favorited ? "preset.share.fav.added" : "preset.share.fav.removed"));
  } catch (err) {
    if (!consentNeeded(err)) say(t("preset.share.error.fav"));
  } finally {
    favBusy.value = false;
  }
}

function reported() { if (data.value) data.value.reportedByMe = true; }

/** 從列表點進來就回到原本那一格（公開或喜愛與用過），直接打開的才回到公開 */
function back(e: MouseEvent) {
  const prev = (window.history.state as { back?: string } | null)?.back;
  if (prev && prev.includes("/me/presets")) { e.preventDefault(); router.back(); }
}

watch(presetId, () => { showAll.value = false; void load(); });
onMounted(() => { document.title = pageTitle(t("preset.nav")); void load(); });
onBeforeUnmount(() => clearTimeout(toastTimer));
</script>

<template>
  <div class="page shared">
    <RouterLink :to="{ path: lp('/me/presets'), query: { tab: 'public' } }" class="shared__back link" data-testid="shared-back" @click="back">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6" /></svg>
      {{ $t("preset.share.detail.back") }}
    </RouterLink>

    <PresetReauth v-if="needsConsent" @confirm="reauthorize" @cancel="router.push(lp('/me/presets'))" />

    <div v-else-if="loading && !data" class="shared__grid" aria-busy="true">
      <div class="shared__head"><div class="ghost shared__ghostTitle" /><div class="ghost shared__ghostLine" /></div>
      <div class="shared__side"><div class="panel ghost shared__ghostPanel" /></div>
      <div class="shared__content"><div class="panel ghost shared__ghostContent" /></div>
    </div>

    <section v-else-if="notFound" class="panel shared__card" role="alert" data-testid="shared-not-found">
      <p>{{ $t("preset.error.notFound") }}</p>
    </section>
    <section v-else-if="failed" class="panel shared__card" role="alert">
      <p>{{ $t("preset.share.error.load") }}</p>
      <button type="button" class="btn btn--sm" @click="load()">{{ $t("preset.list.retry") }}</button>
    </section>

    <div v-else-if="data && item" class="shared__grid">
      <header class="shared__head">
        <h1 class="display shared__title" data-testid="shared-title">{{ item.title }}</h1>
        <p class="muted shared__by">{{ authorLabel(item) }} · {{ $t("preset.share.detail.updated", { date: dateOnly(Date.parse(item.updatedAt) / 1000) }) }}</p>
        <p v-if="!item.listed" class="shared__unlisted" data-testid="shared-unlisted">
          <span class="chip shared__chip shared__chip--strong">{{ $t("preset.share.unlisted") }}</span>
          <span class="subtle">{{ $t("preset.share.unlisted.hint") }}</span>
        </p>
      </header>

      <aside class="shared__side">
        <div v-if="!item.mine" class="shared__actions">
          <button
            type="button" class="btn btn--lg shared__fav" :class="item.favorited ? 'shared__fav--on' : 'btn--primary'" :aria-pressed="item.favorited"
            :disabled="favBusy" data-testid="shared-fav" @click="toggleFavorite"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" :fill="item.favorited ? 'currentColor' : 'none'" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round" aria-hidden="true"><path d="M12 20s-7.5-4.6-9.3-9.4C1.4 7.2 3.5 4 6.8 4c2 0 3.6 1.1 5.2 3.1C13.6 5.1 15.2 4 17.2 4c3.3 0 5.4 3.2 4.1 6.6C19.5 15.4 12 20 12 20z" /></svg>
            {{ $t(item.favorited ? "preset.share.fav.on" : "preset.share.fav.add") }}
          </button>
          <span v-if="data.reportedByMe" class="shared__reported" role="status" data-testid="shared-reported">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l4.5 4.5L19 7" /></svg>
            {{ $t("preset.share.report.reported") }}
          </span>
          <button v-else type="button" class="btn btn--lg btn--ghost shared__report" data-testid="shared-report" @click="reporting = true">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></svg>
            {{ $t("preset.share.report.action") }}
          </button>
        </div>
        <RouterLink v-else :to="lp(`/me/presets/${item.presetId}`)" class="btn btn--lg shared__edit">{{ $t("preset.row.edit") }}</RouterLink>

        <p class="subtle shared__apply" data-testid="shared-apply">{{ $t("preset.share.detail.apply") }}</p>

        <dl class="panel shared__facts">
          <div>
            <dt>{{ $t("preset.share.detail.users7d.label") }}</dt>
            <dd>{{ $t("preset.share.detail.users7d.value", { n: whole(item.usesLast7d) }, item.usesLast7d) }}</dd>
          </div>
          <div>
            <dt>{{ $t("preset.share.detail.tested.label") }}</dt>
            <dd v-if="item.recommendedModels.length">
              <span class="shared__models"><span v-for="m in item.recommendedModels" :key="m" class="chip shared__chip">{{ modelLabel(m) }}</span></span>
              <span class="subtle">{{ $t("preset.share.detail.tested.note") }}</span>
            </dd>
            <dd v-else>{{ $t("preset.share.untested") }}</dd>
          </div>
          <div v-if="item.attribution">
            <dt>{{ $t("preset.share.detail.source.label") }}</dt>
            <dd class="shared__wrap">{{ item.attribution }}</dd>
          </div>
          <div>
            <dt>{{ $t("preset.share.detail.price.label") }}</dt>
            <dd>{{ $t("preset.share.detail.price.free") }}</dd>
          </div>
        </dl>
      </aside>

      <section class="panel shared__content" :aria-busy="loading || undefined">
        <h2 class="shared__h2">{{ $t("preset.share.detail.content") }}</h2>
        <p class="subtle" data-testid="shared-summary">{{ summary }}</p>
        <ul class="shared__entries">
          <li v-for="{ row, unsupported } in shown" :key="row.identifier" data-testid="shared-entry">
            <details class="shared__entry">
              <summary>
                <span class="shared__entryName">{{ row.prompt.name || $t("preset.entry.untitled") }}</span>
                <span class="shared__entryTags">
                  <span v-if="unsupported" class="chip shared__chip">{{ $t("preset.report.status.unsupported") }}</span>
                  <span class="chip shared__chip">{{ roleLabel(row.prompt.role) }}</span>
                  <svg class="shared__chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
                </span>
              </summary>
              <p class="shared__entryBody">{{ row.prompt.content }}</p>
            </details>
          </li>
        </ul>
        <button v-if="!showAll && entries.length > PREVIEW" type="button" class="btn shared__more" data-testid="shared-more" @click="showAll = true">
          {{ $t("preset.share.detail.more", { n: whole(entries.length - PREVIEW) }) }}
        </button>
      </section>
    </div>

    <PresetReportDialog v-if="reporting && item" :preset-id="item.presetId" :title="item.title" :token="token" @close="reporting = false" @reported="reported" @consent="consentNeeded" />
    <div class="toast" role="status" :hidden="!toast">{{ toast }}</div>
  </div>
</template>

<style scoped>
.shared { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-4); padding-block: var(--s-5) var(--s-7); max-width: 1040px; }
.shared__back { color: var(--accent-text); justify-self: start; display: inline-flex; align-items: center; gap: var(--s-1); min-height: var(--h-sm); font-size: 14px; }
.shared__grid { display: grid; gap: var(--s-4); grid-template-columns: minmax(0, 1fr); grid-template-areas: "head" "side" "content"; }
.shared__head { grid-area: head; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
/* 欄寬用 minmax(0,1fr)：長的日文、英文不把這一欄撐出視窗（QA W3，320 寬） */
.shared__side { grid-area: side; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); align-content: start; }
.shared__content { grid-area: content; }
.shared__title { margin: 0; font-size: clamp(24px, 4vw, 30px); overflow-wrap: anywhere; }
.shared__by { margin: 0; overflow-wrap: anywhere; }
/* 韓文在詞中間斷行會剩一個音節掛在下一行：照站上 ConfirmDialog、CoachSpot 的做法整詞換行 */
:lang(ko) .shared__unlisted, :lang(ko) .shared__apply, :lang(ko) .shared__facts dd, :lang(ko) .shared__card p { word-break: keep-all; }
.shared__unlisted { margin: 0; display: flex; flex-wrap: wrap; align-items: center; gap: var(--s-1) var(--s-2); }
.shared__chip { height: auto; min-height: 22px; padding-block: 2px; cursor: default; overflow-wrap: anywhere; }
.shared__chip:hover { background: var(--surface-2); color: var(--text-2); }
.shared__chip--strong, .shared__chip--strong:hover { background: var(--border); color: var(--text); font-weight: 500; }
.shared__actions { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.shared__actions > * { flex: 1 1 0; min-width: fit-content; }
.shared__fav, .shared__report, .shared__edit { gap: var(--s-2); }
.shared__fav--on { background: var(--accent-tint); border-color: transparent; color: var(--accent-text); }
.shared__fav--on:hover { background: var(--accent-soft); }
.shared__reported { display: inline-flex; align-items: center; justify-content: center; gap: var(--s-1); min-height: var(--h-lg); font-size: 14px; color: var(--text-2); }
.shared__apply { margin: 0; line-height: 1.6; text-wrap: pretty; }
.shared__facts { margin: 0; padding: var(--s-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
.shared__facts div { display: grid; gap: var(--s-1); }
.shared__facts dt { font-size: 12.5px; color: var(--text-3); }
.shared__facts dd { margin: 0; font-size: 14px; display: grid; gap: var(--s-1); }
.shared__models { display: flex; flex-wrap: wrap; gap: 6px; }
.shared__wrap { overflow-wrap: anywhere; }
.shared__content { padding: var(--s-4); display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); align-content: start; }
.shared__content > p { margin: 0; }
.shared__h2 { margin: 0; font-size: 16px; }
.shared__entries { list-style: none; margin: 0; padding: 0; display: grid; }
.shared__entries li + li { border-top: 1px solid var(--line); }
.shared__entry summary { list-style: none; display: flex; align-items: center; justify-content: space-between; gap: var(--s-3); min-height: var(--h-lg); padding: var(--s-2) 0; cursor: pointer; }
.shared__entry summary::-webkit-details-marker { display: none; }
.shared__entryName { font-weight: 600; overflow-wrap: anywhere; min-width: 0; }
.shared__entryTags { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
.shared__chevron { color: var(--text-3); transition: rotate var(--dur) var(--ease); }
.shared__entry[open] .shared__chevron { rotate: 180deg; }
.shared__entryBody { margin: 0 0 var(--s-3); white-space: pre-wrap; overflow-wrap: anywhere; font-size: 13.5px; line-height: 1.7; color: var(--text-2); }
.shared__more { justify-self: start; }
.shared__card { padding: var(--s-5); display: grid; gap: var(--s-3); justify-items: start; }
.shared__card p { margin: 0; }
.shared__ghostTitle { height: 34px; width: 60%; border-radius: var(--r-sm); }
.shared__ghostLine { height: 16px; width: 40%; border-radius: var(--r-sm); }
.shared__ghostPanel { height: 160px; }
.shared__ghostContent { height: 280px; }
@media (min-width: 861px) {
  .shared__grid { grid-template-columns: minmax(0, 1fr) 320px; grid-template-areas: "head side" "content side"; grid-template-rows: auto 1fr; align-items: start; column-gap: var(--s-6); }
  .shared__actions { flex-direction: column; }
  .shared__actions > * { flex: none; }
}
</style>

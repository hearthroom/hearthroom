<script setup lang="ts">
/**
 * 公開：別人公開的預設。依模型篩選（全部／通用／手動選一個模型）＋搜尋名稱或作者，排序交給上游
 * （近 7 天使用人數，同數新的在前）。網頁沒有「目前的模型」，所以預設是「全部」（PM 2026-10-30）。
 *
 * 篩選與搜尋放在網址上：重新整理、上一頁回來都還是同一組條件。
 */
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { useRoute, useRouter } from "vue-router";
import { favoritePreset, LIBRARY_PAGE, listPresetLibrary, type PresetLibraryItem } from "@/lib/presets";
import PresetLibraryRow from "./PresetLibraryRow.vue";
import { useModelOptions } from "./preset-share";

const props = defineProps<{ token: () => Promise<string> }>();
const emit = defineEmits<{ toast: [text: string]; consent: [err: unknown] }>();
const { t } = useI18n();
const route = useRoute();
const router = useRouter();
const models = useModelOptions(props.token);

const model = computed(() => (typeof route.query.model === "string" && route.query.model ? route.query.model : "all"));
const q = computed(() => (typeof route.query.q === "string" ? route.query.q : ""));
const typed = ref(q.value);
const picked = computed(() => (model.value === "all" || model.value === "general" ? "" : model.value));

const items = ref<PresetLibraryItem[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const failed = ref(false);
const hasMore = ref(false);
const busy = ref("");
let seq = 0;

async function load(more = false) {
  const mine = ++seq;
  if (more) loadingMore.value = true;
  else { loading.value = true; failed.value = false; }
  try {
    const page = await listPresetLibrary(await props.token(), { model: model.value, q: q.value, offset: more ? items.value.length : 0 });
    if (mine !== seq) return;
    items.value = more ? [...items.value, ...page.items] : page.items;
    hasMore.value = page.items.length >= LIBRARY_PAGE;
  } catch (err) {
    if (mine !== seq) return;
    emit("consent", err);
    if (!more) failed.value = true;
    else emit("toast", t("preset.share.error.load"));
  } finally {
    if (mine === seq) { loading.value = false; loadingMore.value = false; }
  }
}

function setQuery(next: { model?: string; q?: string }) {
  const query = { ...route.query, ...next };
  if (!query.model || query.model === "all") delete query.model;
  if (!query.q) delete query.q;
  void router.replace({ query });
}

/** 打字停一下才搜，不是每個字都打一次上游 */
let timer: ReturnType<typeof setTimeout> | undefined;
watch(typed, (v) => { clearTimeout(timer); timer = setTimeout(() => setQuery({ q: v.trim().slice(0, 64) }), 300); });
onBeforeUnmount(() => clearTimeout(timer));
watch([model, q], () => void load(), { immediate: true });

function onPick(e: Event) {
  const value = (e.target as HTMLSelectElement).value;
  if (value) setQuery({ model: value });
}

async function toggle(item: PresetLibraryItem) {
  busy.value = item.presetId;
  const want = !item.favorited;
  try {
    const res = await favoritePreset(await props.token(), item.presetId, want);
    item.favorited = res.favorited;
    emit("toast", t(res.favorited ? "preset.share.fav.added" : "preset.share.fav.removed"));
  } catch (err) {
    emit("consent", err);
    emit("toast", t("preset.share.error.fav"));
  } finally {
    busy.value = "";
  }
}
</script>

<template>
  <section class="share-tab" data-testid="share-public">
    <div class="share-tab__controls">
      <label class="share-tab__search">
        <span class="sr-only">{{ $t("preset.share.search.label") }}</span>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="6.5" /><path d="M16 16l4 4" /></svg>
        <input v-model="typed" type="search" autocomplete="off" class="input" maxlength="64" :placeholder="$t('preset.share.search.placeholder')" data-testid="share-search" />
      </label>
      <div class="share-tab__filters" role="group" :aria-label="$t('preset.share.filter.label')">
        <button type="button" class="share-tab__pill" :class="{ 'share-tab__pill--on': model === 'all' }" :aria-pressed="model === 'all'" data-testid="share-filter-all" @click="setQuery({ model: 'all' })">{{ $t("preset.share.filter.all") }}</button>
        <button type="button" class="share-tab__pill" :class="{ 'share-tab__pill--on': model === 'general' }" :aria-pressed="model === 'general'" data-testid="share-filter-general" @click="setQuery({ model: 'general' })">{{ $t("preset.share.filter.general") }}</button>
        <span class="share-tab__selectWrap" :class="{ 'share-tab__selectWrap--on': picked }">
          <select class="share-tab__pill share-tab__select" :class="{ 'share-tab__pill--on': picked }" :value="picked" :aria-label="$t('preset.share.filter.pickModel')" data-testid="share-filter-model" @change="onPick">
            <option value="" disabled>{{ $t("preset.share.filter.pickModel") }}</option>
            <option v-if="picked && !models.some((m) => m.value === picked)" :value="picked">{{ picked }}</option>
            <option v-for="m in models" :key="m.value" :value="m.value">{{ m.label }}</option>
          </select>
        </span>
      </div>
    </div>
    <p class="subtle share-tab__sort">{{ $t("preset.share.sort.note") }}</p>

    <ul v-if="loading && !items.length" class="share-tab__list" aria-busy="true">
      <li v-for="n in 3" :key="n" class="panel share-tab__ghost ghost" />
    </ul>
    <section v-else-if="failed" class="panel share-tab__card" role="alert">
      <p>{{ $t("preset.share.error.load") }}</p>
      <button type="button" class="btn btn--sm" @click="load()">{{ $t("preset.list.retry") }}</button>
    </section>
    <section v-else-if="!items.length" class="panel share-tab__card" data-testid="share-public-empty">
      <p class="muted">{{ $t("preset.share.empty.public") }}</p>
    </section>
    <ul v-else class="share-tab__list" :aria-busy="loading || undefined">
      <PresetLibraryRow v-for="item in items" :key="item.presetId" :item="item" :busy="busy === item.presetId" @favorite="toggle" />
    </ul>
    <button v-if="hasMore && !loading && !failed" type="button" class="btn btn--lg share-tab__more" :disabled="loadingMore" data-testid="share-more" @click="load(true)">{{ $t("preset.list.more") }}</button>
  </section>
</template>

<style scoped>
.share-tab { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
.share-tab__controls { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
.share-tab__search { position: relative; display: block; }
.share-tab__search svg { position: absolute; left: 14px; top: 50%; translate: 0 -50%; color: var(--text-3); pointer-events: none; }
.share-tab__search .input { width: 100%; height: var(--h-lg); padding-left: 42px; font-size: 15px; }
.share-tab__filters { display: flex; flex-wrap: wrap; gap: var(--s-2); }
.share-tab__pill {
  height: var(--h-md); padding: 0 var(--s-4); border-radius: var(--r-pill);
  border: 1px solid var(--border-strong); background: var(--surface); color: var(--text);
  font: inherit; font-size: 14px; font-weight: 500; cursor: pointer;
  transition: background var(--dur) var(--ease), color var(--dur) var(--ease), border-color var(--dur) var(--ease);
}
.share-tab__pill:hover { background: var(--surface-2); }
.share-tab__pill--on, .share-tab__pill--on:hover { background: var(--accent-tint); border-color: transparent; color: var(--accent-text); }
/* 選了模型就顯示模型名；名字很長時截斷，不撐破這一排 */
/*
 * 箭頭由外框畫（跟搜尋頁的下拉同一個細線折角）：手機保留系統選擇器，只換掉粗的系統箭頭；
 * 滑鼠用站內浮層（base.css），它自己的箭頭關掉，不然會有兩個。
 */
.share-tab__selectWrap { position: relative; display: inline-flex; flex: 0 1 auto; min-width: 0; max-width: min(100%, 280px); color: var(--text-3); }
.share-tab__selectWrap--on { color: var(--accent-text); }
.share-tab__selectWrap::after {
  content: ""; position: absolute; inset-inline-end: var(--s-4); top: 50%;
  width: 6px; height: 6px; border-inline-end: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
  transform: translateY(-70%) rotate(45deg); pointer-events: none;
}
.share-tab__select { appearance: none; -webkit-appearance: none; width: 100%; min-width: 0; padding-right: var(--s-7); text-overflow: ellipsis; }
@supports (appearance: base-select) {
  @media (hover: hover) and (pointer: fine) {
    .share-tab__select { appearance: base-select; }
    .share-tab__select::picker-icon { display: none; }
  }
}
/* 手機的原生下拉以最長的模型名算寬度：讓它吃剩下的寬，跟全部／通用同排 */
@media (max-width: 760px) { .share-tab__selectWrap { flex: 1 1 0; } }
.share-tab__sort { margin: 0; }
.share-tab__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
.share-tab__ghost { height: 104px; }
.share-tab__card { padding: var(--s-5); display: grid; gap: var(--s-3); justify-items: start; }
.share-tab__card p { margin: 0; }
.share-tab__more { justify-self: center; }
@media (min-width: 761px) {
  .share-tab__controls { grid-template-columns: minmax(0, 1fr) auto; align-items: center; }
}
</style>

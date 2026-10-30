<script setup lang="ts">
/**
 * 喜愛與用過：加入喜愛的在前，接著套用過的（上游排好）。已經不公開的照樣列著、照常可用，
 * 只標「已不公開」加一句說明（owner 2026-10-30）。
 *
 * 還公開的取消喜愛後原位留著、愛心變空心，重新整理後才照上游的新順序排（列不跳動）。
 * 已不公開的不一樣：取消喜愛後上游就不再讓他看到，也加不回來，所以先確認，取消了就從清單拿掉。
 */
import { computed, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { confirmDialog } from "@/lib/confirm";
import { favoritePreset, LIBRARY_PAGE, listPresetShelf, type PresetLibraryItem } from "@/lib/presets";
import PresetLibraryRow from "./PresetLibraryRow.vue";

const props = defineProps<{ token: () => Promise<string> }>();
const emit = defineEmits<{ toast: [text: string]; consent: [err: unknown]; browse: [] }>();
const { t } = useI18n();

const items = ref<PresetLibraryItem[]>([]);
/** 載入當下哪些是喜愛：分組照這個，按 ♥ 不會讓一列跳到另一組 */
const favAtLoad = ref(new Set<string>());
const loading = ref(true);
const loadingMore = ref(false);
const failed = ref(false);
const hasMore = ref(false);
const busy = ref("");

const favorites = computed(() => items.value.filter((i) => favAtLoad.value.has(i.presetId)));
const used = computed(() => items.value.filter((i) => !favAtLoad.value.has(i.presetId)));

async function load(more = false) {
  if (more) loadingMore.value = true;
  else { loading.value = true; failed.value = false; }
  try {
    const page = await listPresetShelf(await props.token(), more ? items.value.length : 0);
    items.value = more ? [...items.value, ...page.items] : page.items;
    favAtLoad.value = new Set([...(more ? favAtLoad.value : []), ...page.items.filter((i) => i.favorited).map((i) => i.presetId)]);
    hasMore.value = page.items.length >= LIBRARY_PAGE;
  } catch (err) {
    emit("consent", err);
    if (!more) failed.value = true;
    else emit("toast", t("preset.share.error.load"));
  } finally {
    loading.value = false;
    loadingMore.value = false;
  }
}

async function toggle(item: PresetLibraryItem) {
  const losing = item.favorited && !item.listed;
  if (losing && !(await confirmDialog({
    title: t("preset.share.unfavorite.title", { name: item.title }), message: t("preset.share.unfavorite.body"),
    confirmText: t("preset.share.unfavorite.confirm"), cancelText: t("preset.share.unfavorite.keep"), danger: true, dangerAppearance: "subdued", focusCancel: true,
  }))) return;
  busy.value = item.presetId;
  try {
    const res = await favoritePreset(await props.token(), item.presetId, !item.favorited);
    item.favorited = res.favorited;
    if (losing && !res.favorited) items.value = items.value.filter((i) => i.presetId !== item.presetId);
    emit("toast", t(res.favorited ? "preset.share.fav.added" : "preset.share.fav.removed"));
  } catch (err) {
    emit("consent", err);
    emit("toast", t("preset.share.error.fav"));
  } finally {
    busy.value = "";
  }
}

onMounted(() => void load());
</script>

<template>
  <section class="share-tab" data-testid="share-shelf">
    <ul v-if="loading" class="share-tab__list" aria-busy="true">
      <li v-for="n in 3" :key="n" class="panel share-tab__ghost ghost" />
    </ul>
    <section v-else-if="failed" class="panel share-tab__card" role="alert">
      <p>{{ $t("preset.share.error.load") }}</p>
      <button type="button" class="btn btn--sm" @click="load()">{{ $t("preset.list.retry") }}</button>
    </section>
    <section v-else-if="!items.length" class="panel share-tab__card" data-testid="share-shelf-empty">
      <span class="share-tab__icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"><path d="M12 20s-7.5-4.6-9.3-9.4C1.4 7.2 3.5 4 6.8 4c2 0 3.6 1.1 5.2 3.1C13.6 5.1 15.2 4 17.2 4c3.3 0 5.4 3.2 4.1 6.6C19.5 15.4 12 20 12 20z" /></svg>
      </span>
      <h2>{{ $t("preset.share.empty.fav.title") }}</h2>
      <p class="muted">{{ $t("preset.share.empty.fav.body") }}</p>
      <button type="button" class="btn btn--primary btn--lg share-tab__cta" data-testid="share-browse" @click="emit('browse')">{{ $t("preset.share.empty.fav.action") }}</button>
    </section>
    <template v-else>
      <template v-if="favorites.length">
        <h2 class="share-tab__group">{{ $t("preset.share.group.fav") }}</h2>
        <ul class="share-tab__list" data-testid="share-group-fav">
          <PresetLibraryRow v-for="item in favorites" :key="item.presetId" :item="item" :busy="busy === item.presetId" @favorite="toggle" />
        </ul>
      </template>
      <template v-if="used.length">
        <h2 class="share-tab__group">{{ $t("preset.share.group.used") }}</h2>
        <ul class="share-tab__list" data-testid="share-group-used">
          <PresetLibraryRow v-for="item in used" :key="item.presetId" :item="item" :busy="busy === item.presetId" show-used-on @favorite="toggle" />
        </ul>
      </template>
    </template>
    <button v-if="hasMore && !loading && !failed" type="button" class="btn btn--lg share-tab__more" :disabled="loadingMore" @click="load(true)">{{ $t("preset.list.more") }}</button>
  </section>
</template>

<style scoped>
.share-tab { display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-3); }
.share-tab__group { margin: var(--s-1) 0 calc(-1 * var(--s-1)); font-size: 13px; font-weight: 600; color: var(--text-2); }
.share-tab__list { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: minmax(0, 1fr); gap: var(--s-2); }
.share-tab__ghost { height: 96px; }
.share-tab__card { padding: var(--s-5); display: grid; gap: var(--s-3); justify-items: start; }
.share-tab__card h2 { margin: 0; font-size: 16px; }
.share-tab__card p { margin: 0; line-height: 1.6; }
/* 韓文在詞中間斷行會剩一個音節掛在下一行：照站上 ConfirmDialog、CoachSpot 的做法整詞換行 */
:lang(ko) .share-tab__card h2, :lang(ko) .share-tab__card p { word-break: keep-all; }
.share-tab__icon { width: 48px; height: 48px; border-radius: var(--r-pill); background: var(--surface-2); color: var(--text-2); display: flex; align-items: center; justify-content: center; }
.share-tab__cta { justify-self: stretch; }
.share-tab__more { justify-self: center; }
@media (min-width: 761px) { .share-tab__cta { justify-self: start; } }
</style>
